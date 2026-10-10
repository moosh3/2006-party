import assert from 'node:assert/strict';
import {
  applySynchronousPlaybackCorrection,
  getPlaybackCorrection,
  isPlaybackSnapshot,
  makePlaybackAnchor,
  projectPlaybackPosition,
  snapshotIsNewer,
  type PlaybackSnapshot,
  type SyncMediaState,
} from '../lib/playback-sync';

const snapshot: PlaybackSnapshot = {
  playbackId: 'fixture-vod', sourceType: 'mux', playbackSessionId: 'cue-123',
  playbackRevision: 3, serverNow: '2026-10-08T18:00:00.000Z',
  playbackState: 'playing', playbackPositionSeconds: 120, playbackDurationSeconds: 600,
};
const anchor = makePlaybackAnchor(snapshot, 1000, 200);
const media: SyncMediaState = {
  currentTime: 120.1, readyState: 1, paused: false, seeking: false, ended: false, duration: 600,
};
let checks = 0;
function test(name: string, run: () => void) { run(); checks++; console.log(`PASS ${name}`); }

test('server-sampled position advances using monotonic elapsed and half RTT', () => {
  assert.equal(projectPlaybackPosition(anchor, 6000), 125.1);
});
test('viewer wall-clock skew cannot change playback position', () => {
  const original = Date.now;
  try {
    Date.now = () => 0;
    assert.equal(projectPlaybackPosition(anchor, 6000), 125.1);
    Date.now = () => Number.MAX_SAFE_INTEGER;
    assert.equal(projectPlaybackPosition(anchor, 6000), 125.1);
  } finally { Date.now = original; }
});
test('paused cue ignores receipt delay and RTT', () => {
  assert.equal(projectPlaybackPosition({ ...anchor, playbackState: 'paused' }, 90000), 120);
});
test('negative monotonic elapsed is safely bounded', () => {
  assert.equal(projectPlaybackPosition(anchor, 0), 120.1);
});
test('poor-connection latency estimate is bounded', () => {
  assert.equal(makePlaybackAnchor(snapshot, 0, 60000).roundTripMs, 2000);
});
test('hold video wraps the shared clock across any number of loops', () => {
  assert.equal(projectPlaybackPosition({ ...anchor, playbackPositionSeconds: 0 }, 63000, { hold: true, duration: 10 }), 2.1000000000000014);
});
test('finished VOD target cannot seek beyond duration', () => {
  assert.equal(projectPlaybackPosition(anchor, 999000), 599.95);
});
test('server revision rejects late responses even with a later sample time', () => {
  assert.equal(snapshotIsNewer({ ...snapshot, playbackRevision: 2, serverNow: '2026-10-08T19:00:00Z' }, snapshot), false);
  assert.equal(snapshotIsNewer({ ...snapshot, playbackRevision: 4 }, snapshot), true);
});
test('same revision rejects an older sampled response', () => {
  assert.equal(snapshotIsNewer({ ...snapshot, serverNow: '2026-10-08T17:59:59Z' }, snapshot), false);
});
test('bad clock/position/revision values never enter the sync loop', () => {
  assert.equal(isPlaybackSnapshot(snapshot), true);
  for (const position of [NaN, Infinity, -1]) {
    assert.equal(isPlaybackSnapshot({ ...snapshot, playbackPositionSeconds: position }), false);
  }
  assert.equal(isPlaybackSnapshot({ ...snapshot, playbackRevision: -1 }), false);
  assert.equal(isPlaybackSnapshot({ ...snapshot, playbackSessionId: '' }), false);
  assert.equal(isPlaybackSnapshot({ ...snapshot, serverNow: 'nonsense' }), false);
});
test('before metadata, no seek or play is marked successful', () => {
  assert.deepEqual(getPlaybackCorrection({ ...media, currentTime: 0, readyState: 0, paused: true }, anchor, 6000, { force: true }), {
    seekTo: null, playbackRate: 1, action: null,
  });
});
test('metadata readiness retries late-join seek before the first play', () => {
  const events: string[] = [];
  const mock = {
    ...media, currentTime: 0, paused: true, playbackRate: 1,
    pause() { events.push('pause'); },
  };
  const correction = getPlaybackCorrection(mock, anchor, 6000, { force: true });
  assert.equal(applySynchronousPlaybackCorrection(mock, correction), true);
  // This is exactly where VideoPlayer calls safePlay, after its sync helper.
  events.push(`play at ${mock.currentTime}`);
  assert.deepEqual(events, ['play at 125.1']);
});
test('unchanged server anchor still corrects a stalled viewer on the next tick', () => {
  assert.equal(getPlaybackCorrection(media, anchor, 1000).seekTo, null);
  assert.equal(getPlaybackCorrection(media, anchor, 8000).seekTo, 127.1);
});
test('locked viewer pause is corrected even when the server command is unchanged', () => {
  assert.equal(getPlaybackCorrection({ ...media, paused: true }, anchor, 1000).action, 'play');
});
test('seek in progress is retried after seeked rather than fought', () => {
  assert.equal(getPlaybackCorrection({ ...media, seeking: true }, anchor, 8000).seekTo, null);
  assert.equal(getPlaybackCorrection({ ...media, seeking: false }, anchor, 8000).seekTo, 127.1);
});
test('small drift uses bounded catchup rather than repeated audible seeks', () => {
  assert.equal(getPlaybackCorrection({ ...media, currentTime: 119.5 }, anchor, 1000).playbackRate, 1.03);
  assert.equal(getPlaybackCorrection({ ...media, currentTime: 120.7 }, anchor, 1000).playbackRate, 0.97);
  assert.equal(getPlaybackCorrection(media, anchor, 1000).playbackRate, 1);
});
test('paused server cue seeks to its exact frozen position and pauses locally', () => {
  const correction = getPlaybackCorrection({ ...media, currentTime: 125 }, { ...anchor, playbackState: 'paused' }, 90000);
  let paused = false;
  const mock = { currentTime: 125, playbackRate: 1.03, pause() { paused = true; } };
  assert.equal(applySynchronousPlaybackCorrection(mock, correction), false);
  assert.equal(mock.currentTime, 120);
  assert.equal(mock.playbackRate, 1);
  assert.equal(paused, true);
});
test('ended VOD is not restarted at its final frame while server advances', () => {
  assert.equal(getPlaybackCorrection({ ...media, currentTime: 600, ended: true, paused: true }, anchor, 999000).action, null);
});
test('explicit restart can recover an already ended element', () => {
  const restarted = { ...anchor, playbackPositionSeconds: 0, roundTripMs: 0 };
  const correction = getPlaybackCorrection({ ...media, currentTime: 600, ended: true, paused: true }, restarted, 1000, { force: true });
  assert.equal(correction.seekTo, 0);
  assert.equal(correction.action, 'play');
});
test('hold loop can restart an ended element at projected shared position', () => {
  const correction = getPlaybackCorrection({ ...media, currentTime: 10, duration: 10, ended: true, paused: true }, { ...anchor, playbackPositionSeconds: 0 }, 63000, { hold: true });
  assert.ok(correction.seekTo !== null && correction.seekTo < 10);
  assert.equal(correction.action, 'play');
});
test('live streams never receive VOD epoch seeking or drift playback rates', () => {
  const correction = getPlaybackCorrection({ ...media, currentTime: 50000, duration: Infinity, paused: true }, anchor, 8000, { live: true, force: true });
  assert.deepEqual(correction, { seekTo: null, playbackRate: 1, action: 'play' });
});
console.log(`Playback sync: ${checks} isolated checks passed; no database or production writes.`);
