/** Real routes + isolated fixture only. Never reads .env or targets production. */
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';

const BASE = 'http://127.0.0.1:3116';
const FIXTURE = 'http://127.0.0.1:54339';
const KEY = 'playout-fixture-service';
const VIDEO_ID = 'AbCdE_fG-12';
const VIDEO_PLAYBACK = `youtube:video:${VIDEO_ID}`;
const VIDEO_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const TEST_IP = `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;

async function main() {
  const fixtureQuery = async (sql: string, args: unknown[] = []) => {
    const response = await fetch(FIXTURE + '/__fixture/query', {
      method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, args }),
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const api = async (path: string, cookie = '', body?: object, expected = 200) => {
    const response = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { cookie, Origin: BASE, 'Content-Type': 'application/json', 'x-forwarded-for': TEST_IP },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(result)}`);
    if (!path.startsWith('/api/auth/')) assert.match(response.headers.get('cache-control') || '', /no-store/);
    return { result, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
  };
  const lookup = `/api/admin/youtube-video?url=${encodeURIComponent(VIDEO_URL)}`;
  await api(lookup, '', undefined, 401);
  const cookie = (await api('/api/auth/admin-login', '', { password: 'local-playout-test-only' })).cookie;
  assert(cookie);
  const beforeLookup = (await fixtureQuery('SELECT * FROM current_stream WHERE id=1'))[0];
  const beforeItems = await fixtureQuery('SELECT id,playback_id FROM mux_items ORDER BY id');
  const unverified = (await api(lookup, cookie)).result;
  assert.equal(unverified.videoId, VIDEO_ID);
  assert.equal(unverified.durationSeconds, null);
  assert.equal(unverified.captionsAvailable, null);
  assert.equal(unverified.metadataVerified, false);
  assert.match(unverified.warning, /verify captions/);
  await api('/api/admin/youtube-video?url=https%3A%2F%2Fevil.test%2Fwatch', cookie, undefined, 400);
  assert.deepEqual((await fixtureQuery('SELECT * FROM current_stream WHERE id=1'))[0], beforeLookup);
  assert.deepEqual(await fixtureQuery('SELECT id,playback_id FROM mux_items ORDER BY id'), beforeItems);
  console.log('PASS: metadata preflight is admin-only, no-store and non-mutating; missing configuration is explicitly unverified.');

  const media = (body: object, expected = 201) => api('/api/admin/mux-items', cookie, body, expected);
  await media({ sourceType: 'youtube_video', sourceUrl: VIDEO_URL }, 400);
  await media({ sourceType: 'youtube_video', sourceUrl: VIDEO_URL, kind: 'live', durationSeconds: 10 }, 400);
  await media({ sourceType: 'youtube_video', sourceUrl: 'https://evil.test/watch?v=AbCdE_fG-12', durationSeconds: 10 }, 400);
  await media({ sourceType: 'youtube_video', sourceUrl: VIDEO_URL, durationSeconds: 0 }, 400);
  await media({ sourceType: 'youtube_video', sourceUrl: VIDEO_URL, durationSeconds: '10' }, 400);
  const existing = (await fixtureQuery('SELECT id FROM mux_items WHERE playback_id=$1', [VIDEO_PLAYBACK]))[0];
  let item;
  if (existing) {
    item = (await fixtureQuery('SELECT * FROM mux_items WHERE id=$1', [existing.id]))[0];
  } else {
    const added = (await media({ sourceType: 'youtube_video', sourceUrl: `https://youtu.be/${VIDEO_ID}?t=99&list=PL1234567890`, label: 'Isolated caption verification test', durationSeconds: 20.5 })).result;
    item = added.item;
    assert.equal(added.duration_source, 'operator');
    assert.equal(added.caption_status, 'unverified');
    assert.equal(added.metadata_verified, false);
    assert.match(added.warning, /Captions and embed availability are unverified/);
  }
  assert.equal(item.playback_id, VIDEO_PLAYBACK);
  assert.equal(item.source_type, 'youtube_video');
  assert.equal(item.source_url, VIDEO_URL);
  assert.equal(item.youtube_playlist_id, null);
  assert.equal(Number(item.duration_seconds), 20.5);
  await media({ sourceType: 'youtube_video', youtubeVideoId: VIDEO_ID, durationSeconds: 20.5 }, 409);
  console.log('PASS: single videos enter the same catalog with canonical metadata, fractional exact duration and clear caption uncertainty; invalid/duplicate imports are rejected.');

  await fixtureQuery('DELETE FROM video_queue');
  await fixtureQuery(`UPDATE current_stream SET playback_id='a',title='a',kind='vod',source_type='mux',
    source_url=NULL,youtube_playlist_id=NULL,playout_mode='manual',playback_state='playing',playback_position=0,
    playback_updated_at=clock_timestamp(),hold_screen_enabled=false,hold_screen_mux_item_id=NULL,
    hold_screen_resume_playback_id=NULL,hold_screen_resume_position=NULL,hold_screen_resume_state=NULL,
    auto_advance_enabled=false,last_playback_command='set_video',last_command_id=$1 WHERE id=1`, [randomUUID()]);
  await api('/api/admin/hold-screen', cookie, { action: 'set_item', muxItemId: item.id, commandId: randomUUID() });
  await api('/api/admin/hold-screen', cookie, { action: 'enable', commandId: randomUUID() });
  await fixtureQuery("UPDATE current_stream SET playback_updated_at=clock_timestamp()-interval '43.25 seconds' WHERE id=1");
  const tubeHold = (await api('/api/current')).result;
  assert.equal(tubeHold.isHoldScreen, true);
  assert.equal(tubeHold.playbackId, VIDEO_PLAYBACK);
  assert.equal(tubeHold.sourceType, 'youtube_video');
  assert.equal(tubeHold.sourceUrl, VIDEO_URL);
  assert.equal(tubeHold.youtubeVideoId, VIDEO_ID);
  assert.equal(Number(tubeHold.playbackDurationSeconds), 20.5);
  assert(tubeHold.playbackPositionSeconds >= 2.25 && tubeHold.playbackPositionSeconds < 5,
    `Finite YouTube hold uses modulo timeline, received ${tubeHold.playbackPositionSeconds}`);
  const storedHold = (await fixtureQuery('SELECT * FROM current_stream WHERE id=1'))[0];
  assert.equal(storedHold.source_type, 'mux', 'Hold projection never overwrites underlying program source');
  await api('/api/admin/hold-screen', cookie, { action: 'disable', commandId: randomUUID() });
  assert.equal((await api('/api/current')).result.playbackId, 'a');
  await fixtureQuery('UPDATE current_stream SET hold_screen_mux_item_id=NULL WHERE id=1');
  console.log('PASS: configured YouTube holds project source metadata and finite modulo timing while preserving/resuming the underlying Mux program.');
  await api('/api/admin/queue', cookie, { muxItemId: item.id }, 201);
  const queued = (await api('/api/admin/queue', cookie)).result.queue;
  assert.equal(queued[0].mux_items.source_type, 'youtube_video');
  await api('/api/admin/queue/auto-advance', cookie, { enabled: true, commandId: randomUUID() });
  await api('/api/admin/queue/next', cookie, { commandId: randomUUID() });
  const current = (await api('/api/current')).result;
  assert.equal(current.playbackId, VIDEO_PLAYBACK);
  assert.equal(current.sourceType, 'youtube_video');
  assert.equal(current.sourceUrl, VIDEO_URL);
  assert.equal(current.youtubeVideoId, VIDEO_ID);
  assert.equal(Number(current.playbackDurationSeconds), 20.5);
  assert.equal(current.automationStatus, 'armed');
  await api('/api/admin/set-current', cookie, { sourceType: 'youtube_video', playbackId: VIDEO_PLAYBACK,
    title: 'Direct YouTube test', commandId: randomUUID() });
  await api('/api/admin/set-current', cookie, { sourceType: 'youtube_video', playbackId: 'youtube:video:NotInLib123',
    title: 'Unregistered', commandId: randomUUID() }, 409);
  await fixtureQuery("UPDATE current_stream SET playback_updated_at=clock_timestamp()-interval '21 seconds' WHERE id=1");
  const exhausted = (await api('/api/current')).result;
  assert.equal(exhausted.isHoldScreen, true);
  assert.equal(exhausted.automationStatus, 'holding');
  assert.equal(exhausted.playbackId, 'demo-playback-id');
  console.log('PASS: authenticated queue/direct-cue endpoints carry YouTube source identity through the public snapshot and naturally return to hold at the authoritative deadline.');
  console.log('All local YouTube API checks passed. No live state touched.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
