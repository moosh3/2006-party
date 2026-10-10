/** Real embedded PostgreSQL, isolated from the live show. Never reads .env. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

async function main() {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    for (const file of ['001_schema', '004_synchronized_playback', '005_event_poster_mode', '006_video_queue',
      '008_auto_advance_lock', '009_queue_transaction_functions', '010_playback_elapsed_time', '011_hold_screen',
      '012_stream_resume_improvements', '013_fix_sync_restarts', '014_showtime_playout_and_queue',
      '015_youtube_playlist_sources', '022_playout_hardening', '025_youtube_video_queue']) {
      await db.exec(readFileSync(`sql/${file}.sql`, 'utf8'));
    }
    const q = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows;
    const rpc = async (sql: string, args: unknown[] = []) => (await q(`SELECT ${sql} AS result`, args))[0].result;
    const state = async () => (await q('SELECT * FROM current_stream WHERE id=1'))[0];
    const snapshot = () => rpc('get_playout_snapshot()');
    const tube = 'youtube:video:AbCdE_fG-12';
    const tubeUrl = 'https://www.youtube.com/watch?v=AbCdE_fG-12';
    const ids: Record<string, string> = {};
    for (const [playback, duration, source, url] of [['a', 10, 'mux', null], ['b', 30, 'mux', null],
      [tube, 20.5, 'youtube_video', tubeUrl], ['ambient', null, 'youtube_playlist', 'https://youtube.com/playlist?list=PL1234567890']] as const) {
      ids[playback] = (await q('INSERT INTO mux_items(playback_id,label,duration_seconds,kind,source_type,source_url) VALUES($1,$1,$2,\'vod\',$3,$4) RETURNING id', [playback, duration, source, url]))[0].id;
    }
    let n = 0;
    const reset = async (playback = 'a', ago = 0, auto = true) => {
      await q('DELETE FROM video_queue');
      await q(`UPDATE current_stream SET playback_id=$1,title=$1,kind='vod',source_type=$2,source_url=$3,
        youtube_playlist_id=NULL,playout_mode='manual',playback_state='playing',playback_position=0,
        playback_updated_at=clock_timestamp()-$4::numeric*interval '1 second',hold_screen_enabled=false,
        hold_screen_mux_item_id=NULL,hold_screen_resume_playback_id=NULL,hold_screen_resume_position=NULL,
        hold_screen_resume_state=NULL,auto_advance_enabled=$5,last_playback_command='set_video',last_command_id=$6 WHERE id=1`,
        [playback, playback === tube ? 'youtube_video' : 'mux', playback === tube ? tubeUrl : null, ago, auto, `fixture-${++n}`]);
    };
    const enqueue = (playback: string) => rpc('enqueue_video($1,$2)', [ids[playback], 'test:operator']);
    await reset('a', 15); await enqueue(tube); await enqueue('b');
    const first = await snapshot();
    assert.equal(first.stream.playback_id, tube);
    assert.equal(first.stream.source_type, 'youtube_video');
    assert.equal(first.stream.source_url, tubeUrl);
    assert.equal(first.stream.youtube_playlist_id, null);
    assert.equal(Number(first.playback_duration_seconds), 20.5);
    assert.equal(first.automation_status, 'armed');
    assert.ok(Number(await rpc('playout_live_position((SELECT s FROM current_stream s WHERE id=1),clock_timestamp())')) >= 5);
    const session = first.stream.playback_session_id;
    const repeats = await Promise.all(Array.from({ length: 12 }, snapshot));
    assert(repeats.every((row) => row.stream.playback_session_id === session));
    assert.equal((await q('SELECT count(*)::int AS n FROM video_queue'))[0].n, 1);
    await q("UPDATE current_stream SET playback_updated_at=clock_timestamp()-interval '25 seconds' WHERE id=1");
    const muxNext = await snapshot();
    assert.equal(muxNext.stream.playback_id, 'b');
    assert.equal(muxNext.stream.source_type, 'mux');
    assert.equal(muxNext.stream.source_url, null);
    assert.notEqual(muxNext.stream.playback_session_id, session);
    await q("UPDATE current_stream SET playback_updated_at=clock_timestamp()-interval '31 seconds' WHERE id=1");
    assert.equal((await snapshot()).automation_status, 'holding');
    console.log('PASS: Mux → YouTube → Mux → hold share finite deadlines, catch-up, metadata and unique sessions; duplicate reads never skip.');

    await reset(tube, 4, false);
    const paused = await rpc('playback_command($1,$2,$3,$4)', ['pause', null, 'tube-pause', 'test']);
    assert.equal(paused.stream.playback_state, 'paused');
    assert(Number(paused.stream.playback_position) >= 4);
    const resumed = await rpc('playback_command($1,$2,$3,$4)', ['play', null, 'tube-play', 'test']);
    assert.equal(resumed.stream.playback_position, paused.stream.playback_position);
    await assert.rejects(rpc('playback_command($1,$2,$3,$4)', ['seek', 21, 'tube-seek-too-far', 'test']), /exceeds/);
    await rpc('toggle_hold($1,$2,$3,$4)', ['set_item', ids[tube], 'test', 'tube-hold-set']);
    const held = await rpc('toggle_hold($1,$2,$3,$4)', ['enable', null, 'test', 'tube-hold-enable']);
    assert.equal(held.stream.source_type, 'youtube_video');
    const unheld = await rpc('toggle_hold($1,$2,$3,$4)', ['disable', null, 'test', 'tube-hold-disable']);
    assert.equal(unheld.stream.playback_id, tube);
    assert.equal(unheld.stream.source_url, tubeUrl);
    assert.equal(unheld.stream.playback_position, held.stream.hold_screen_resume_position);
    await rpc('set_auto_advance($1,$2,$3)', [true, 'test', 'tube-auto-on']);
    assert.equal((await snapshot()).automation_status, 'armed');
    await enqueue(tube); await enqueue('b');
    const advanced = await rpc('advance_queue_command($1,$2,$3)', ['test', 'tube-next-once', unheld.stream.playback_session_id]);
    const duplicate = await rpc('advance_queue_command($1,$2,$3)', ['test', 'tube-next-once', unheld.stream.playback_session_id]);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.stream.playback_session_id, advanced.stream.playback_session_id);
    assert.notEqual(advanced.stream.playback_session_id, unheld.stream.playback_session_id);
    await assert.rejects(rpc('advance_queue_command($1,$2,$3)', ['test', 'tube-stale-next', unheld.stream.playback_session_id]), /Playback has changed/);
    console.log('PASS: YouTube pause/seek/resume, configured holds, same-asset occurrences, auto-advance, command retries and stale-session protection work.');

    await reset('a', 0, false);
    await assert.rejects(enqueue('ambient'), /Mux or YouTube video/);
    assert.equal(await rpc('playout_is_queue_media(NULL::public.mux_items)'), false);
    await q('INSERT INTO video_queue(mux_item_id,position) VALUES($1,1)', [ids.ambient]);
    await q("UPDATE current_stream SET auto_advance_enabled=true,playback_updated_at=clock_timestamp()-interval '11 seconds' WHERE id=1");
    const blockedAmbient = await snapshot();
    assert.equal(blockedAmbient.automation_status, 'blocked-queue-item');
    assert.equal(blockedAmbient.stream.playback_id, 'a');
    assert.equal((await q('SELECT count(*)::int AS n FROM video_queue'))[0].n, 1);
    await reset('a', 0, false);
    await assert.rejects(rpc('set_manual_stream($1,$2,$3,$4,$5,$6,$7,$8)', ['youtube:video:NotInLib123', 'Missing', 'vod', 'youtube_video', null, 'https://www.youtube.com/watch?v=NotInLib123', 'test', 'tube-unregistered']), /Add this YouTube video/);
    const direct = await rpc('set_manual_stream($1,$2,$3,$4,$5,$6,$7,$8)', [tube, 'Captioned direct cue', 'vod', 'youtube_video', null, tubeUrl, 'test', 'tube-direct']);
    assert.equal(direct.stream.source_type, 'youtube_video');
    assert.equal(direct.stream.source_url, tubeUrl);
    await assert.rejects(rpc('delete_mux_item($1,$2)', [ids[tube], 'test']), /active, configured hold/);
    await reset(); await enqueue(tube);
    await assert.rejects(rpc('delete_mux_item($1,$2)', [ids[tube], 'test']), /Remove this item/);
    for (const [id, duration, kind, url] of [['youtube:video:TooShort', 10, 'vod', tubeUrl],
      ['youtube:video:BadDur_1234', null, 'vod', 'https://www.youtube.com/watch?v=BadDur_1234'],
      ['youtube:video:BadKind1234', 10, 'live', 'https://www.youtube.com/watch?v=BadKind1234'],
      ['youtube:video:BadUrl_1234', 10, 'vod', 'https://evil.test/']] as const) {
      await assert.rejects(q('INSERT INTO mux_items(playback_id,duration_seconds,kind,source_type,source_url) VALUES($1,$2,$3,\'youtube_video\',$4)', [id, duration, kind, url]), /youtube_video_shape/);
    }
    const before = await state();
    const queueBefore = await q('SELECT * FROM video_queue ORDER BY position');
    await db.exec(readFileSync('sql/025_youtube_video_queue.sql', 'utf8'));
    assert.deepEqual(await state(), before);
    assert.deepEqual(await q('SELECT * FROM video_queue ORDER BY position'), queueBefore);
    await db.exec('SET ROLE anon');
    await assert.rejects(snapshot(), /permission denied/);
    await assert.rejects(enqueue(tube), /permission denied/);
    await db.exec('RESET ROLE; SET ROLE service_role');
    assert.equal((await snapshot()).automation_status, 'armed');
    await db.exec('RESET ROLE');
    console.log('PASS: playlists remain unqueueable, unregistered/invalid YouTube items are rejected, deletion stays safe, repeat migration preserves live state and service-only privileges.');
    console.log('All YouTube queue DB scenarios passed. No production state touched.');
  } finally { await db.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
