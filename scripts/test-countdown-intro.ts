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


    const media=(await q("INSERT INTO mux_items(playback_id,label,duration_seconds,kind) VALUES('intro-song','Intro song',240,'vod') RETURNING id"))[0].id;
    const tube=(await q("INSERT INTO mux_items(playback_id,label,duration_seconds,kind,source_type,source_url) VALUES('youtube:video:dQw4w9WgXcQ','Tube',240,'vod','youtube_video','https://www.youtube.com/watch?v=dQw4w9WgXcQ') RETURNING id"))[0].id;
    // Install over an active legacy cue and an upcoming cue, preserving both.
    const legacy={rank:5,startSeconds:50,durationSeconds:15,bannerUrl:null};
    await rpc('save_countdown_cue($1,$2,$3,$4,$5)',[media,JSON.stringify(legacy),'test',null,crypto.randomUUID()]);
    await rpc('advance_queue_command($1,$2)',['test',crypto.randomUUID()]);
    await rpc('save_countdown_cue($1,$2,$3,$4,$5)',[media,JSON.stringify(legacy),'test',null,crypto.randomUUID()]);
    const legacyState=await state(),legacyQueue=await q('SELECT * FROM video_queue');
    await db.exec(readFileSync('sql/027_countdown_introductions.sql','utf8'));
    const {countdown_intro_remaining_seconds,...installedState}=await state();
    assert.equal(Number(countdown_intro_remaining_seconds),0);
    assert.deepEqual(installedState,legacyState);assert.deepEqual(await q('SELECT * FROM video_queue'),legacyQueue);
    await q('DELETE FROM video_queue');
    const cue={rank:5,startSeconds:50,durationSeconds:15,bannerUrl:null,introSeconds:3};
    let sequence=0;
    const save=(c:any=cue,id:string|null=null,command=crypto.randomUUID())=>rpc('save_countdown_cue($1,$2,$3,$4,$5)',[media,JSON.stringify(c),'test',id,command]);
    const next=()=>rpc('advance_queue_command($1,$2)',['test',`intro-next-${++sequence}`]);
    const play=(a:string,pos:number|null=null)=>rpc('playback_command($1,$2,$3,$4)',[a,pos,`intro-play-${++sequence}`,'test']);
    const hold=(a:string,item:string|null=null)=>rpc('toggle_hold($1,$2,$3,$4)',[a,item,'test',`intro-hold-${++sequence}`]);
    const age=(n:number)=>q("UPDATE current_stream SET playback_updated_at=clock_timestamp()-$1::numeric*interval '1 second' WHERE id=1",[n]);
    await q('UPDATE current_stream SET auto_advance_enabled=false,hold_screen_enabled=false WHERE id=1');
    for(const intro of [-1,11,null,'3',true]) await assert.rejects(save({...cue,introSeconds:intro}),/Invalid countdown/);
    const command=crypto.randomUUID();const first=await save(cue,null,command);
    assert.equal((await save(cue,null,command)).id,first.id);
    await next();let s=await snapshot();
    assert.equal(Number(s.playback_position_seconds),50);assert(Number(s.playback_start_delay_seconds)>2.8);
    assert.equal(Number(s.playback_duration_seconds),65);
    const session=s.stream.playback_session_id;
    await age(1);await play('pause');s=await snapshot();const left=Number(s.playback_start_delay_seconds);
    assert(left>1.8&&left<=2);await age(30);s=await snapshot();assert.equal(Number(s.playback_start_delay_seconds),left);
    assert.equal(Number(s.playback_position_seconds),50);
    await play('play');await age(1);await hold('set_item',tube);await hold('enable');
    const held=Number((await state()).countdown_intro_remaining_seconds);assert(held>0.7&&held<=1);
    await age(20);s=await snapshot();assert.equal(Number(s.playback_start_delay_seconds),0);assert.equal(s.automation_status,'holding');
    await hold('disable');s=await snapshot();assert(Number(s.playback_start_delay_seconds)>held-0.1);assert.equal(Number(s.playback_position_seconds),50);
    await age(4);s=await snapshot();assert(Number(s.playback_position_seconds)>53);assert.equal(Number(s.playback_start_delay_seconds),0);
    await play('pause');await play('play');assert.equal(Number((await snapshot()).playback_start_delay_seconds),0);
    await play('restart');s=await snapshot();assert.notEqual(s.stream.playback_session_id,session);assert(Number(s.playback_start_delay_seconds)>2.8);
    await assert.rejects(rpc('playback_command($1,$2,$3,$4,$5)',['pause',null,crypto.randomUUID(),'test',session]),/Playback has changed/);
    await play('seek',52);s=await snapshot();assert.equal(Number(s.playback_start_delay_seconds),0);assert(Number(s.playback_position_seconds)>=52);
    await play('restart');await age(1);
    await rpc('set_playout_mode($1,$2,$3)',['schedule','test',crypto.randomUUID()]);
    await age(100);await rpc('set_playout_mode($1,$2,$3)',['manual','test',crypto.randomUUID()]);
    s=await snapshot();assert.equal(s.stream.playback_state,'paused');assert(Number(s.playback_start_delay_seconds)>1.8);
    await play('restart');await age(18);s=await snapshot();assert.equal(s.stream.playback_state,'paused');assert.equal(Number(s.playback_position_seconds),65);
    await save({...cue,rank:1,startSeconds:0,durationSeconds:240});await next();s=await snapshot();
    assert.equal(Number(s.playback_position_seconds),0);assert(Number(s.playback_start_delay_seconds)>2.8);assert.equal(Number(s.playback_duration_seconds),240);
    await save();await save({...cue,rank:4,startSeconds:100,durationSeconds:30,introSeconds:2});await next();
    await rpc('set_auto_advance($1,$2,$3)',[true,'test',crypto.randomUUID()]);await age(19);s=await snapshot();
    assert.equal(s.stream.countdown.rank,4);assert.equal(Number(s.playback_position_seconds),100);assert(Number(s.playback_start_delay_seconds)>0.8);
    assert(Date.parse(s.next_transition_at)-Date.parse(s.server_now)>30000);
    await age(3);s=await snapshot();assert(Number(s.playback_position_seconds)>=101);
    assert.equal(Number((await q('SELECT duration_seconds FROM mux_items WHERE id=$1',[media]))[0].duration_seconds),240);
    const before=await state();const queueBefore=await q('SELECT * FROM video_queue');
    await db.exec(readFileSync('sql/027_countdown_introductions.sql','utf8'));
    assert.deepEqual(await state(),before);assert.deepEqual(await q('SELECT * FROM video_queue'),queueBefore);
    await db.exec('SET ROLE anon');await assert.rejects(snapshot(),/permission denied/);await db.exec('RESET ROLE; SET ROLE service_role');
    assert.equal((await snapshot()).stream.countdown.rank,4);
    console.log('PASS title-card database: input validation, retries, source freeze, pause/resume, finite YouTube hold, restart, stale session guards, seek, mode switch, complete excerpt, full winner, consecutive countdown intros, auto-advance deadline, intact media duration, repeat migration, permissions. Disposable PostgreSQL only.');
  } finally { await db.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
