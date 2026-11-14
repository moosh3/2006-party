import assert from 'node:assert/strict';
import { invitationCopy, invitationStorageKey, isShowInvitationKind, readShowInvitation } from '../lib/show-invitations';

const show = { id: 'friday', status: 'active' };
const welcome = { id: 123, details: { kind: 'welcome', privateOperatorData: 'never public' } };
assert.equal(isShowInvitationKind('__proto__'), false);
assert.equal(isShowInvitationKind('toString'), false);
assert.equal(readShowInvitation(show, null, []), null);
assert.equal(readShowInvitation(show, { id: 1, details: { kind: 'clear' } }, []), null);
assert.equal(readShowInvitation(show, { id: 'invalid', details: { kind: 'welcome' } }, []), null);
assert.equal(readShowInvitation({ ...show, status: 'finished' }, welcome, []), null);
const noVote = readShowInvitation(show, welcome, [{ kind: 'trl', status: 'draft' }])!;
assert.equal(noVote.trlStatus, 'unavailable');
const open = readShowInvitation(show, welcome, [{ kind: 'trl', status: 'closed' }, { kind: 'trl', status: 'open' }])!;
assert.equal(open.trlStatus, 'open');
const closed = readShowInvitation(show, welcome, [{ kind: 'trl', status: 'closed' }])!;
assert.equal(closed.trlStatus, 'closed');
for (const invitation of [noVote, open, closed]) {
  const copy = invitationCopy(invitation);
  assert.equal(copy.heading, 'Voting is closed.');
  assert.equal(copy.body, null);
  assert.equal(copy.action, null);
}
assert.equal(JSON.stringify(open).includes('privateOperatorData'), false);
assert.notEqual(invitationStorageKey('guest', 'friday'), invitationStorageKey('guest', 'saturday'));
assert.notEqual(invitationStorageKey('guest', 'friday'), invitationStorageKey('new-guest', 'friday'));
assert.notEqual(invitationStorageKey('a:b', 'c'), invitationStorageKey('a', 'b:c'));
console.log('PASS: show invitation validation, privacy, Jen’s simple announcement, and viewer/night scoping.');
