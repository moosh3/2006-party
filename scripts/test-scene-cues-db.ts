/** Real embedded PostgreSQL, isolated from the live show. Never reads .env. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const BEFORE_028 = ['001_schema', '004_synchronized_playback', '005_event_poster_mode', '006_video_queue',
  '008_auto_advance_lock', '009_queue_transaction_functions', '010_playback_elapsed_time', '011_hold_screen',
  '012_stream_resume_improvements', '013_fix_sync_restarts', '014_showtime_playout_and_queue',
  '015_youtube_playlist_sources', '022_playout_hardening', '025_youtube_video_queue', '026_countdown_queue',
  '027_countdown_introductions'];

async function main() {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    for (const file of BEFORE_028) await db.exec(readFileSync(`sql/${file}.sql`, 'utf8'));
    const q = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows;
    const rpc = async (sql: string, args: unknown[] = []) => (await q(`SELECT ${sql} AS result`, args))[0].result;
    const state = async () => (await q('SELECT * FROM current_stream WHERE id=1'))[0];
    const snapshot = () => rpc('get_playout_snapshot()');
    let sequence = 0;
    const id = (prefix: string) => `${prefix}-${++sequence}`;
    const next = () => rpc('advance_queue_command($1,$2)', ['test', id('next')]);
    const play = (action: string, position: number | null = null) =>
      rpc('playback_command($1,$2,$3,$4)', [action, position, id('play'), 'test']);
    const hold = (action: string) => rpc('toggle_hold($1,$2,$3,$4)', [action, null, 'test', id('hold')]);
    const age = (seconds: number) =>
      q("UPDATE current_stream SET playback_updated_at=clock_timestamp()-$1::numeric*interval '1 second' WHERE id=1", [seconds]);
    const queue = (length: number, scene = 'rules-of-the-game', command = id('scene')) =>
      rpc('queue_scene_cue($1,$2,$3,$4)', [scene, length, 'test', command]);

    // Installing over a live legacy cue keeps the stream, queue and anchor untouched.
    const intro = (await q("INSERT INTO mux_items(playback_id,label,duration_seconds,kind) VALUES('welcome','Welcome',30,'vod') RETURNING id"))[0].id;
    const ads = (await q("INSERT INTO mux_items(playback_id,label,duration_seconds,kind) VALUES('ads','Ads 2',20,'vod') RETURNING id"))[0].id;
    await q("UPDATE current_stream SET auto_advance_enabled=false,hold_screen_enabled=false WHERE id=1");
    await rpc('enqueue_video($1,$2)', [intro, 'test']);
    await next();
    await rpc('enqueue_video($1,$2)', [ads, 'test']);
    const before = await q('SELECT to_jsonb(s) j FROM current_stream s UNION ALL SELECT to_jsonb(v) FROM video_queue v');
    const migration = readFileSync('sql/028_scene_cues.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(await q('SELECT to_jsonb(s) j FROM current_stream s UNION ALL SELECT to_jsonb(v) FROM video_queue v'), before,
      'Installing 028 twice leaves the active cue and queue unchanged');

    // Queueing is validated, idempotent and appends after existing cues.
    for (const bad of [0, -5, 7201]) await assert.rejects(queue(bad), /Scene length/);
    await assert.rejects(queue(90, 'people-we-know'), /Unknown scene/);
    const command = id('scene');
    const queued = await queue(90.5, 'rules-of-the-game', command);
    assert.equal((await queue(90.5, 'rules-of-the-game', command)).id, queued.id, 'A retried command returns the same cue');
    await assert.rejects(queue(60, 'rules-of-the-game', command), /already used/);
    const order = await q('SELECT m.source_type, m.label, m.duration_seconds FROM video_queue v JOIN mux_items m ON m.id=v.mux_item_id ORDER BY v.position');
    assert.deepEqual(order.map((r: any) => [r.source_type ?? 'mux', r.label, Number(r.duration_seconds)]),
      [['mux', 'Ads 2', 20], ['scene', 'Rules of the Game', 90.5]], 'Selecting or queueing never starts a scene');
    assert.equal((await state()).playback_id, 'welcome');
    const sceneItem = (await q("SELECT * FROM mux_items WHERE source_type='scene'"))[0];
    assert.match(sceneItem.playback_id, /^scene:rules-of-the-game:[0-9a-f-]{36}$/);

    // Scenes never carry countdown metadata, and cannot be set or held directly.
    await assert.rejects(rpc('save_countdown_cue($1,$2,$3,$4,$5)', [sceneItem.id,
      JSON.stringify({ rank: 3, startSeconds: 0, durationSeconds: 45 }), 'test', null, id('countdown')]), /Invalid countdown/);
    await assert.rejects(rpc('set_manual_stream($1,$2,$3,$4,$5,$6,$7,$8)', [sceneItem.playback_id, 'Rules', 'vod', 'scene', null, null, 'test', id('set')]),
      /Invalid stream configuration/);
    await assert.rejects(rpc('toggle_hold($1,$2,$3,$4)', ['set_item', sceneItem.id, 'test', id('hold')]), /not found/);
    await assert.rejects(q("INSERT INTO mux_items(playback_id,label,kind,source_type,duration_seconds) VALUES('scene:bad','x','vod','scene',10)"),
      /scene_shape/);

    // The scene runs on the database clock with its exact length.
    await next();
    await next();
    let s = await state();
    assert.equal(s.source_type, 'scene');
    assert.equal(s.playback_id, sceneItem.playback_id);
    assert.equal(s.countdown, null);
    assert.equal(Number((await snapshot()).playback_duration_seconds), 90.5);
    await age(10);
    const paused = await play('pause');
    assert.ok(Number(paused.stream.playback_position) >= 10, 'Pause preserves elapsed scene time');
    await play('play');
    await hold('enable');
    await hold('disable');
    s = await state();
    assert.equal(s.source_type, 'scene', 'Hold resumes the scene');
    assert.ok(Number(s.playback_position) >= 10);
    await play('restart');
    assert.equal(Number((await state()).playback_position), 0);

    // Auto-advance accepts a scene and hands off at its exact deadline.
    await rpc('set_auto_advance($1,$2,$3)', [true, 'test', id('auto')]);
    const after = (await q("INSERT INTO mux_items(playback_id,label,duration_seconds,kind) VALUES('ads-3','Ads 3',25,'vod') RETURNING id"))[0].id;
    await rpc('enqueue_video($1,$2)', [after, 'test']);
    let snap = await snapshot();
    assert.equal(snap.automation_status, 'armed');
    const deadline = (await q("SELECT EXTRACT(epoch FROM $1::timestamptz - playback_updated_at)::numeric AS d FROM current_stream WHERE id=1",
      [snap.next_transition_at]))[0].d;
    assert.equal(Number(deadline), 90.5, 'Deadline is the exact fractional scene length');
    await age(91);
    snap = await snapshot();
    assert.equal(snap.stream.playback_id, 'ads-3');
    assert.ok(Number(snap.playback_position_seconds) < 1, 'Next cue starts at the scene deadline, not the poll time');

    // A queued scene ahead of other cues does not block auto-advance.
    await queue(5);
    await age(27);
    snap = await snapshot();
    assert.equal(snap.stream.source_type, 'scene', 'The clock advances from a video into a queued scene');
    assert.equal(snap.automation_status, 'armed');
    await age(31);
    snap = await snapshot();
    assert.equal(snap.stream.hold_screen_enabled, true, 'Queue exhaustion after a scene uses the hold screen');

    for (const fn of ['queue_scene_cue(text,numeric,text,text)', 'get_playout_snapshot()']) {
      assert.equal((await q(`SELECT has_function_privilege('anon','public.${fn}','EXECUTE') ok`))[0].ok, false);
    }
    console.log('PASS: scene cue migration, validation, idempotency, queue order, countdown/set/hold exclusion, clock, pause/hold/restart, auto-advance deadline, installation preservation and permissions.');
  } finally {
    await db.close();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
