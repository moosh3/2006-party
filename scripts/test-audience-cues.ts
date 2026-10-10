import assert from 'node:assert/strict';
import { getAudienceCueFrame, getAudienceCueKey, type AudienceCue, type AudienceCueAction } from '../lib/audience-cues';
import type { ProgramStream } from '../lib/program-stream';

const stream: ProgramStream = {
  playbackId: 'fixture-media', playbackSessionId: 'fixture-occurrence', playbackRevision: 3,
  serverNow: '2026-10-09T18:00:00Z', playbackState: 'playing', playbackPositionSeconds: 10,
  playbackDurationSeconds: 100, snapshotReceivedAt: 1000, snapshotRoundTripMs: 0,
  token: 'fixture-token', expiresAt: '2026-10-09T19:00:00Z', title: 'Fixture only', kind: 'vod',
  sourceType: 'mux', activeAssetKey: 'fixture-asset', activeSlotId: 'fixture-slot',
};
const cue: AudienceCue = {
  id: 'fixture-cue', enabled: true, match: { playbackId: 'fixture-media' },
  startSeconds: 10, endSeconds: 20, action: { type: 'commercial' },
};
let checks = 0;
function test(name: string, run: () => void) { run(); checks++; console.log(`PASS ${name}`); }
const active = (cues: readonly AudienceCue[] = [cue], snapshot: ProgramStream | null = stream, now = 1000) => getAudienceCueFrame(cues, snapshot, now);
const malformed = (value: unknown) => value as AudienceCue;
function unavailable(snapshot: ProgramStream | null, now = 1000) {
  assert.deepEqual(active([cue], snapshot, now), { occurrenceId: null, positionSeconds: null, activeCues: [], healthy: false });
}

test('no snapshot fails closed', () => unavailable(null));
test('an empty configuration produces no placeholder cues', () => {
  assert.deepEqual(active([]), { occurrenceId: stream.playbackSessionId, positionSeconds: 10, activeCues: [], healthy: true });
});
test('windows include their exact start', () => assert.deepEqual(active().activeCues, [cue]));
test('windows exclude positions before their start', () => {
  assert.deepEqual(active([{ ...cue, startSeconds: 10.001 }]).activeCues, []);
});
test('windows exclude their exact end', () => {
  assert.deepEqual(active([cue], { ...stream, playbackPositionSeconds: 20 }).activeCues, []);
});
test('projection follows monotonic time and half of the bounded RTT', () => {
  const frame = active([cue], { ...stream, snapshotRoundTripMs: 200 }, 6000);
  assert.equal(frame.positionSeconds, 15.1);
  assert.deepEqual(frame.activeCues, [cue]);
  assert.equal(active([cue], { ...stream, snapshotRoundTripMs: 60000 }).positionSeconds, 11);
});
test('paused playback stays frozen and ignores RTT', () => {
  const frame = active([cue], { ...stream, playbackState: 'paused', snapshotRoundTripMs: 400 }, 9000);
  assert.equal(frame.positionSeconds, 10);
  assert.deepEqual(frame.activeCues, [cue]);
});
test('viewer wall-clock skew cannot affect cues', () => {
  const realNow = Date.now;
  try {
    Date.now = () => 0;
    assert.equal(active([cue], stream, 2000).positionSeconds, 11);
    Date.now = () => Number.MAX_SAFE_INTEGER;
    assert.equal(active([cue], stream, 2000).positionSeconds, 11);
  } finally { Date.now = realNow; }
});
test('snapshot age has an inclusive ten-second maximum', () => {
  assert.equal(active([], stream, 11000).healthy, true);
  unavailable(stream, 11000.001);
});
test('future receipt timestamps fail closed', () => unavailable({ ...stream, snapshotReceivedAt: 1001 }));
test('invalid monotonic timestamps and RTT fail closed', () => {
  for (const now of [NaN, Infinity, -1]) unavailable(stream, now);
  for (const received of [NaN, Infinity, -1]) unavailable({ ...stream, snapshotReceivedAt: received });
  for (const rtt of [NaN, Infinity, -1]) unavailable({ ...stream, snapshotRoundTripMs: rtt });
});
test('invalid source snapshot identity and clock fail closed', () => {
  for (const change of [
    { playbackId: '' }, { playbackSessionId: '' }, { playbackSessionId: ' ' },
    { serverNow: 'invalid' }, { playbackRevision: -1 }, { playbackRevision: 1.5 },
    { playbackState: 'unknown' }, { playbackPositionSeconds: NaN },
    { playbackPositionSeconds: Infinity }, { playbackPositionSeconds: -1 },
  ]) unavailable({ ...stream, ...change });
});
test('cue and occurrence identifiers use the delivery ledger limit and reject controls', () => {
  const maximum = 'x'.repeat(256);
  const configured = { ...cue, id: maximum };
  assert.deepEqual(active([configured], { ...stream, playbackSessionId: maximum }).activeCues, [configured]);
  assert.deepEqual(active([{ ...cue, id: 'x'.repeat(257) }]).activeCues, []);
  unavailable({ ...stream, playbackSessionId: 'x'.repeat(257) });
  for (const id of ['x\ny', 'x\ty', 'x\u0000y', 'x\u007fy']) {
    assert.deepEqual(active([{ ...cue, id }]).activeCues, []);
    unavailable({ ...stream, playbackSessionId: id });
    unavailable({ ...stream, playbackId: id });
  }
});
test('media selectors and poll identifiers share bounded control-free validation', () => {
  const maximum = 'x'.repeat(256);
  const configured = { ...cue, match: { playbackId: maximum }, action: { type: 'poll' as const, promptId: maximum, kind: 'trl' as const } };
  assert.deepEqual(active([configured], { ...stream, playbackId: maximum }).activeCues, [configured]);
  unavailable({ ...stream, playbackId: 'x'.repeat(257) });
  for (const id of ['x'.repeat(257), 'x\ny', 'x\u0000y', 'x\u007fy']) {
    for (const match of [{ assetKey: id }, { slotId: id }]) {
      assert.deepEqual(active([{ ...cue, match }], { ...stream, activeAssetKey: id, activeSlotId: id }).activeCues, []);
    }
    assert.deepEqual(active([{ ...cue, action: { type: 'poll', promptId: id, kind: 'trl' } }]).activeCues, []);
  }
});
test('holds and placeholder media never open tasks', () => {
  unavailable({ ...stream, isHoldScreen: true });
  unavailable({ ...stream, playbackId: 'demo-playback-id' });
  unavailable({ ...stream, isHoldScreen: 'yes' } as unknown as ProgramStream);
});
test('v1 excludes live and YouTube sources', () => {
  unavailable({ ...stream, kind: 'live' });
  unavailable({ ...stream, kind: 'unknown' });
  unavailable({ ...stream, sourceType: 'youtube_playlist' });
  unavailable({ ...stream, sourceType: 'unknown' });
  unavailable({ ...stream, sourceType: undefined, playbackId: 'youtube:playlist:fixture' });
});
test('an omitted source type preserves legacy Mux support', () => {
  assert.deepEqual(active([cue], { ...stream, sourceType: undefined }).activeCues, [cue]);
});
test('playback matching is exact and never derived from the title', () => {
  assert.deepEqual(active([{ ...cue, match: { playbackId: 'fixture' } }]).activeCues, []);
  assert.deepEqual(active([{ ...cue, match: { playbackId: stream.title } }]).activeCues, []);
});
test('asset and slot selectors match exact nonmissing IDs', () => {
  for (const match of [{ assetKey: 'fixture-asset' }, { slotId: 'fixture-slot' }]) {
    const exact = { ...cue, match };
    assert.deepEqual(active([exact]).activeCues, [exact]);
    assert.deepEqual(active([exact], { ...stream, activeAssetKey: null, activeSlotId: null }).activeCues, []);
  }
});
test('multiple selectors are conjunctive', () => {
  const exact = { ...cue, match: { playbackId: stream.playbackId, assetKey: 'fixture-asset', slotId: 'fixture-slot' } };
  assert.deepEqual(active([exact]).activeCues, [exact]);
  assert.deepEqual(active([exact], { ...stream, activeSlotId: 'other-slot' }).activeCues, []);
});
test('empty, misspelled and malformed selectors cannot become global cues', () => {
  for (const match of [{}, { title: stream.title }, { playbackId: '' }, { playbackId: ' ' }, { playbackId: undefined }, { playbackId: stream.playbackId, typo: 'x' }]) {
    assert.deepEqual(active([malformed({ ...cue, match })]).activeCues, []);
  }
});
test('only explicitly enabled valid cue windows activate', () => {
  for (const change of [
    { enabled: false }, { enabled: 'true' }, { id: '' }, { id: ' ' },
    { startSeconds: -1 }, { startSeconds: NaN }, { startSeconds: Infinity },
    { endSeconds: 10 }, { endSeconds: 9 }, { endSeconds: Infinity }, { endSeconds: NaN },
  ]) assert.deepEqual(active([malformed({ ...cue, ...change })]).activeCues, []);
});
test('all duplicate IDs fail closed, including disabled duplicates', () => {
  assert.deepEqual(active([cue, { ...cue, action: { type: 'awards' } }]).activeCues, []);
  assert.deepEqual(active([cue, { ...cue, enabled: false }]).activeCues, []);
  const unique = { ...cue, id: 'unique' };
  assert.deepEqual(active([cue, { ...cue }, unique]).activeCues, [unique]);
});
test('all supported action types validate without executing side effects', () => {
  const actions: AudienceCueAction[] = [
    { type: 'poll', promptId: 'fixture-prompt', kind: 'trl' },
    { type: 'poll', promptId: 'fixture-prompt', kind: 'trivia' },
    { type: 'poll', promptId: 'fixture-prompt', kind: 'superlative' },
    { type: 'essay' }, { type: 'essay', promptIndex: 0 },
    { type: 'feedback', formUrl: '/feedback' }, { type: 'commercial' }, { type: 'awards' },
  ];
  for (const action of actions) {
    const configured = { ...cue, action };
    assert.deepEqual(active([configured]).activeCues, [configured]);
  }
});
test('malformed actions fail closed', () => {
  for (const action of [
    null, {}, { type: 'unknown' }, { type: 'poll', promptId: '', kind: 'trl' },
    { type: 'poll', promptId: 'fixture-prompt', kind: 'unknown' },
    { type: 'essay', promptIndex: -1 }, { type: 'essay', promptIndex: 1.5 },
    { type: 'essay', promptIndex: Infinity }, { type: 'feedback', formUrl: '' },
  ]) assert.deepEqual(active([malformed({ ...cue, action })]).activeCues, []);
});
test('feedback allows HTTPS or relative paths and rejects executable or ambiguous URLs', () => {
  for (const formUrl of ['https://example.com/form?q=1', '/feedback', 'feedback/form', '../feedback', '?feedback=1', '#feedback']) {
    const configured = { ...cue, action: { type: 'feedback' as const, formUrl } };
    assert.deepEqual(active([configured]).activeCues, [configured]);
  }
  for (const formUrl of ['http://example.com', '//example.com/form', 'javascript:alert(1)', 'data:text/html,x', 'https:example.com', '/\\example.com', 'https://example.com\n/form', 'https://user:password@example.com', ' https://example.com']) {
    assert.deepEqual(active([malformed({ ...cue, action: { type: 'feedback', formUrl } })]).activeCues, []);
  }
});
test('safe feedback URLs have their own 8192-character limit rather than the identifier limit', () => {
  const prefix = 'https://example.com/form?value=';
  const maximumUrl = prefix + 'x'.repeat(8192 - prefix.length);
  for (const formUrl of [maximumUrl, '/feedback?value=' + 'x'.repeat(300)]) {
    const configured = { ...cue, action: { type: 'feedback' as const, formUrl } };
    assert.deepEqual(active([configured]).activeCues, [configured]);
  }
  const tooLong = { ...cue, action: { type: 'feedback' as const, formUrl: maximumUrl + 'x' } };
  assert.deepEqual(active([tooLong]).activeCues, []);
});
test('known duration stops cues at the true end without manufacturing a final-frame cue', () => {
  const final = { ...cue, startSeconds: 99.98, endSeconds: 101 };
  assert.deepEqual(active([final], { ...stream, playbackPositionSeconds: 99.99 }).activeCues, [final]);
  const ended = active([final], { ...stream, playbackPositionSeconds: 100 });
  assert.equal(ended.positionSeconds, 100);
  assert.deepEqual(ended.activeCues, []);
  assert.deepEqual(active([final], { ...stream, playbackPositionSeconds: 99 }, 3000).activeCues, []);
  assert.deepEqual(active([final], { ...stream, playbackState: 'paused', playbackPositionSeconds: 100 }).activeCues, []);
  for (const duration of [0, -1, NaN, Infinity, undefined]) {
    unavailable({ ...stream, playbackDurationSeconds: duration } as ProgramStream);
  }
});
test('unknown duration still uses explicit finite cue windows', () => {
  assert.deepEqual(active([cue], { ...stream, playbackDurationSeconds: null }).activeCues, [cue]);
});
test('late-join policy remains explicit while the pure frame reports current active state', () => {
  for (const lateJoin of ['show', 'skip'] as const) {
    const configured = { ...cue, lateJoin };
    assert.deepEqual(active([configured], { ...stream, playbackPositionSeconds: 15 }).activeCues, [configured]);
  }
  assert.deepEqual(active([malformed({ ...cue, lateJoin: 'unknown' })]).activeCues, []);
});
test('repeat policy defaults in the observer and invalid values fail closed', () => {
  for (const repeat of ['show', 'occurrence'] as const) {
    const configured = { ...cue, repeat };
    assert.deepEqual(active([configured]).activeCues, [configured]);
  }
  assert.equal(active().activeCues[0].repeat, undefined);
  assert.deepEqual(active([malformed({ ...cue, repeat: 'unknown' })]).activeCues, []);
});
test('revision changes and seeks retain occurrence identity; a replay uses its new occurrence', () => {
  for (const change of [{ playbackRevision: 4 }, { playbackState: 'paused' }, { playbackPositionSeconds: 15 }]) {
    assert.equal(active([cue], { ...stream, ...change }).occurrenceId, stream.playbackSessionId);
  }
  assert.equal(active([cue], { ...stream, playbackSessionId: 'fixture-replay' }).occurrenceId, 'fixture-replay');
  assert.notEqual(getAudienceCueKey('fixture-occurrence', cue.id), getAudienceCueKey('fixture-replay', cue.id));
  assert.notEqual(getAudienceCueKey('a:b', 'c'), getAudienceCueKey('a', 'b:c'));
  assert.deepEqual(JSON.parse(getAudienceCueKey('a"b', 'c\\d')), ['a"b', 'c\\d']);
});
test('overlapping cues preserve configured order and never mutate inputs', () => {
  const first = Object.freeze({ ...cue, id: 'first', match: Object.freeze({ ...cue.match }), action: Object.freeze({ ...cue.action }) });
  const second = Object.freeze({ ...cue, id: 'second' });
  const configured = Object.freeze([first, second]);
  const snapshot = Object.freeze({ ...stream });
  assert.deepEqual(active(configured, snapshot).activeCues, [first, second]);
  assert.equal(snapshot.playbackDurationSeconds, 100);
});
console.log(`Audience cues: ${checks} pure checks passed; no database, media DOM, polling or production writes.`);
