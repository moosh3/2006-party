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
      '015_youtube_playlist_sources', '022_playout_hardening', '025_youtube_video_queue', '026_countdown_queue']) {
      await db.exec(readFileSync(`sql/${file}.sql`, 'utf8'));
    }
    const q = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows;
    const rpc = async (sql: string, args: unknown[] = []) => (await q(`SELECT ${sql} AS result`, args))[0].result;
    const state = async () => (await q('SELECT * FROM current_stream WHERE id=1'))[0];
    const snapshot = () => rpc('get_playout_snapshot()');

    const media = (await q("INSERT INTO mux_items(playback_id,label,duration_seconds,kind) VALUES('countdown','Song',240,'vod') RETURNING id"))[0].id;
    const custom = (await q("INSERT INTO mux_items(playback_id,label,duration_seconds,kind) VALUES('custom','Sketch',120,'vod') RETURNING id"))[0].id;
    const cue = (rank = 5, startSeconds = 50, durationSeconds = 15) => ({ rank, startSeconds, durationSeconds, bannerUrl: 'https://example.com/5.webm' });
    const save = (c: any, id: string | null = null, command = crypto.randomUUID()) => rpc('save_countdown_cue($1,$2,$3,$4,$5)', [media, JSON.stringify(c), 'test', id, command]);
    let sequence = 0;
    const next = () => rpc('advance_queue_command($1,$2)', ['test', `next-${++sequence}`]);
    const play = (action: string, position: number | null = null) => rpc('playback_command($1,$2,$3,$4)', [action, position, `play-${++sequence}`, 'test']);
    const age = (seconds: number) => q("UPDATE current_stream SET playback_updated_at=clock_timestamp()-$1::numeric*interval '1 second' WHERE id=1", [seconds]);
    await q("UPDATE current_stream SET auto_advance_enabled=false,hold_screen_enabled=false WHERE id=1");
    const command = crypto.randomUUID();
    const first = await save(cue(), null, command);
    assert.equal((await save(cue(), null, command)).id, first.id);
    assert.equal((await q('SELECT count(*)::int n FROM video_queue'))[0].n, 1);
    await assert.rejects(save(cue(4,50,30), null, command), /already used/);
    for (const invalid of [cue(0), cue(1), cue(5,0,16), cue(4,-1,30), cue(4,220,30), cue(4,0,0), { ...cue(), bannerUrl: 'javascript:alert(1)' }]) await assert.rejects(save(invalid), /Invalid countdown/);
    const second = await save(cue(4,80,30));
    await next();
    assert.equal(Number((await state()).playback_position), 50);
    assert.equal((await state()).countdown.rank, 5);
    assert.equal(Number((await snapshot()).playback_duration_seconds), 65);
    await assert.rejects(save(cue(5,0,15), first.id), /already played/);
    await save(cue(4,100,35), second.id);
    assert.equal((await state()).countdown.startSeconds, 50);
    assert.equal(Number((await q('SELECT duration_seconds FROM mux_items WHERE id=$1',[media]))[0].duration_seconds),240);
    await age(5);
    const paused = await play('pause');
    assert.ok(Number(paused.stream.playback_position)>=55);
    await play('play');
    await assert.rejects(play('seek',49), /precedes/);
    await assert.rejects(play('seek',66), /exceeds/);
    await play('restart');
    assert.equal(Number((await state()).playback_position),50);
    await play('seek',64);
    await age(5);
    const scheduled = await rpc('set_playout_mode($1,$2,$3)',['schedule','test','mode-schedule']);
    assert.equal(Number(scheduled.stream.playback_position),65);
    assert.equal((await snapshot()).automation_status,'schedule');
    const returned = await rpc('set_playout_mode($1,$2,$3)',['manual','test','mode-queue']);
    assert.equal(returned.stream.countdown.rank,5);
    assert.equal(returned.stream.playback_state,'paused');
    await play('restart');
    await rpc('toggle_hold($1,$2,$3,$4)', ['set_item', custom, 'test','hold-item']);
    await age(4);
    await rpc('toggle_hold($1,$2,$3,$4)', ['enable',null,'test','hold-on']);
    assert.equal((await state()).countdown.rank,5);
    assert.equal((await snapshot()).automation_status,'holding');
    await rpc('toggle_hold($1,$2,$3,$4)', ['disable',null,'test','hold-off']);
    assert.ok(Number((await state()).playback_position)>=54);
    await age(20);
    const stopped = await snapshot();
    assert.equal(stopped.stream.playback_state,'paused');
    assert.equal(Number(stopped.stream.playback_position),65);
    assert.equal((await q('SELECT count(*)::int n FROM video_queue'))[0].n,1);
    await play('restart');
    await rpc('set_auto_advance($1,$2,$3)',[true,'test','auto']);
    await age(18);
    const advanced = await snapshot();
    assert.equal(advanced.stream.countdown.rank,4);
    assert.equal(Number(advanced.stream.playback_position),100);
    assert.ok(Number(await rpc('playout_live_position((SELECT s FROM current_stream s WHERE id=1),clock_timestamp())'))>=103);
    assert.ok(Date.parse(advanced.next_transition_at)-Date.parse(advanced.server_now)>31000);
    const winner = await save({ ...cue(1,0,240), bannerUrl:null });
    await rpc('enqueue_video($1,$2)',[custom,'test']);
    await age(40);
    assert.equal((await snapshot()).stream.countdown.rank,1);
    assert.equal(Number((await snapshot()).playback_duration_seconds),240);
    await age(241);
    assert.equal((await snapshot()).stream.countdown,null);
    assert.equal((await snapshot()).stream.playback_id,'custom');
    await age(121);
    assert.equal((await snapshot()).automation_status,'holding');
    await save(cue()); await next();
    await rpc('set_manual_stream($1,$2,$3,$4,$5,$6,$7,$8)',['custom','Sketch','vod','mux',null,null,'test','direct']);
    assert.equal((await state()).countdown,null);
    // Invalid upcoming timing remains queued and blocks rather than skipping.
    await save(cue());
    await q('UPDATE mux_items SET duration_seconds=10 WHERE id=$1',[media]);
    await age(121);
    assert.equal((await snapshot()).automation_status,'blocked-queue-item');
    assert.equal((await q('SELECT count(*)::int n FROM video_queue'))[0].n,1);
    const before=await state(); const queueBefore=await q('SELECT * FROM video_queue');
    await db.exec(readFileSync('sql/026_countdown_queue.sql','utf8'));
    assert.deepEqual(await state(),before); assert.deepEqual(await q('SELECT * FROM video_queue'),queueBefore);
    await db.exec('SET ROLE anon');
    await assert.rejects(save(cue()),/permission denied/);
    await assert.rejects(snapshot(),/permission denied/);
    await db.exec('RESET ROLE; SET ROLE service_role');
    assert.equal((await snapshot()).automation_status,'blocked-queue-item');
    console.log('PASS countdown DB: validation, retries, active cue freeze, excerpt deadlines, late join, pause, restart, hold, seek bounds, winner, custom cues, exhaustion, repeat migration, permissions. No live state touched.');
  } finally { await db.close(); }
}
main().catch((error) => { console.error(error); process.exitCode=1; });
