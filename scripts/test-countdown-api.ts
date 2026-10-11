/** Disposable local fixture only. Never imports credentials or accepts a target URL. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const BASE = 'http://127.0.0.1:3116';
const FIXTURE = 'http://127.0.0.1:54339';
async function main() {
  async function sql(statement: string, args: unknown[] = []) {
    const response = await fetch(FIXTURE + '/__fixture/query', { method: 'POST', headers: { apikey: 'playout-fixture-service', 'Content-Type':'application/json' }, body: JSON.stringify({ sql: statement, args }) });
    assert.equal(response.status,200); return response.json();
  }
  const auth = await fetch(BASE+'/api/auth/admin-login',{method:'POST',headers:{'Content-Type':'application/json',Origin:BASE},body:JSON.stringify({password:'local-playout-test-only'})});
  assert.equal(auth.status,200); const cookie=auth.headers.get('set-cookie')!.split(';')[0];
  async function request(path: string, body?: object, status = 200, authorized = true) {
    const response=await fetch(BASE+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:BASE,cookie:authorized?cookie:''},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json(); assert.equal(response.status,status,JSON.stringify(data)); return data;
  }
  await request('/api/admin/queue/countdown',{},401,false);
  await request('/api/admin/queue/countdown',{countdown:{}},400);
  await sql('DELETE FROM video_queue');
  await sql("UPDATE current_stream SET auto_advance_enabled=false,hold_screen_enabled=false,countdown=null WHERE id=1");
  const media=(await sql("SELECT id,duration_seconds FROM mux_items WHERE duration_seconds>200 LIMIT 1"))[0];
  const cue = {rank:5,startSeconds:50,durationSeconds:15,bannerUrl:null};
  const body={muxItemId:media.id,countdown:cue,commandId:randomUUID()};
  const first=await request('/api/admin/queue/countdown',body,201);
  assert.equal((await request('/api/admin/queue/countdown',body,201)).item.id,first.item.id);
  await request('/api/admin/queue/countdown',{...body,commandId:randomUUID(),countdown:{...cue,startSeconds:240}},400);
  await request('/api/admin/queue/countdown',{...body,commandId:randomUUID(),countdown:{...cue,bannerUrl:'javascript:alert(1)'}},400);
  const queue=await request('/api/admin/queue');
  assert.equal(queue.queue.length,1); assert.deepEqual(queue.queue[0].countdown,cue);
  await request('/api/admin/queue/countdown',{...body,queueId:first.item.id,commandId:randomUUID(),countdown:{...cue,startSeconds:60}});
  await request('/api/admin/queue/next',{commandId:randomUUID()});
  const stream=await request('/api/current');
  assert.equal(stream.countdown.startSeconds,60); assert.equal(stream.clipEndSeconds,75);
  assert.ok(stream.playbackPositionSeconds>=60 && stream.playbackPositionSeconds<75);
  await request('/api/admin/queue/countdown',{...body,queueId:first.item.id,commandId:randomUUID()},409);
  await sql("UPDATE current_stream SET playback_updated_at=clock_timestamp()-interval '17 seconds' WHERE id=1");
  const stopped=await request('/api/current'); assert.equal(stopped.playbackState,'paused'); assert.equal(stopped.playbackPositionSeconds,75);
  await request('/api/admin/hold-screen',{action:'enable',commandId:randomUUID()});
  assert.equal((await request('/api/current')).countdown,null);
  await request('/api/admin/hold-screen',{action:'disable',commandId:randomUUID()});
  assert.equal((await request('/api/current')).countdown.rank,5);
  const winner=await request('/api/admin/queue/countdown',{...body,commandId:randomUUID(),countdown:{rank:1,startSeconds:0,durationSeconds:Number(media.duration_seconds),bannerUrl:null}},201);
  assert.equal(winner.item.countdown.durationSeconds,Number(media.duration_seconds));
  await request('/api/admin/queue/countdown',{...body,commandId:randomUUID(),countdown:{rank:4,startSeconds:80,durationSeconds:30,bannerUrl:'/2006/does-not-exist.webm'}},201);
  console.log('PASS countdown API: authentication, validation, no duplicate retry, joined queue metadata, editing, GO, public excerpt clock, end pause, hold suppression/resume, full winner. Local fixture only.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
