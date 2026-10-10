import assert from 'node:assert/strict';
import { AudienceCueDelivery, getDeliveryKey } from '../lib/audience-cue-delivery';
import type { AudienceCue, AudienceCueFrame } from '../lib/audience-cues';

const show = 'fixture-show';
const cue: AudienceCue = {
  id: 'fixture-task', enabled: true, match: { playbackId: 'fixture-media' },
  startSeconds: 10, endSeconds: 20, action: { type: 'essay', promptIndex: 1 },
};
function frame(positionSeconds = 10, activeCues: readonly AudienceCue[] = [cue], occurrenceId = 'fixture-occurrence'): AudienceCueFrame {
  return { occurrenceId, positionSeconds, activeCues, healthy: true };
}
const unhealthy: AudienceCueFrame = { occurrenceId: null, positionSeconds: null, activeCues: [], healthy: false };
let checks = 0;
function test(name: string, check: () => void) { check(); checks++; console.log(`PASS ${name}`); }
function keys(delivery: AudienceCueDelivery): string[] {
  const serialized = JSON.parse(delivery.serialize());
  assert.equal(serialized.version, 1);
  assert(Array.isArray(serialized.consumed));
  return serialized.consumed;
}

test('a start boundary delivers once while active task state stays visible', () => {
  const delivery = new AudienceCueDelivery();
  assert.deepEqual(delivery.step(show, frame()), { entered: [cue], visibleCues: [cue] });
  for (const position of [10, 10, 11, 19.9]) {
    assert.deepEqual(delivery.step(show, frame(position)), { entered: [], visibleCues: [cue] });
  }
});
test('default late joining restores both the current assignment and its one invitation', () => {
  const delivery = new AudienceCueDelivery();
  assert.deepEqual(delivery.step(show, frame(15)), { entered: [cue], visibleCues: [cue] });
});
test('skip policy suppresses a first observation in the middle but keeps the task available', () => {
  const delivery = new AudienceCueDelivery(), skip = { ...cue, lateJoin: 'skip' as const };
  assert.deepEqual(delivery.step(show, frame(15, [skip])), { entered: [], visibleCues: [skip] });
  assert.deepEqual(delivery.step(show, frame(10, [skip])), { entered: [], visibleCues: [skip] });
  assert.deepEqual(keys(delivery), [getDeliveryKey(show, 'fixture-occurrence', skip)]);
});
test('the half-second first-observation grace includes its exact boundary', () => {
  const skip = { ...cue, lateJoin: 'skip' as const };
  for (const position of [10, 10.49, 10.5]) {
    assert.deepEqual(new AudienceCueDelivery().step(show, frame(position, [skip])).entered, [skip]);
  }
  assert.deepEqual(new AudienceCueDelivery().step(show, frame(10.50001, [skip])).entered, []);
});
test('a healthy same-occurrence crossing enters skip cues after a normal poll interval', () => {
  const delivery = new AudienceCueDelivery(), skip = { ...cue, lateJoin: 'skip' as const };
  assert.deepEqual(delivery.step(show, frame(9, [])), { entered: [], visibleCues: [] });
  assert.deepEqual(delivery.step(show, frame(13, [skip])).entered, [skip]);
});
test('a previous different occurrence cannot manufacture crossing continuity', () => {
  const delivery = new AudienceCueDelivery(), skip = { ...cue, lateJoin: 'skip' as const };
  delivery.step(show, frame(9, [], 'old'));
  assert.deepEqual(delivery.step(show, frame(13, [skip], 'new')), { entered: [], visibleCues: [skip] });
});
test('a previous different show cannot manufacture crossing continuity', () => {
  const delivery = new AudienceCueDelivery(), skip = { ...cue, lateJoin: 'skip' as const };
  delivery.step('old-show', frame(9, []));
  assert.deepEqual(delivery.step(show, frame(13, [skip])).entered, []);
});
test('expired windows never deliver and later healthy empty samples keep the ledger intact', () => {
  const delivery = new AudienceCueDelivery();
  delivery.step(show, frame());
  for (const position of [20, 100]) {
    assert.deepEqual(delivery.step(show, frame(position, [])), { entered: [], visibleCues: [] });
  }
  assert.equal(keys(delivery).length, 1);
});
test('backward seeking and replaying an observed window never repeat its invitation', () => {
  const delivery = new AudienceCueDelivery();
  delivery.step(show, frame(15));
  delivery.step(show, frame(5, []));
  assert.deepEqual(delivery.step(show, frame(10)), { entered: [], visibleCues: [cue] });
});
test('default show scope prevents restart, repeated media and hold-resume sessions from repeating', () => {
  const delivery = new AudienceCueDelivery();
  delivery.step(show, frame());
  delivery.step(show, unhealthy);
  for (const occurrence of ['resume-session', 'restart-session', 'same-asset-encore']) {
    assert.deepEqual(delivery.step(show, frame(10, [cue], occurrence)), { entered: [], visibleCues: [cue] });
  }
  assert.equal(keys(delivery).length, 1);
});
test('explicit occurrence scope rearms on a new session but not repeated samples in it', () => {
  const delivery = new AudienceCueDelivery(), repeating = { ...cue, repeat: 'occurrence' as const };
  for (const occurrence of ['first', 'restart', 'encore']) {
    assert.deepEqual(delivery.step(show, frame(10, [repeating], occurrence)).entered, [repeating]);
    assert.deepEqual(delivery.step(show, frame(15, [repeating], occurrence)).entered, []);
  }
  assert.equal(keys(delivery).length, 3);
});
test('a new show has its own invitation history', () => {
  const delivery = new AudienceCueDelivery();
  delivery.step(show, frame());
  assert.deepEqual(delivery.step('next-show', frame()).entered, [cue]);
  assert.deepEqual(delivery.step(show, frame()).entered, []);
});
test('frozen paused samples cannot repeatedly enter or erase an assignment', () => {
  const delivery = new AudienceCueDelivery();
  delivery.step(show, frame());
  for (let poll = 0; poll < 10; poll++) {
    assert.deepEqual(delivery.step(show, frame()), { entered: [], visibleCues: [cue] });
  }
});
test('unhealthy stale or disconnected frames break continuity without clearing consumption', () => {
  const delivery = new AudienceCueDelivery(), skip = { ...cue, id: 'skipped', lateJoin: 'skip' as const };
  delivery.step(show, frame());
  delivery.step(show, frame(9, []));
  assert.deepEqual(delivery.step(show, unhealthy), { entered: [], visibleCues: [] });
  assert.deepEqual(delivery.step(show, frame(15, [skip])).entered, []);
  assert.deepEqual(delivery.step(show, frame(15)).entered, []);
});
test('resetObservation models hidden tabs without discarding invitation history', () => {
  const delivery = new AudienceCueDelivery(), skip = { ...cue, id: 'skipped', lateJoin: 'skip' as const };
  delivery.step(show, frame());
  delivery.step(show, frame(9, []));
  delivery.resetObservation();
  assert.deepEqual(delivery.step(show, frame(15, [skip])).entered, []);
  assert.deepEqual(delivery.step(show, frame(15)).entered, []);
});
test('dismissal hides an invitation without mutating the source assignment truth', () => {
  const delivery = new AudienceCueDelivery();
  const current = frame();
  delivery.dismiss(show, 'fixture-occurrence', cue);
  assert.deepEqual(delivery.step(show, current), { entered: [], visibleCues: [] });
  assert.deepEqual(current.activeCues, [cue]);
});
test('dismissed invitations remain closed on reload and show-scoped restart or hold-resume', () => {
  const original = new AudienceCueDelivery();
  original.step(show, frame());
  original.dismiss(show, 'fixture-occurrence', cue);
  const restored = new AudienceCueDelivery(original.serialize());
  for (const occurrence of ['fixture-occurrence', 'restart', 'hold-resume']) {
    const current = frame(15, [cue], occurrence);
    assert.deepEqual(restored.step(show, current), { entered: [], visibleCues: [] });
    assert.deepEqual(current.activeCues, [cue]);
  }
});
test('explicit occurrence dismissal does not hide a new occurrence invitation', () => {
  const delivery = new AudienceCueDelivery(), repeating = { ...cue, repeat: 'occurrence' as const };
  delivery.dismiss(show, 'first', repeating);
  assert.deepEqual(delivery.step(show, frame(10, [repeating], 'first')), { entered: [], visibleCues: [] });
  assert.deepEqual(delivery.step(show, frame(10, [repeating], 'next')), { entered: [repeating], visibleCues: [repeating] });
});
test('a separate dismissed ledger cannot leave the consumed ledger or exceed its bound', () => {
  const delivery = new AudienceCueDelivery(JSON.stringify({ version: 1, consumed: [], dismissed: [getDeliveryKey(show, 'x', cue)] }));
  assert.deepEqual(delivery.step(show, frame()), { entered: [], visibleCues: [] });
  for (let i = 0; i < 300; i++) delivery.dismiss(show, 'x', { ...cue, id: `dismissed-${i}` });
  const serialized = JSON.parse(delivery.serialize());
  assert.equal(serialized.consumed.length, 256);
  assert.equal(serialized.dismissed.length, 256);
  assert(serialized.dismissed.every((key: string) => serialized.consumed.includes(key)));
});
test('serialized reload restores consumption but independently reconciles current tasks', () => {
  const delivery = new AudienceCueDelivery(), repeating = { ...cue, id: 'repeating', repeat: 'occurrence' as const };
  delivery.step(show, frame(10, [cue, repeating]));
  const restored = new AudienceCueDelivery(delivery.serialize());
  assert.deepEqual(restored.step(show, frame(15, [cue, repeating])), { entered: [], visibleCues: [cue, repeating] });
  assert.deepEqual(restored.step(show, frame(10, [cue, repeating], 'new-occurrence')).entered, [repeating]);
});
test('corrupt, incompatible and nonstring stores safely become an empty history', () => {
  for (const input of [undefined, null, '', 'not-json', '{}', '[]', 'false', '{"version":2,"consumed":[]}',
    '{"version":1,"consumed":{}}', '{"version":1,"consumed":[],"dismissed":{}}', 'x'.repeat(6_000_000), 12, { version: 1 }]) {
    assert.deepEqual(new AudienceCueDelivery(input as string).step(show, frame()).entered, [cue]);
  }
});
test('ledger parsing ignores malformed keys and canonicalizes valid tuples only', () => {
  const validKey = getDeliveryKey(show, 'fixture-occurrence', cue);
  const inputs = [null, 1, false, {}, [], 'not-json', '[]', '["only"]', '["a","b","c","d"]',
    '["a",null]', '["", "b"]', '["a", "b\\n"]', JSON.stringify(['x'.repeat(257), 'b']),
    ` ${validKey} `, validKey];
  const delivery = new AudienceCueDelivery(JSON.stringify({ version: 1, consumed: inputs, __proto__: 'ignored' }));
  assert.deepEqual(keys(delivery), [validKey]);
  assert.deepEqual(delivery.step(show, frame()).entered, []);
});
test('excessive externally supplied entry counts fail closed without unbounded iteration', () => {
  const delivery = new AudienceCueDelivery(JSON.stringify({ version: 1, consumed: Array(1025).fill(getDeliveryKey(show, 'x', cue)) }));
  assert.deepEqual(keys(delivery), []);
});
test('JSON tuple keys cannot collide when identifiers contain separators, quotes or Unicode', () => {
  const values = [
    getDeliveryKey('a:b', 'x', { id: 'c' }), getDeliveryKey('a', 'x', { id: 'b:c' }),
    getDeliveryKey('a', 'b:c', { id: 'd', repeat: 'occurrence' }),
    getDeliveryKey('a:b', 'c', { id: 'd', repeat: 'occurrence' }),
    getDeliveryKey('a', 'x', { id: 'b', repeat: 'show' }),
    getDeliveryKey('a', 'x', { id: 'b', repeat: 'occurrence' }),
    getDeliveryKey('"雪"', 'x', { id: '[,"x"]' }),
  ];
  assert.equal(new Set(values).size, values.length);
  assert.equal(getDeliveryKey(show, 'first', cue), getDeliveryKey(show, 'second', cue));
});
test('max-length escaped identifiers survive serialize and reload without changing their keys', () => {
  const delivery = new AudienceCueDelivery();
  const escapedShow = '"'.repeat(256), escapedOccurrence = '\\'.repeat(256);
  const escapedCue = { ...cue, id: '\ud800'.repeat(256), repeat: 'occurrence' as const };
  delivery.dismiss(escapedShow, escapedOccurrence, escapedCue);
  const restored = new AudienceCueDelivery(delivery.serialize());
  assert.deepEqual(keys(restored), keys(delivery));
  assert.deepEqual(restored.step(escapedShow, frame(10, [escapedCue], escapedOccurrence)), { entered: [], visibleCues: [] });
});
test('the ledger remains bounded and evicts occurrence entries before durable show entries', () => {
  const delivery = new AudienceCueDelivery();
  for (let i = 0; i < 128; i++) delivery.dismiss(show, 'x', { ...cue, id: `durable-${i}` });
  const repeating = { ...cue, repeat: 'occurrence' as const };
  for (let i = 0; i < 400; i++) delivery.dismiss(show, `session-${i}`, repeating);
  const retained = keys(delivery);
  assert.equal(retained.length, 256);
  for (let i = 0; i < 128; i++) assert(retained.includes(getDeliveryKey(show, 'x', { ...cue, id: `durable-${i}` })));
  assert(retained.includes(getDeliveryKey(show, 'session-399', repeating)));
  assert(!retained.includes(getDeliveryKey(show, 'session-0', repeating)));
  assert.deepEqual(keys(new AudienceCueDelivery(delivery.serialize())), retained);
});
test('all-show histories also stay bounded, preserving their newest entries', () => {
  const delivery = new AudienceCueDelivery();
  for (let i = 0; i < 300; i++) delivery.dismiss(show, 'x', { ...cue, id: `cue-${i}` });
  const retained = keys(delivery);
  assert.equal(retained.length, 256);
  assert(!retained.includes(getDeliveryKey(show, 'x', { ...cue, id: 'cue-0' })));
  assert(retained.includes(getDeliveryKey(show, 'x', { ...cue, id: 'cue-299' })));
});
test('multiple simultaneous cues retain configuration order and do not duplicate invitations', () => {
  const delivery = new AudienceCueDelivery();
  const ordered = [{ ...cue, id: 'third' }, { ...cue, id: 'first' }, { ...cue, id: 'second' }];
  assert.deepEqual(delivery.step(show, frame(10, ordered)), { entered: ordered, visibleCues: ordered });
  assert.deepEqual(delivery.step(show, frame(11, [...ordered, ordered[0]])).entered, []);
});
test('invalid frame identifiers, positions and windows never open invitations', () => {
  for (const change of [{ occurrenceId: null }, { occurrenceId: '' }, { positionSeconds: null },
    { positionSeconds: NaN }, { positionSeconds: Infinity }, { positionSeconds: -1 }, { healthy: false }]) {
    assert.deepEqual(new AudienceCueDelivery().step(show, { ...frame(), ...change }), { entered: [], visibleCues: [] });
  }
  for (const input of ['', ' ', 'x'.repeat(257)]) {
    assert.deepEqual(new AudienceCueDelivery().step(input, frame()), { entered: [], visibleCues: [] });
  }
  const invalid = [{ ...cue, enabled: false }, { ...cue, endSeconds: 10 }, { ...cue, startSeconds: NaN }];
  assert.deepEqual(new AudienceCueDelivery().step(show, frame(10, invalid)), { entered: [], visibleCues: [] });
});
test('serialization stores identifiers only, not drafts, action payloads or media selectors', () => {
  const delivery = new AudienceCueDelivery();
  delivery.step(show, frame());
  const serialized = delivery.serialize();
  for (const content of ['promptIndex', 'essay', 'fixture-media', 'startSeconds', 'match', 'viewer']) {
    assert(!serialized.includes(content));
  }
  assert.deepEqual(Object.keys(JSON.parse(serialized)), ['version', 'consumed', 'dismissed']);
});

console.log(`Audience cue delivery: ${checks} isolated checks passed; no React, storage, database, or network.`);
