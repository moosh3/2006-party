/** Pure chat reconciliation regressions. No credentials, network, or database. */
import assert from 'node:assert/strict';
import {
  CHAT_MESSAGE_LIMIT,
  applyChatMessage,
  normalizeChatMessages,
  reconcileChatMessages,
  removeChatMessage,
  type ChatMessage,
} from '../lib/chat-message-state';

const message = (id: number, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  user_id: `viewer-${id}`,
  user_name: `Fan${id}`,
  body: `Message ${id}`,
  kind: 'user',
  created_at: '2006-01-01T00:00:00.000Z',
  room: 'event',
  ...overrides,
});
const ids = (messages: ChatMessage[]) => messages.map((row) => row.id);
let checks = 0;
function check(name: string, test: () => void) {
  try {
    test();
    checks++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

check('own send and realtime INSERT render once in either order', () => {
  const own = message(2);
  const realtime = message(2);
  assert.deepEqual(ids(applyChatMessage([message(1), own], realtime)), [1, 2]);
  assert.deepEqual(ids(applyChatMessage([message(1), realtime], own)), [1, 2]);
});
check('same ID updates the row without changing its position', () => {
  const result = applyChatMessage([message(3), message(1), message(2)], message(2, { body: 'Edited' }));
  assert.deepEqual(ids(result), [1, 2, 3]);
  assert.equal(result[1].body, 'Edited');
});
check('ID order wins over response order or unreliable equal timestamps', () => {
  assert.deepEqual(ids(normalizeChatMessages([message(9), message(2), message(5)])), [2, 5, 9]);
});
check('normalization keeps only the latest 100 distinct IDs', () => {
  const input = Array.from({ length: 150 }, (_, index) => message(index + 1)).reverse();
  const result = normalizeChatMessages([...input, message(149, { body: 'Last duplicate' })]);
  assert.equal(result.length, CHAT_MESSAGE_LIMIT);
  assert.deepEqual(ids(result), Array.from({ length: 100 }, (_, index) => index + 51));
  assert.equal(result[98].body, 'Last duplicate');
});
check('a newer insert preserves the bound', () => {
  const input = Array.from({ length: 100 }, (_, index) => message(index + 1));
  assert.deepEqual(ids(applyChatMessage(input, message(101))), Array.from({ length: 100 }, (_, index) => index + 2));
});
check('latest and all messages can be deleted', () => {
  const remaining = removeChatMessage([message(1), message(2)], 2);
  assert.deepEqual(ids(remaining), [1]);
  assert.deepEqual(removeChatMessage(remaining, 1), []);
  assert.deepEqual(removeChatMessage([], 1), []);
});
check('soft deletion removes every duplicate copy', () => {
  const tombstone = message(2, { deleted_at: '2006-01-01T00:00:01.000Z' });
  assert.deepEqual(ids(applyChatMessage([message(1), message(2)], tombstone)), [1]);
  assert.deepEqual(ids(normalizeChatMessages([message(2), tombstone, message(2)])), []);
});
check('a null deleted_at is a live row', () => {
  assert.deepEqual(ids(normalizeChatMessages([message(1, { deleted_at: null })])), [1]);
});
check('a complete snapshot removes absent old rows including the former latest row', () => {
  const old = [message(1), message(2), message(3)];
  assert.deepEqual(ids(reconcileChatMessages([old[0]], [])), [1]);
  assert.deepEqual(reconcileChatMessages([], []), []);
});
check('INSERT received after fetch start survives an older snapshot once', () => {
  const result = reconcileChatMessages([message(1)], [{ id: 2, message: message(2) }]);
  assert.deepEqual(ids(result), [1, 2]);
  assert.deepEqual(ids(reconcileChatMessages([message(1), message(2)], [{ id: 2, message: message(2) }])), [1, 2]);
});
check('soft deletion received after fetch start wins over a stale snapshot', () => {
  assert.deepEqual(ids(reconcileChatMessages([message(1), message(2)], [
    { id: 2, message: message(2, { deleted_at: '2006-01-01T00:00:01.000Z' }) },
  ])), [1]);
});
check('hard deletion received after fetch start wins over a stale snapshot', () => {
  assert.deepEqual(reconcileChatMessages([message(1)], [{ id: 1, message: null }]), []);
});
check('tombstones never resurrect in a response/event batch', () => {
  const changes = [
    { id: 2, message: null },
    { id: 2, message: message(2) },
    { id: 3, message: message(3) },
  ];
  assert.deepEqual(ids(reconcileChatMessages([message(1), message(2)], changes)), [1, 3]);
  assert.deepEqual(ids(reconcileChatMessages([message(2, { deleted_at: 'deleted' })], [
    { id: 2, message: message(2) },
  ])), []);
});
check('a post-fetch body/reaction update replaces stale fields', () => {
  const updated = message(1, {
    body: 'Edited after fetch started',
    reactions: [{ reaction: 'love', count: 1, viewerReacted: true }],
    viewerReaction: 'love',
  });
  assert.deepEqual(reconcileChatMessages([message(1)], [{ id: 1, message: updated }]), [updated]);
});
check('raw realtime overlaps preserve API reaction summaries', () => {
  const reacted = message(1, {
    reactions: [{ reaction: 'haha', count: 2, viewerReacted: true }],
    viewerReaction: 'haha',
  });
  assert.deepEqual(applyChatMessage([reacted], message(1)), [reacted]);
  assert.deepEqual(reconcileChatMessages([reacted], [{ id: 1, message: message(1) }]), [reacted]);
});
check('explicit empty reactions and null viewer reaction clear a previous reaction', () => {
  const reacted = message(1, {
    reactions: [{ reaction: 'love', count: 1, viewerReacted: true }],
    viewerReaction: 'love',
  });
  const cleared = message(1, { reactions: [], viewerReaction: null });
  assert.deepEqual(applyChatMessage([reacted], cleared), [cleared]);
});
check('room scoping remains the caller responsibility', () => {
  const otherRoom = message(2, { room: 'after-party' });
  assert.deepEqual(normalizeChatMessages([message(1), otherRoom]), [message(1), otherRoom]);
});
check('helper calls never mutate their input arrays or rows', () => {
  const original = message(1);
  Object.freeze(original);
  const input: ChatMessage[] = [original];
  Object.freeze(input);
  normalizeChatMessages(input);
  applyChatMessage(input, message(2));
  removeChatMessage(input, 1);
  const changes = [{ id: 2, message: message(2) }];
  Object.freeze(changes);
  reconcileChatMessages(input, changes);
  assert.deepEqual(input, [message(1)]);
});

console.log(`PASS: ${checks} chat-message state checks — authoritative snapshots, late event overlays, deletion tombstones, duplicate sends, bounded ID ordering, reaction preservation, and immutable inputs.`);
