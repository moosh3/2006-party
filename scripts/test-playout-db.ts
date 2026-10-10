import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// Deliberately isolated. Never load .env.local or connect to the live event.
async function main() {
  const db = new PGlite();
  try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  for (const file of [
    '001_schema', '004_synchronized_playback', '005_event_poster_mode',
    '006_video_queue', '008_auto_advance_lock', '009_queue_transaction_functions',
    '010_playback_elapsed_time', '011_hold_screen', '012_stream_resume_improvements',
    '013_fix_sync_restarts', '014_showtime_playout_and_queue', '015_youtube_playlist_sources',
    '022_playout_hardening',
  ]) await db.exec(readFileSync(`sql/${file}.sql`, 'utf8'));
  const q = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows;
  const rpc = async (sql: string, args: unknown[] = []) => (await q(`SELECT ${sql} AS result`, args))[0].result;
  const stream = async () => (await q('SELECT * FROM current_stream WHERE id = 1'))[0];
  const snapshot = () => rpc('get_playout_snapshot()');
  const ids: Record<string, string> = {};
  for (const [key, duration, kind, source] of [
    ['a', 10, 'vod', 'mux'], ['b', 20, 'vod', 'mux'], ['c', 30, 'vod', 'mux'],
    ['hold', 7, 'vod', 'mux'], ['unknown', null, 'vod', 'mux'],
    ['fraction', 10.25, 'vod', 'mux'],
    ['live', 10, 'live', 'mux'], ['youtube', 10, 'vod', 'youtube_playlist'],
  ] as const) {
    ids[key] = (await q('INSERT INTO mux_items(playback_id,label,duration_seconds,kind,source_type) VALUES($1,$1,$2,$3,$4) RETURNING id',
      [key, duration, kind, source]))[0].id;
  }
  let n = 0;
  const reset = async (playback = 'a', secondsAgo = 0, auto = true) => {
    await q('DELETE FROM video_queue');
    // Ensure fixture anchors differ even on a host with millisecond clocks.
    await q("UPDATE current_stream SET playback_updated_at='2000-01-01T00:00:00Z' WHERE id=1");
    await q(`UPDATE current_stream SET playback_id=$1,title=$1,kind='vod',source_type='mux',
      youtube_playlist_id=NULL,source_url=NULL,playout_mode='manual',playback_state='playing',
      playback_position=0,playback_updated_at=clock_timestamp()-$2::numeric*interval '1 second',
      hold_screen_enabled=false,hold_screen_mux_item_id=NULL,hold_screen_resume_playback_id=NULL,
      hold_screen_resume_position=NULL,hold_screen_resume_state=NULL,auto_advance_enabled=$3,
      last_playback_command='set_video',last_command_id=$4 WHERE id=1`, [playback, secondsAgo, auto, `fixture-${++n}`]);
  };
  const enqueue = (key: string) => rpc('enqueue_video($1,$2)', [ids[key], 'test:operator']);

  await reset('a', 4);
  await enqueue('b');
  const first = await snapshot();
  assert.equal(first.automation_status, 'armed');
  assert.equal(first.stream.playback_id, 'a');
  assert.equal((await q('SELECT count(*)::int AS n FROM video_queue'))[0].n, 1);
  assert.ok(Date.parse(first.next_transition_at) > Date.parse(first.server_now));
  const originSession = first.stream.playback_session_id;
  await q("UPDATE current_stream SET updated_by='metadata-only',show_poster=true WHERE id=1");
  const metadata = await stream();
  assert.equal(new Date(metadata.playback_updated_at).getTime(), Date.parse(first.stream.playback_updated_at));
  assert.equal(metadata.playback_session_id, originSession);
  assert.equal(Number(metadata.playback_revision), Number(first.stream.playback_revision));
  assert.equal(metadata.playback_elapsed_ms, 0);
  await q("UPDATE current_stream SET playout_mode='manual',last_playback_command='mode_change',last_command_id='redundant-mode' WHERE id=1");
  assert.equal((await stream()).playback_session_id, metadata.playback_session_id);
  assert.equal(new Date((await stream()).playback_updated_at).getTime(), new Date(metadata.playback_updated_at).getTime());
  console.log('PASS: pre-due reads and metadata updates preserve the timeline.');

  await reset('fraction', 0);
  const fractional = await snapshot();
  assert.equal(fractional.playback_duration_seconds, 10.25);
  assert.equal(Date.parse(fractional.next_transition_at) - Date.parse(fractional.stream.playback_updated_at), 10_250);
  await assert.rejects(q("INSERT INTO mux_items(playback_id,duration_seconds) VALUES('bad-finite','Infinity')"), /duration_finite_positive/);
  await assert.rejects(q("INSERT INTO mux_items(playback_id,duration_seconds) VALUES('bad-nan','NaN')"), /duration_finite_positive/);
  console.log('PASS: exact fractional asset duration is preserved; non-finite catalog durations are rejected.');

  await reset('a', 15);
  await enqueue('b'); await enqueue('c');
  const due = await snapshot();
  assert.equal(due.stream.playback_id, 'b');
  assert.equal(due.automation_status, 'armed');
  const pos = await rpc('playout_live_position((SELECT s FROM current_stream s WHERE id=1),clock_timestamp())');
  assert.ok(Number(pos) >= 5 && Number(pos) < 7, `Late tick retains original start: ${pos}`);
  assert.equal((await q('SELECT count(*)::int AS n FROM video_queue'))[0].n, 1);
  assert.notEqual(due.stream.playback_session_id, originSession);
  const repeated = await Promise.all(Array.from({ length: 16 }, snapshot));
  assert.ok(repeated.every((s) => s.stream.playback_id === 'b'));
  assert.equal((await q('SELECT count(*)::int AS n FROM video_queue'))[0].n, 1);
  console.log('PASS: late ticks catch up once; duplicate audience notifications cannot skip cues.');

  await reset('a', 35);
  await enqueue('b'); await enqueue('c');
  const catchup = await snapshot();
  assert.equal(catchup.stream.playback_id, 'c');
  assert.ok(Date.parse(catchup.next_transition_at) > Date.parse(catchup.server_now));
  assert.equal((await q('SELECT count(*)::int AS n FROM video_queue'))[0].n, 0);
  await reset('a', 61); await enqueue('b'); await enqueue('c');
  const exhausted = await snapshot();
  assert.equal(exhausted.automation_status, 'holding');
  assert.equal(exhausted.stream.hold_screen_enabled, true);
  assert.equal(exhausted.stream.playback_id, 'demo-playback-id');
  assert.equal(exhausted.stream.playback_state, 'playing');
  assert.equal(exhausted.next_transition_at, null);
  const exhaustedRevision = exhausted.stream.playback_revision;
  assert.equal((await snapshot()).stream.playback_revision, exhaustedRevision);
  await reset('a', 11);
  await q('UPDATE current_stream SET hold_screen_mux_item_id=$1 WHERE id=1', [ids.hold]);
  const configuredHold = await snapshot();
  assert.equal(configuredHold.automation_status, 'holding');
  assert.equal(configuredHold.stream.hold_screen_mux_item_id, ids.hold);
  assert.equal(configuredHold.playback_duration_seconds, 7);
  console.log('PASS: unattended catch-up consumes elapsed cues and enters configured or branded hold.');

  await reset('a', 4, false);
  const beforePause = await stream();
  const paused = await rpc('playback_command($1,$2,$3,$4,$5)', ['pause', null, 'pause-1', 'test', beforePause.playback_session_id]);
  assert.equal(paused.stream.playback_state, 'paused');
  assert.ok(Number(paused.stream.playback_position) >= 4 && Number(paused.stream.playback_position) < 6);
  const resumed = await rpc('playback_command($1,$2,$3,$4)', ['play', null, 'play-1', 'test']);
  assert.equal(resumed.stream.playback_state, 'playing');
  assert.equal(resumed.stream.playback_position, paused.stream.playback_position);
  const restart = await rpc('playback_command($1,$2,$3,$4)', ['restart', null, 'restart-1', 'test']);
  assert.equal(restart.stream.playback_position, 0);
  assert.notEqual(restart.stream.playback_session_id, resumed.stream.playback_session_id);
  const again = await rpc('playback_command($1,$2,$3,$4)', ['restart', null, 'restart-1', 'test']);
  assert.equal(again.duplicate, true);
  assert.equal(again.stream.playback_revision, restart.stream.playback_revision);
  await assert.rejects(rpc('playback_command($1,$2,$3,$4)', ['seek', 1, 'restart-1', 'test']), /different operation/);
  await assert.rejects(rpc('playback_command($1,$2,$3,$4,$5)', ['pause', null, 'stale-pause', 'test', beforePause.playback_session_id]), /Playback has changed/);
  await assert.rejects(rpc('playback_command($1,$2,$3,$4)', ['seek', 11, 'seek-too-far', 'test']), /exceeds/);
  await assert.rejects(rpc('playback_command($1,$2,$3,$4)', ['seek', 'NaN', 'seek-nan', 'test']), /finite/);
  const smallSeek = await rpc('playback_command($1,$2,$3,$4)', ['seek', 0.25, 'small-seek', 'test']);
  assert.equal(smallSeek.stream.playback_elapsed_ms, 0);
  assert.equal(Number(smallSeek.stream.playback_position), 0.25);
  assert.ok(Number(smallSeek.stream.playback_revision) > Number(restart.stream.playback_revision));
  console.log('PASS: pause/resume preserve live position; same-asset restart, idempotency, CAS, and tiny seeks work.');

  await reset('a', 4, false);
  const holdBefore = await stream();
  const hold = await rpc('toggle_hold($1,$2,$3,$4)', ['enable', null, 'test', 'hold-enable']);
  assert.ok(Number(hold.stream.hold_screen_resume_position) >= 4 && Number(hold.stream.hold_screen_resume_position) < 6);
  assert.notEqual(hold.stream.playback_session_id, holdBefore.playback_session_id);
  await q("UPDATE current_stream SET playback_updated_at=clock_timestamp()-interval '100 seconds' WHERE id=1");
  const unhold = await rpc('toggle_hold($1,$2,$3,$4)', ['disable', null, 'test', 'hold-disable']);
  assert.equal(unhold.stream.playback_id, 'a');
  assert.equal(unhold.stream.playback_position, hold.stream.hold_screen_resume_position);
  assert.equal(unhold.stream.playback_state, 'playing');
  assert.ok(Number(await rpc('playout_live_position((SELECT s FROM current_stream s WHERE id=1),clock_timestamp())')) < 6);
  console.log('PASS: hold duration never advances the paused program; resume is correctly anchored.');

  await reset('a', 0, false);
  const sameBefore = await stream();
  const setSame = await rpc('set_manual_stream($1,$2,$3,$4,$5,$6,$7,$8)', ['a', 'A again', 'vod', 'mux', null, null, 'test', 'same-set']);
  assert.notEqual(setSame.stream.playback_session_id, sameBefore.playback_session_id);
  await enqueue('a'); await enqueue('b');
  const queueNext = await rpc('advance_queue_command($1,$2,$3)', ['test', 'next-once', setSame.stream.playback_session_id]);
  assert.notEqual(queueNext.stream.playback_session_id, setSame.stream.playback_session_id);
  const queueRetry = await rpc('advance_queue_command($1,$2,$3)', ['test', 'next-once', setSame.stream.playback_session_id]);
  assert.equal(queueRetry.duplicate, true);
  assert.equal((await q('SELECT count(*)::int AS n FROM video_queue'))[0].n, 1);
  await assert.rejects(rpc('advance_queue_command($1,$2,$3)', ['test', 'stale-next', setSame.stream.playback_session_id]), /Playback has changed/);
  console.log('PASS: repeated assets create new occurrences; retrying Next does not consume a second video.');

  for (const invalid of ['unknown', 'live', 'youtube']) {
    await reset('a', 11);
    await q('INSERT INTO video_queue(mux_item_id,position) VALUES($1,1)', [ids[invalid]]);
    const blocked = await snapshot();
    assert.equal(blocked.automation_status, 'blocked-queue-item');
    assert.equal(blocked.stream.playback_id, 'a');
    assert.equal((await q('SELECT count(*)::int AS n FROM video_queue'))[0].n, 1);
    await assert.rejects(rpc('advance_queue_command($1,$2)', ['test', `invalid-${invalid}`]), /known positive duration/);
  }
  await reset('unknown', 200);
  assert.equal((await snapshot()).automation_status, 'missing-duration');
  await reset('a', 200, false);
  assert.equal((await snapshot()).automation_status, 'disabled');
  await q("UPDATE current_stream SET playout_mode='schedule' WHERE id=1");
  const modeSession = (await stream()).playback_session_id;
  assert.equal((await snapshot()).automation_status, 'schedule');
  await q("UPDATE current_stream SET playout_mode='manual' WHERE id=1");
  assert.notEqual((await stream()).playback_session_id, modeSession);
  await reset('unknown', 0, false);
  await assert.rejects(rpc('set_auto_advance($1,$2,$3)', [true, 'test', 'enable-invalid']), /positive duration/);
  await reset('a', 0, false);
  const autoBefore = await stream();
  await rpc('set_auto_advance($1,$2,$3)', [true, 'test', 'enable-valid']);
  assert.equal(new Date((await stream()).playback_updated_at).getTime(), new Date(autoBefore.playback_updated_at).getTime());
  assert.equal((await stream()).playback_session_id, autoBefore.playback_session_id);
  console.log('PASS: unsupported/missing-duration cues never disappear, and automation configuration is validated.');

  await reset('a', 4, false);
  const modeBefore = await stream();
  const noOpMode = await rpc('set_playout_mode($1,$2,$3)', ['manual', 'test', 'mode-noop']);
  assert.equal(noOpMode.stream.playback_session_id, modeBefore.playback_session_id);
  assert.equal(Date.parse(noOpMode.stream.playback_updated_at), new Date(modeBefore.playback_updated_at).getTime());
  const scheduleMode = await rpc('set_playout_mode($1,$2,$3)', ['schedule', 'test', 'mode-schedule']);
  assert.equal(scheduleMode.stream.playback_state, 'paused');
  assert.ok(Number(scheduleMode.stream.playback_position) >= 4 && Number(scheduleMode.stream.playback_position) < 6);
  await q("UPDATE current_stream SET playback_updated_at=clock_timestamp()-interval '100 days' WHERE id=1");
  const manualMode = await rpc('set_playout_mode($1,$2,$3)', ['manual', 'test', 'mode-manual']);
  assert.equal(manualMode.stream.playback_state, 'paused');
  assert.equal(manualMode.stream.playback_position, scheduleMode.stream.playback_position);
  assert.notEqual(manualMode.stream.playback_session_id, scheduleMode.stream.playback_session_id);
  const modeRetry = await rpc('set_playout_mode($1,$2,$3)', ['manual', 'test', 'mode-manual']);
  assert.equal(modeRetry.duplicate, true);
  assert.equal(modeRetry.stream.playback_revision, manualMode.stream.playback_revision);
  console.log('PASS: mode switches freeze/resume safely, redundant mode selections and retries preserve the clock.');

  // Real role permissions: not merely checking pg_policies text.
  await db.exec('SET ROLE anon');
  assert.equal((await q('SELECT count(*)::int AS n FROM current_stream'))[0].n, 1);
  await assert.rejects(q("UPDATE current_stream SET playback_position=0 WHERE id=1"), /permission denied/);
  await assert.rejects(q('DELETE FROM video_queue'), /permission denied/);
  await assert.rejects(rpc('advance_queue_next($1)', ['attacker']), /permission denied/);
  await assert.rejects(rpc('get_playout_snapshot()'), /permission denied/);
  await assert.rejects(rpc('delete_mux_item($1,$2)', [ids.hold, 'attacker']), /permission denied/);
  await assert.rejects(q('SELECT * FROM playout_commands'), /permission denied/);
  await db.exec('RESET ROLE; SET ROLE authenticated');
  await assert.rejects(q("UPDATE current_stream SET playback_state='playing' WHERE id=1"), /permission denied/);
  await assert.rejects(rpc('enqueue_video($1,$2)', [ids.a, 'attacker']), /permission denied/);
  await db.exec('RESET ROLE; SET ROLE service_role');
  assert.equal((await snapshot()).automation_status, 'disabled');
  await rpc('playback_command($1,$2,$3,$4)', ['pause', null, 'service-pause', 'service']);
  await rpc('enqueue_video($1,$2)', [ids.b, 'service']);
  await rpc('advance_queue_command($1,$2)', ['service', 'service-next']);
  await db.exec('RESET ROLE');
  await reset('a', 0, false);
  await assert.rejects(rpc('delete_mux_item($1,$2)', [ids.a, 'test']), /active, configured hold/);
  await q('UPDATE current_stream SET hold_screen_mux_item_id=$1 WHERE id=1', [ids.hold]);
  await assert.rejects(rpc('delete_mux_item($1,$2)', [ids.hold, 'test']), /active, configured hold/);
  await q("UPDATE current_stream SET hold_screen_resume_playback_id='b' WHERE id=1");
  await assert.rejects(rpc('delete_mux_item($1,$2)', [ids.b, 'test']), /resumable stream/);
  await q('UPDATE current_stream SET hold_screen_resume_playback_id=NULL WHERE id=1');
  await enqueue('b');
  await assert.rejects(rpc('delete_mux_item($1,$2)', [ids.b, 'test']), /Remove this item from the queue/);
  assert.equal((await q('SELECT count(*)::int AS n FROM video_queue WHERE mux_item_id=$1', [ids.b]))[0].n, 1);
  await db.exec('SET ROLE service_role');
  const removed = await rpc('delete_mux_item($1,$2)', [ids.unknown, 'service']);
  assert.equal(removed.success, true);
  assert.equal(removed.itemId, ids.unknown);
  await assert.rejects(rpc('delete_mux_item($1,$2)', [ids.unknown, 'service']), /Media item not found/);
  await db.exec('RESET ROLE');
  assert.equal((await q('SELECT count(*)::int AS n FROM mux_items WHERE id=$1', [ids.unknown]))[0].n, 0);
  assert.equal((await q("SELECT count(*)::int AS n FROM admin_actions WHERE action_type='media_delete'"))[0].n, 1);
  console.log('PASS: atomic catalog deletion protects active, configured/resumable hold, and queued assets.');
  // Applying twice must preserve active anchors/sessions and remain safe.
  const beforeMigration = await stream();
  await db.exec(readFileSync('sql/022_playout_hardening.sql', 'utf8'));
  assert.equal((await stream()).playback_session_id, beforeMigration.playback_session_id);
  assert.equal(new Date((await stream()).playback_updated_at).getTime(), new Date(beforeMigration.playback_updated_at).getTime());
  console.log('PASS: public reads remain available; public writes/RPCs are blocked; service role and repeat migration succeed.');
  console.log('All isolated database playout tests passed. No production data touched.');
  } finally {
    await db.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
