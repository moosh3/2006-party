/** Real embedded PostgreSQL, isolated from the live show. Never reads .env. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { COUNTDOWN_PRESENTERS, countdownError } from '../lib/countdown';

const BEFORE_031 = ['001_schema', '004_synchronized_playback', '005_event_poster_mode', '006_video_queue',
  '008_auto_advance_lock', '009_queue_transaction_functions', '010_playback_elapsed_time', '011_hold_screen',
  '012_stream_resume_improvements', '013_fix_sync_restarts', '014_showtime_playout_and_queue',
  '015_youtube_playlist_sources', '022_playout_hardening', '025_youtube_video_queue', '026_countdown_queue',
  '027_countdown_introductions', '028_scene_cues', '030_check_our_scores'];

async function main() {
  // Client rules match the database: optional, and only the six Sprites.
  const base = { rank: 3, startSeconds: 0, durationSeconds: 45, bannerUrl: null };
  assert.equal(countdownError(base, 180), null);
  assert.equal(countdownError({ ...base, presenter: 'jen' }, 180), null);
  assert.notEqual(countdownError({ ...base, presenter: 'bob' as never }, 180), null);
  assert.deepEqual(COUNTDOWN_PRESENTERS, { 5: 'emma', 4: 'yongwoo', 3: 'jen', 2: 'mk', 1: 'lip' }, "MK's run-of-show presenters");
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    for (const file of BEFORE_031) await db.exec(readFileSync(`sql/${file}.sql`, 'utf8'));
    const q = async (sql: string, args: unknown[] = []) => (await db.query<any>(sql, args)).rows;
    const rpc = async (sql: string, args: unknown[] = []) => (await q(`SELECT ${sql} AS result`, args))[0].result;
    let sequence = 0;
    const id = (prefix: string) => `${prefix}-${++sequence}`;
    await q("UPDATE current_stream SET auto_advance_enabled=false,hold_screen_enabled=false WHERE id=1");
    const song = (await q("INSERT INTO mux_items(playback_id,label,duration_seconds,kind) VALUES('song','Crazy',180,'vod') RETURNING id"))[0].id;
    const save = (cue: object, queueId: string | null = null) =>
      rpc('save_countdown_cue($1,$2,$3,$4,$5)', [song, JSON.stringify(cue), 'test', queueId, id('cd')]);

    // A legacy cue queued before 031 stays valid and unchanged.
    const legacy = await save({ rank: 4, startSeconds: 10, durationSeconds: 30, introSeconds: 3 });
    const before = await q('SELECT to_jsonb(s) j FROM current_stream s UNION ALL SELECT to_jsonb(v) FROM video_queue v');
    const migration = readFileSync('sql/031_countdown_presenters.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(await q('SELECT to_jsonb(s) j FROM current_stream s UNION ALL SELECT to_jsonb(v) FROM video_queue v'), before,
      'Installing 031 twice leaves the stream and queue unchanged');
    assert.equal(await rpc('countdown_presenter_supported()'), true);

    // Presenters are kept, validated and editable; other fields are unchanged.
    const withPresenter = await save({ rank: 5, startSeconds: 0, durationSeconds: 15, introSeconds: 3, presenter: 'emma' });
    assert.equal(withPresenter.countdown.presenter, 'emma');
    assert.equal(withPresenter.countdown.introSeconds, 3);
    for (const bad of ['bob', '', 5, null]) {
      await assert.rejects(save({ rank: 3, startSeconds: 0, durationSeconds: 45, presenter: bad }), /Invalid countdown/, `presenter ${String(bad)} is rejected`);
    }
    const edited = await save({ rank: 4, startSeconds: 10, durationSeconds: 30, introSeconds: 3, presenter: 'yongwoo' }, legacy.id);
    assert.equal(edited.countdown.presenter, 'yongwoo');
    const cleared = await save({ rank: 4, startSeconds: 10, durationSeconds: 30, introSeconds: 3 }, legacy.id);
    assert.equal(cleared.countdown.presenter, undefined, 'Saving without a presenter removes it');

    // The presenter travels with the cue into the active stream and the log.
    await rpc('advance_queue_command($1,$2)', ['test', id('next')]);
    await rpc('advance_queue_command($1,$2)', ['test', id('next')]);
    const s = (await q('SELECT countdown FROM current_stream WHERE id=1'))[0].countdown;
    assert.equal(s.presenter, 'emma');
    assert.equal(s.rank, 5);
    const logged = (await q("SELECT details FROM admin_actions WHERE action_type='queue_advance' ORDER BY id DESC LIMIT 1"))[0].details;
    assert.equal(logged.countdown.presenter, 'emma');

    for (const sig of ['countdown_presenter_supported()', 'save_countdown_cue(uuid,jsonb,text,uuid,text)']) {
      assert.equal((await q(`SELECT has_function_privilege('anon','public.${sig}','EXECUTE') ok`))[0].ok, false);
    }
    console.log('PASS: migration 031 — installs over queued legacy cues unchanged, keeps/validates/edits/clears presenters, carries them to the active cue and log, permissions.');
  } finally {
    await db.close();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
