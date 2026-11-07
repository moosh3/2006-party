/** Real embedded PostgreSQL, isolated from the live show. Never reads .env. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { countdownAiredSince } from '../lib/scores';

const BEFORE_030 = ['001_schema', '004_synchronized_playback', '005_event_poster_mode', '006_video_queue',
  '008_auto_advance_lock', '009_queue_transaction_functions', '010_playback_elapsed_time', '011_hold_screen',
  '012_stream_resume_improvements', '013_fix_sync_restarts', '014_showtime_playout_and_queue',
  '015_youtube_playlist_sources', '022_playout_hardening', '025_youtube_video_queue', '026_countdown_queue',
  '027_countdown_introductions', '028_scene_cues'];

async function main() {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    for (const file of BEFORE_030) await db.exec(readFileSync(`sql/${file}.sql`, 'utf8'));
    const q = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows;
    const rpc = async (sql: string, args: unknown[] = []) => (await q(`SELECT ${sql} AS result`, args))[0].result;
    let sequence = 0;
    const id = (prefix: string) => `${prefix}-${++sequence}`;
    const next = () => rpc('advance_queue_command($1,$2)', ['test', id('next')]);
    await q("UPDATE current_stream SET auto_advance_enabled=false,hold_screen_enabled=false WHERE id=1");

    // Installing over a live scene keeps the stream and queue untouched.
    await rpc('queue_scene_cue($1,$2,$3,$4)', ['rules-of-the-game', 60, 'test', id('scene')]);
    await next();
    const song = (await q("INSERT INTO mux_items(playback_id,label,duration_seconds,kind) VALUES('song-5','Hips Don''t Lie',240,'vod') RETURNING id"))[0].id;
    await rpc('save_countdown_cue($1,$2,$3,$4,$5)', [song, JSON.stringify({ rank: 5, startSeconds: 30, durationSeconds: 15, introSeconds: 3 }), 'test', null, id('cd')]);
    const before = await q('SELECT to_jsonb(s) j FROM current_stream s UNION ALL SELECT to_jsonb(v) FROM video_queue v');
    const migration = readFileSync('sql/030_check_our_scores.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(await q('SELECT to_jsonb(s) j FROM current_stream s UNION ALL SELECT to_jsonb(v) FROM video_queue v'), before,
      'Installing 030 twice leaves the active scene and queue unchanged');

    // The countdown cue's rank is now in the advance log; other cues log null.
    await next();
    const sceneAdvance = (await q("SELECT details FROM admin_actions WHERE action_type='queue_advance' ORDER BY id"))[0].details;
    assert.equal(sceneAdvance.countdown ?? null, null, 'Cues advanced before 030 have no countdown field');
    const songAdvance = (await q("SELECT details FROM admin_actions WHERE action_type='queue_advance' ORDER BY id DESC LIMIT 1"))[0].details;
    assert.equal(songAdvance.countdown.rank, 5);
    assert.equal(songAdvance.to_title, "Hips Don't Lie");

    // Let's Check Our Scores is a known scene with its own label.
    await rpc('queue_scene_cue($1,$2,$3,$4)', ['check-our-scores', 120, 'test', id('scene')]);
    await next();
    const s = (await q('SELECT * FROM current_stream WHERE id=1'))[0];
    assert.match(s.playback_id, /^scene:check-our-scores:/);
    assert.equal(s.title, "Let's Check Our Scores");
    const scoresAdvance = (await q("SELECT details FROM admin_actions WHERE action_type='queue_advance' ORDER BY id DESC LIMIT 1"))[0].details;
    assert.equal(scoresAdvance.countdown, null);
    await assert.rejects(rpc('queue_scene_cue($1,$2,$3,$4)', ['people-we-know', 60, 'test', id('scene')]), /Unknown scene/);

    // The Scores window reads aired countdown cues from that log.
    const details = (await q("SELECT details FROM admin_actions WHERE action_type='queue_advance' ORDER BY id DESC")).map((r: any) => ({ details: r.details }));
    assert.deepEqual(countdownAiredSince(details), [{ rank: 5, title: "Hips Don't Lie" }]);

    assert.equal((await q("SELECT has_function_privilege('anon','public.queue_scene_cue(text,numeric,text,text)','EXECUTE') ok"))[0].ok, false);
    console.log('PASS: migration 030 — installs over a live scene unchanged, logs countdown ranks on advance, adds the Scores scene, rejects unknown scenes, keeps permissions.');
  } finally {
    await db.close();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
