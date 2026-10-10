/** Real API regressions against scripts/playout-preview.ts only.
 * No configurable production URL, dotenv import, or live database writes. */
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomInt, randomUUID } from 'node:crypto';
import { decodeJwt, jwtVerify } from 'jose';
import { getProgramPlaybackToken } from '../lib/mux';

const BASE = 'http://127.0.0.1:3116';
const FIXTURE = 'http://127.0.0.1:54339';
const KEY = 'playout-fixture-service';
const RUN_ID = randomUUID().slice(0, 8);
// Each isolated run models a different viewer, without resetting/bypassing the
// real route rate limiter when the suite is run repeatedly within one minute.
const TEST_IP = `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;

async function main() {
  async function fixture(path: string, body?: object) {
    const response = await fetch(FIXTURE + path, {
      method: body ? 'POST' : 'GET', headers: { apikey: KEY, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  }
  const sql = (statement: string, args: unknown[] = []) => fixture('/__fixture/query', { sql: statement, args });
  async function request(path: string, body?: object, cookie = '', expected = 200, method?: 'DELETE') {
    const response = await fetch(BASE + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', cookie, Origin: BASE, 'x-forwarded-for': TEST_IP },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
    assert.match(response.headers.get('cache-control') || '', /no-store/, `${path} must never be cached`);
    return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
  }
  // Authentication response is not a playout snapshot and has its own cache policy.
  const authRequest = async () => {
    const response = await fetch(BASE + '/api/auth/admin-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, 'x-forwarded-for': TEST_IP },
      body: JSON.stringify({ password: 'local-playout-test-only' }),
    });
    assert.equal(response.status, 200, await response.text());
    return response.headers.get('set-cookie')?.split(';')[0] || '';
  };
  for (const path of ['/api/admin/playback-control', '/api/admin/set-current', '/api/admin/hold-screen', '/api/admin/queue/auto-advance', '/api/admin/mux-items']) {
    await request(path, undefined, '', 401);
  }
  await request('/api/admin/queue/next', { commandId: randomUUID() }, '', 401);
  await request(`/api/admin/mux-items?id=${randomUUID()}`, undefined, '', 401, 'DELETE');
  const cookie = await authRequest();
  assert(cookie, 'Admin session cookie is set');
  const control = (action: string, extra: object = {}, expected = 200) =>
    request('/api/admin/playback-control', { action, commandId: randomUUID(), ...extra }, cookie, expected);
  const media = (body: object, expected = 201) => request('/api/admin/mux-items', body, cookie, expected);
  const deleteMedia = (id: string, expected = 200) => request(`/api/admin/mux-items?id=${id}`, undefined, cookie, expected, 'DELETE');
  const hold = (action: string, extra: object = {}) =>
    request('/api/admin/hold-screen', { action, commandId: randomUUID(), ...extra }, cookie);
  const state = async () => (await sql('SELECT * FROM current_stream WHERE id=1'))[0];
  const count = async () => Number((await sql('SELECT count(*)::int AS n FROM video_queue'))[0].n);
  const ids: Record<string, string> = {};
  for (const row of await sql('SELECT id,playback_id FROM mux_items')) ids[row.playback_id] = row.id;
  const reset = async (playback = 'a', secondsAgo = 0, auto = false) => {
    await sql('DELETE FROM video_queue');
    return (await sql(`UPDATE current_stream SET playback_id=$1,title=$1,kind='vod',source_type='mux',
      youtube_playlist_id=NULL,source_url=NULL,playout_mode='manual',playback_state='playing',
      playback_position=0,playback_updated_at=clock_timestamp()-$2::numeric*interval '1 second',
      hold_screen_enabled=false,hold_screen_mux_item_id=NULL,hold_screen_resume_playback_id=NULL,
      hold_screen_resume_position=NULL,hold_screen_resume_state=NULL,auto_advance_enabled=$3,
      last_playback_command='set_video',last_command_id=$4 WHERE id=1 RETURNING *`,
      [playback, secondsAgo, auto, `api-fixture-${randomUUID()}`]))[0];
  };
  const enqueue = async (key: string) => {
    const response = await fetch(BASE + '/api/admin/queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie, Origin: BASE, 'x-forwarded-for': TEST_IP },
      body: JSON.stringify({ muxItemId: ids[key] }),
    });
    assert.equal(response.status, 201, await response.text());
  };
  // A browser may already be polling this fixture. Prepare queue contents with
  // automation off, then arm/backdate in ONE statement so it never sees a
  // deliberately overdue clip with a temporarily empty preparation queue.
  const armClock = async (secondsAgo: number) => (await sql(`UPDATE current_stream SET
    auto_advance_enabled=true,playback_updated_at=clock_timestamp()-$1::numeric*interval '1 second'
    WHERE id=1 RETURNING *`, [secondsAgo]))[0];
  const current = async () => (await request('/api/current')).data;
  console.log('PASS: protected controls require a valid admin session; snapshots are no-store.');

  await reset(); await enqueue('a'); await enqueue('b'); await enqueue('c');
  const readQueue = async () => {
    const response = await fetch(BASE + '/api/admin/queue', { headers: { cookie } });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data.queue;
  };
  const queue = await readQueue();
  assert.deepEqual(queue.map((item: any) => item.mux_items.playback_id), ['a', 'b', 'c']);
  const reorder = await fetch(BASE + '/api/admin/queue', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie, Origin: BASE },
    body: JSON.stringify({ items: [queue[2], queue[0], queue[1]].map((item, i) => ({ id: item.id, position: i + 1 })) }),
  });
  assert.equal(reorder.status, 200, await reorder.text());
  assert.deepEqual((await readQueue()).map((item: any) => item.mux_items.playback_id), ['c', 'a', 'b']);
  const removed = await fetch(BASE + `/api/admin/queue/${queue[2].id}`, { method: 'DELETE', headers: { cookie, Origin: BASE } });
  assert.equal(removed.status, 200, await removed.text());
  assert.deepEqual((await readQueue()).map((item: any) => Number(item.position)), [1, 2]);
  const absentQueueItem = await fetch(BASE + `/api/admin/queue/${queue[2].id}`, { method: 'DELETE', headers: { cookie, Origin: BASE } });
  assert.equal(absentQueueItem.status, 404, await absentQueueItem.text());
  const forbiddenQueueDelete = await fetch(BASE + `/api/admin/queue/${queue[0].id}`, { method: 'DELETE', headers: { Origin: BASE } });
  assert.equal(forbiddenQueueDelete.status, 401, await forbiddenQueueDelete.text());
  console.log('PASS: queue reorder receives a JSON array and removal preserves contiguous positions with 404/401 protection.');

  await reset('a', 1, true); await enqueue('b'); await enqueue('c');
  const before = await current();
  assert.equal(before.playbackId, 'a');
  assert(before.playbackPositionSeconds >= 1 && before.playbackPositionSeconds < 10);
  assert.equal(before.token, 'unsigned', 'No inherited live signing credentials');
  for (const secret of ['updated_by', 'hold_screen_resume_playback_id', 'admin_user', 'last_command_id']) assert.equal(before[secret], undefined);
  const fakeEnded = (await request('/api/playout/manual-ended', {
    playbackId: 'a', playbackSessionId: before.playbackSessionId, duration: 0, durationSeconds: 0,
  })).data;
  assert.equal(fakeEnded.reason, 'server-deadline-not-due');
  assert.equal((await current()).playbackSessionId, before.playbackSessionId);
  assert.equal(await count(), 2, 'Even a short-video fake ended event cannot skip a cue');

  await reset(); await enqueue('b'); await enqueue('c'); await armClock(15);
  const tick = await current();
  assert.equal(tick.playbackId, 'b', 'GET snapshot catches up without any ended event');
  assert(tick.playbackPositionSeconds >= 5 && tick.playbackPositionSeconds < 9);
  assert.equal(await count(), 1);
  assert(Date.parse(tick.nextTransitionAt) > Date.parse(tick.serverNow));

  await reset(); await enqueue('b'); await enqueue('c');
  const lateOrigin = await armClock(11);
  const notices = await Promise.all(Array.from({ length: 16 }, () => request('/api/playout/manual-ended', {
    playbackId: 'a', playbackSessionId: lateOrigin.playback_session_id,
  })));
  assert(notices.every(({ data }) => data.success));
  assert.equal((await current()).playbackId, 'b');
  assert.equal(await count(), 1, 'Concurrent late ended events consume exactly one cue');
  console.log('PASS: fake early ended events do nothing; GET-driven and concurrent late transitions are exact and idempotent.');

  await reset(); await enqueue('a'); await enqueue('b');
  const original = await state();
  await request('/api/admin/queue/next', {}, cookie, 400);
  const nextId = randomUUID();
  const next = (await request('/api/admin/queue/next', { commandId: nextId, expectedSessionId: original.playback_session_id }, cookie)).data;
  assert.equal(next.advanced_to.playback_id, 'a');
  assert.notEqual(next.stream.playback_session_id, original.playback_session_id, 'A repeated asset is a new occurrence');
  const duplicate = (await request('/api/admin/queue/next', { commandId: nextId, expectedSessionId: original.playback_session_id }, cookie)).data;
  assert.equal(duplicate.duplicate, true);
  assert.equal(await count(), 1);
  await request('/api/admin/queue/next', { commandId: randomUUID(), expectedSessionId: original.playback_session_id }, cookie, 409);
  await request('/api/admin/queue/next', { commandId: nextId, expectedSessionId: next.stream.playback_session_id }, cookie, 409);
  assert.equal(await count(), 1, 'Stale/reused command IDs do not consume the next cue');
  await request('/api/admin/queue/next', { commandId: randomUUID(), expectedSessionId: next.stream.playback_session_id }, cookie);
  const setId = randomUUID();
  const set = (await request('/api/admin/set-current', { playbackId: 'b', title: 'B again', commandId: setId }, cookie)).data;
  const replay = (await request('/api/admin/set-current', { playbackId: 'b', title: 'B again', commandId: setId }, cookie)).data;
  assert.equal(replay.duplicate, true);
  assert.equal(replay.stream.playback_session_id, set.stream.playback_session_id);
  const setAgain = (await request('/api/admin/set-current', { playbackId: 'b', title: 'B another occurrence', commandId: randomUUID() }, cookie)).data;
  assert.notEqual(setAgain.stream.playback_session_id, set.stream.playback_session_id);
  console.log('PASS: Next retries do not double-skip; compare-and-set rejects stale operators; repeated assets get new sessions.');

  await reset('a', 4);
  const paused = (await control('pause')).data;
  assert.equal(paused.playback_state, 'paused');
  assert(paused.playback_position >= 4 && paused.playback_position < 8);
  await sql("UPDATE current_stream SET playback_updated_at=clock_timestamp()-interval '100 seconds' WHERE id=1");
  assert.equal((await current()).playbackPositionSeconds, paused.playback_position, 'Paused timeline does not run');
  const resumed = (await control('play')).data;
  assert.equal(resumed.playback_state, 'playing');
  assert.equal(resumed.playback_position, paused.playback_position);
  assert((await current()).playbackPositionSeconds < 9);
  await control('seek', { position: '1' }, 400);
  await control('seek', { position: -1 }, 400);
  await control('seek', { position: 11 }, 400);
  const restarted = (await control('restart')).data;
  assert.notEqual(restarted.playback_session_id, resumed.playback_session_id);

  await reset('a', 4);
  const enableId = randomUUID();
  await hold('enable', { commandId: enableId });
  const held = await state();
  assert(held.hold_screen_resume_position >= 4 && held.hold_screen_resume_position < 8);
  const publicHold = await current();
  assert.equal(publicHold.isHoldScreen, true);
  assert.equal(publicHold.playbackId, 'demo-playback-id');
  await hold('enable', { commandId: enableId });
  assert.equal((await state()).playback_session_id, held.playback_session_id);
  await sql("UPDATE current_stream SET playback_updated_at=clock_timestamp()-interval '100 seconds' WHERE id=1");
  await hold('disable');
  const restored = await current();
  assert.equal(restored.playbackId, 'a');
  assert(restored.playbackPositionSeconds >= held.hold_screen_resume_position && restored.playbackPositionSeconds < 9);
  await hold('set_item', { muxItemId: ids.hold }); await hold('enable');
  assert.equal((await current()).playbackId, 'hold');
  assert.equal((await current()).playbackDurationSeconds, 7);
  console.log('PASS: pause/resume and hold toggles preserve the authoritative program position, not a stale base.');

  await reset('a', 11, true);
  const exhausted = await current();
  assert.equal(exhausted.isHoldScreen, true);
  assert.equal(exhausted.automationStatus, 'holding');
  const holdSession = exhausted.playbackSessionId;
  assert.equal((await current()).playbackSessionId, holdSession);
  await reset(); await enqueue('b'); await enqueue('c'); await armClock(35);
  assert.equal((await current()).playbackId, 'c', 'Long unattended gaps consume elapsed cues at their original deadlines');
  await reset('unknown');
  const arm = (await request('/api/admin/queue/auto-advance', { enabled: true, commandId: randomUUID() }, cookie, 409)).data;
  assert.match(arm.error, /positive duration/);
  const unknown = (await media({ playbackId: `another-unknown-${RUN_ID}`, label: 'Manual only' })).data;
  assert.equal(unknown.item.duration_seconds, null);
  assert.match(unknown.warning, /manual playback/);
  await media({ playbackId: 'negative', durationSeconds: -1 }, 400);
  await media({ playbackId: 'bad-string', durationSeconds: 'NaN' }, 400);
  await media({ playbackId: 'wrong-kind', kind: 'movie', durationSeconds: 10 }, 400);
  const fractional = (await media({ playbackId: `fractional-api-${RUN_ID}`, durationSeconds: 10.25 })).data;
  assert.equal(Number(fractional.item.duration_seconds), 10.25);
  await reset();
  await sql('INSERT INTO video_queue(mux_item_id,position) VALUES($1,1)', [ids.unknown]);
  await armClock(15);
  const blocked = await current();
  assert.equal(blocked.automationStatus, 'blocked-queue-item');
  assert.equal(blocked.playbackId, 'a');
  assert.equal(await count(), 1);
  console.log('PASS: queue exhaustion enters hold; unknown/invalid durations block automatic playback without dropping cues.');

  await reset(); await enqueue('b');
  await deleteMedia(ids.a, 409);
  await hold('set_item', { muxItemId: ids.hold });
  await deleteMedia(ids.hold, 409);
  await hold('enable');
  // Make the inactive program reachable only through its saved resume slot.
  await sql("UPDATE current_stream SET playback_id='demo-playback-id' WHERE id=1");
  await deleteMedia(ids.a, 409);
  await deleteMedia(ids.b, 409);
  await deleteMedia(fractional.item.id);
  await deleteMedia(fractional.item.id, 404);
  const racing = (await media({ playbackId: `catalog-race-${RUN_ID}`, durationSeconds: 12 })).data.item;
  const enqueueRacing = fetch(BASE + '/api/admin/queue', {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie, Origin: BASE, 'x-forwarded-for': TEST_IP },
    body: JSON.stringify({ muxItemId: racing.id }),
  });
  const deleteRacing = fetch(BASE + `/api/admin/mux-items?id=${racing.id}`, {
    method: 'DELETE', headers: { cookie, Origin: BASE, 'x-forwarded-for': TEST_IP },
  });
  const outcomes = await Promise.all([enqueueRacing, deleteRacing]);
  assert(['201,409', '404,200'].includes(outcomes.map((response) => response.status).join(',')),
    `Concurrent enqueue/delete must leave the item protected or absent: ${outcomes.map((response) => response.status).join(',')}`);
  assert.equal(Number((await sql(`SELECT count(*)::int AS n FROM video_queue q
    LEFT JOIN mux_items m ON m.id=q.mux_item_id WHERE m.id IS NULL`))[0].n), 0);
  console.log('PASS: active, hold, resume, and queued catalog items are protected; deletion is atomic with concurrent enqueue.');

  try {
    await fixture('/__fixture/database', { available: false });
    const unavailable = (await request('/api/current', undefined, '', 503)).data;
    assert.equal(unavailable.playbackId, undefined, 'A database outage must never look like a fresh demo video');
    assert.equal(unavailable.token, undefined);
  } finally { await fixture('/__fixture/database', { available: true }); }
  const sample = await fixture('/__fixture/health');
  await reset(sample.sampleId, 40, false);
  await sql("UPDATE current_stream SET title='Isolated Mux sync rehearsal' WHERE id=1");
  const browser = await current();
  assert.equal(browser.playbackId, sample.sampleId);
  assert(browser.playbackPositionSeconds >= 40);
  console.log('PASS: unavailable database returns 503 with no fallback clip or token. No production data touched.');
  console.log(`Browser fixture restored: ${BASE}/stage, full official sample at 40 seconds, automatic playback off.`);
  await testProgramTokenCache();
}

async function testProgramTokenCache() {
  const fields = ['NODE_ENV', 'NEXT_PUBLIC_DEV_MODE', 'NEXT_PUBLIC_SUPABASE_URL', 'MUX_SIGNING_KEY_ID', 'MUX_SIGNING_KEY_PRIVATE', 'MUX_TOKEN_ID', 'MUX_TOKEN_SECRET'];
  const previous = Object.fromEntries(fields.map((field) => [field, process.env[field]]));
  try {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    Object.assign(process.env, {
      NODE_ENV: 'test', NEXT_PUBLIC_DEV_MODE: 'false', NEXT_PUBLIC_SUPABASE_URL: FIXTURE,
      MUX_SIGNING_KEY_ID: `isolated-token-${randomUUID()}`,
      MUX_SIGNING_KEY_PRIVATE: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      MUX_TOKEN_ID: '', MUX_TOKEN_SECRET: '',
    });
    const [first, concurrent] = await Promise.all([
      getProgramPlaybackToken('isolated-token-asset'), getProgramPlaybackToken('isolated-token-asset'),
    ]);
    assert.notEqual(first.token, 'unsigned');
    assert.equal(first.token, concurrent.token);
    assert.equal(first.expiresAt, new Date(Number(decodeJwt(first.token).exp) * 1000).toISOString());
    await jwtVerify(first.token, keys.publicKey, { audience: 'v', subject: 'isolated-token-asset' });
    assert.equal((await getProgramPlaybackToken('isolated-token-asset')).token, first.token);
    console.log('PASS: signed program tokens stay stable between snapshots; actual expiry and signature validate using an isolated generated key.');
  } finally {
    for (const field of fields) {
      if (previous[field] === undefined) delete process.env[field];
      else process.env[field] = previous[field];
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
