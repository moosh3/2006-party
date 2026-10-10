/** Pure browser-contract regressions. No network, database, or real browser storage. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';
import { newerAudienceDoors, parseAudienceDoors, parseAudienceViewer, type AudienceViewer } from '../lib/audience-access';
import type { ViewerData } from '../lib/viewer';

let passed = 0;
function check(label: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${label}`);
}

const viewer: AudienceViewer = {
  id: '20062006-0000-4000-8000-000000000001',
  name: 'xXTestFanXx',
  blocked: false,
};
const otherViewer: AudienceViewer = {
  id: '20062006-0000-4000-8000-000000000002',
  name: 'AnotherTestFan',
  blocked: false,
};
const stamp = '2026-10-09T19:00:00.000Z';
const closed = { doorsOpen: false, revision: 0, changedAt: stamp };
const open = { doorsOpen: true, revision: 1, changedAt: stamp };

check('a signed-out audience viewer is explicit null', () => {
  assert.equal(parseAudienceViewer(null), null);
});
check('viewer parsing retains only the public identity fields', () => {
  assert.deepEqual(parseAudienceViewer({ ...viewer, token: 'not-public', score: 99 }), viewer);
  assert.deepEqual(parseAudienceViewer({ ...viewer, blocked: true }), { ...viewer, blocked: true });
});
check('malformed audience identity contracts fail closed', () => {
  for (const value of [undefined, false, 3, 'anonymous', [], {},
    { ...viewer, id: 'viewer_spoofed' }, { ...viewer, name: '' }, { ...viewer, name: 'A' },
    { ...viewer, name: 'A'.repeat(21) }, { ...viewer, name: ' padded ' },
    { ...viewer, blocked: 'false' }, { ...viewer, blocked: undefined }]) {
    assert.throws(() => parseAudienceViewer(value));
  }
});
check('doors parsing strips unexpected public fields', () => {
  assert.deepEqual(parseAudienceDoors({ ...closed, private: 'not-public' }), closed);
  assert.deepEqual(parseAudienceDoors(open), open);
});
check('malformed doors contracts fail closed', () => {
  for (const value of [null, undefined, [], {}, { ...closed, doorsOpen: 'true' },
    { ...closed, revision: -1 }, { ...closed, revision: 1.5 }, { ...closed, revision: NaN },
    { ...closed, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...closed, changedAt: 'not-a-date' },
    { ...closed, changedAt: null }]) {
    assert.throws(() => parseAudienceDoors(value));
  }
});
check('the first valid doors response establishes the confirmed state', () => {
  assert.equal(newerAudienceDoors(null, closed), closed);
  assert.equal(newerAudienceDoors(null, open), open);
});
check('stale or duplicate doors responses never reverse admission', () => {
  assert.equal(newerAudienceDoors(open, closed), open);
  assert.equal(newerAudienceDoors(open, { ...closed, revision: open.revision }), open);
  assert.equal(newerAudienceDoors(open, { ...open, changedAt: '2026-10-10T00:00:00Z' }), open);
});
check('a newer host close and later reopen each take effect', () => {
  const newerClosed = { ...closed, revision: 2 };
  const reopened = { ...open, revision: 3 };
  assert.equal(newerAudienceDoors(open, newerClosed), newerClosed);
  assert.equal(newerAudienceDoors(newerClosed, reopened), reopened);
  assert.equal(newerAudienceDoors(reopened, newerClosed), reopened);
});

type ViewerModule = typeof import('../lib/viewer');
const source = readFileSync('lib/viewer.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const key = '2006_party_viewer';
const legacyKey = 'after_party_viewer';
const draftKey = (id: string) => `2006_essay_${id}`;

function browser(initial: Record<string, string> = {}, options: { blockedReads?: boolean; blockedWrites?: boolean; server?: boolean } = {}) {
  const values = new Map(Object.entries(initial));
  const reads: string[] = [];
  const writes: string[] = [];
  const storage = {
    getItem(name: string) {
      reads.push(name);
      if (options.blockedReads) throw new Error('Storage access denied');
      return values.get(name) ?? null;
    },
    setItem(name: string, value: string) {
      writes.push(name);
      if (options.blockedWrites) throw new Error('Storage access denied');
      values.set(name, value);
    },
    removeItem(name: string) {
      writes.push(name);
      if (options.blockedWrites) throw new Error('Storage access denied');
      values.delete(name);
    },
  };
  const testModule = { exports: {} as ViewerModule };
  const context = createContext({
    module: testModule, exports: testModule.exports,
    ...(options.server ? {} : { window: {}, localStorage: storage }),
    require: () => { throw new Error('Viewer storage must not import server clients or credentials'); },
  });
  new Script(compiled).runInContext(context);
  return { api: testModule.exports, values, reads, writes };
}

function legacyViewer(overrides: Partial<ViewerData> = {}): ViewerData {
  return {
    id: 'viewer_test_legacy', email: 'local@2006.local', displayName: viewer.name,
    avatar: 'aim', registeredAt: 2006, ...overrides,
  };
}

check('server rendering neither reads storage nor trusts a local viewer', () => {
  const { api, reads, writes } = browser({}, { server: true });
  assert.equal(api.getViewerData(), null);
  assert.equal(api.isViewerRegistered(), false);
  assert.equal(api.adoptAudienceViewer(viewer).id, viewer.id);
  api.clearViewerData();
  assert.deepEqual(reads, []);
  assert.deepEqual(writes, []);
});
check('legacy local identity can be read for the login prefill', () => {
  const { api } = browser({ [legacyKey]: JSON.stringify(legacyViewer()) });
  assert.equal(api.getViewerData()?.id, 'viewer_test_legacy');
  assert.equal(api.getViewerData()?.displayName, viewer.name);
});
check('malformed local storage is treated as signed out', () => {
  for (const value of ['{broken', 'null', '[]', JSON.stringify({ id: 'bad' }),
    JSON.stringify(legacyViewer({ displayName: 'A' })),
    JSON.stringify(legacyViewer({ displayName: 'A'.repeat(21) })),
    JSON.stringify({ ...legacyViewer(), avatar: null })]) {
    const { api } = browser({ [key]: value });
    assert.equal(api.getViewerData(), null);
  }
});
check('the canonical cookie identity replaces a stale browser label', () => {
  const { api, values } = browser({ [key]: JSON.stringify(legacyViewer()) });
  const adopted = api.adoptAudienceViewer(viewer);
  assert.equal(adopted.id, viewer.id);
  assert.equal(adopted.displayName, viewer.name);
  assert.equal(adopted.avatar, 'aim');
  assert.equal(adopted.registeredAt, 2006);
  assert.equal(api.getViewerData(), adopted);
  assert.equal(JSON.parse(values.get(key)!).id, viewer.id);
});
check('a same-name legacy essay migrates without deleting its source', () => {
  const previous = legacyViewer();
  const oldDraft = JSON.stringify({ text: 'My private essay', savedAt: 2006 });
  const { api, values } = browser({ [legacyKey]: JSON.stringify(previous), [draftKey(previous.id)]: oldDraft });
  api.adoptAudienceViewer(viewer);
  assert.equal(values.get(draftKey(viewer.id)), oldDraft);
  assert.equal(values.get(draftKey(previous.id)), oldDraft);
});
check('an existing canonical essay is never overwritten by a legacy draft', () => {
  const previous = legacyViewer();
  const oldDraft = 'Old essay';
  const currentDraft = 'Newer essay';
  const { api, values } = browser({ [key]: JSON.stringify(previous),
    [draftKey(previous.id)]: oldDraft, [draftKey(viewer.id)]: currentDraft });
  api.adoptAudienceViewer(viewer);
  assert.equal(values.get(draftKey(viewer.id)), currentDraft);
  assert.equal(values.get(draftKey(previous.id)), oldDraft);
});
check('another person’s essay never migrates into the signed-on identity', () => {
  const previous = legacyViewer({ displayName: 'DifferentPerson' });
  const { api, values } = browser({ [key]: JSON.stringify(previous), [draftKey(previous.id)]: 'Not this viewer’s essay' });
  api.adoptAudienceViewer(viewer);
  assert.equal(values.has(draftKey(viewer.id)), false);
  assert.equal(values.get(draftKey(previous.id)), 'Not this viewer’s essay');
});
check('repeat canonical adoption does not rewrite or duplicate essay keys', () => {
  const { api, values, writes } = browser({ [draftKey(viewer.id)]: 'Canonical essay' });
  api.adoptAudienceViewer(viewer);
  api.adoptAudienceViewer(viewer);
  assert.equal(values.get(draftKey(viewer.id)), 'Canonical essay');
  assert.deepEqual(writes.filter(name => name.startsWith('2006_essay_')), []);
});
check('private browser storage cannot block canonical sign-on', () => {
  const { api, values } = browser({}, { blockedReads: true, blockedWrites: true });
  assert.equal(api.getViewerData(), null);
  const first = api.adoptAudienceViewer(viewer);
  assert.equal(api.getViewerData(), first);
  assert.equal(api.isViewerRegistered(), true);
  const second = api.adoptAudienceViewer(otherViewer);
  assert.equal(api.getViewerData(), second);
  assert.equal(second.id, otherViewer.id);
  assert.equal(values.size, 0);
  api.clearViewerData();
  assert.equal(api.getViewerData(), null);
});
check('write-denied storage still retains the confirmed identity in memory', () => {
  const previous = legacyViewer();
  const { api, values } = browser({ [key]: JSON.stringify(previous), [draftKey(previous.id)]: 'Old draft' }, { blockedWrites: true });
  const adopted = api.adoptAudienceViewer(viewer);
  assert.equal(api.getViewerData(), adopted);
  assert.equal(adopted.id, viewer.id);
  assert.equal(values.has(draftKey(viewer.id)), false);
  assert.equal(JSON.parse(values.get(key)!).id, previous.id);
});
check('clearing browser labels preserves all private essay drafts', () => {
  const { api, values } = browser({ [key]: JSON.stringify(legacyViewer()), [legacyKey]: JSON.stringify(legacyViewer()),
    [draftKey(viewer.id)]: 'Private essay', unrelated: 'Keep me' });
  api.adoptAudienceViewer(viewer);
  api.clearViewerData();
  assert.equal(api.getViewerData(), null);
  assert.equal(values.has(key), false);
  assert.equal(values.has(legacyKey), false);
  assert.equal(values.get(draftKey(viewer.id)), 'Private essay');
  assert.equal(values.get('unrelated'), 'Keep me');
});

console.log(`${passed} audience contract, doors ordering, and isolated viewer-storage regressions passed.`);
