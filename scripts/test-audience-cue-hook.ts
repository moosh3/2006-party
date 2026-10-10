/** Actual hook source + the existing deterministic hook harness; no renderer,
 * database, network, real browser storage, or third-party test dependencies. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';
import * as delivery from '../lib/audience-cue-delivery';
import * as engine from '../lib/audience-cues';
import type { AudienceCueConfig } from '../lib/audience-cue-config';
import type { AudienceCue } from '../lib/audience-cues';
import type { ProgramStream } from '../lib/program-stream';

type Props = Parameters<typeof import('../hooks/useAudienceCues').useAudienceCues>[0];
type Output = ReturnType<typeof import('../hooks/useAudienceCues').useAudienceCues>;
type Harness<P, O> = {
  react: unknown; component: (props: P) => O; output: O; props: P; writesAfterUnmount: number;
  mount(props: P): O; update(props: Partial<P>): O; flush(): O; strictModeReplay(): O; unmount(): void;
};
const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const hookSource = readFileSync(join(project, 'hooks/useAudienceCues.ts'), 'utf8');
const sharedSource = readFileSync(join(project, 'scripts/test-cast-run-interaction.ts'), 'utf8');
// Reuse the already-tested state/effect/StrictMode harness without executing its
// animation tests or adding a renderer dependency. It has no production effects.
const classStart = sharedSource.indexOf('class HookHarness<');
const classEnd = sharedSource.indexOf('\nfunction evaluateModule(', classStart);
assert(classStart >= 0 && classEnd > classStart);
const harnessSource = `${sharedSource.slice(classStart, classEnd)}\nexport { HookHarness };`;
const sameDeps = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

class Events {
  private listeners = new Map<string, Set<() => void>>();
  adds = 0;
  removes = 0;
  addEventListener = (type: string, callback: () => void) => {
    const current = this.listeners.get(type) || new Set();
    if (!current.has(callback)) this.adds++;
    current.add(callback); this.listeners.set(type, current);
  };
  removeEventListener = (type: string, callback: () => void) => {
    if (this.listeners.get(type)?.delete(callback)) this.removes++;
  };
  emit(type: string) { for (const callback of [...(this.listeners.get(type) || [])]) callback(); }
  count() { return [...this.listeners.values()].reduce((total, callbacks) => total + callbacks.size, 0); }
}
class Environment {
  now = 1000;
  intervals = new Map<number, { due: number; delay: number; callback: () => void }>();
  private nextInterval = 0;
  document = Object.assign(new Events(), { hidden: false });
  navigator = { onLine: true };
  storage = new Map<string, string>();
  reads = 0;
  writes = 0;
  storageAccesses = 0;
  blockedStorage = false;
  warnings = 0;
  window = Object.assign(new Events(), {
    setInterval: (callback: () => void, delay: number) => {
      assert.equal(delay, 250);
      const id = ++this.nextInterval;
      this.intervals.set(id, { due: this.now + delay, delay, callback });
      return id;
    },
    clearInterval: (id: number) => { this.intervals.delete(id); },
  });
  constructor() {
    Object.defineProperty(this.window, 'localStorage', { get: () => {
      this.storageAccesses++;
      if (this.blockedStorage) throw new Error('Storage is blocked');
      return {
        getItem: (key: string) => { this.reads++; return this.storage.get(key) ?? null; },
        setItem: (key: string, value: string) => { this.writes++; this.storage.set(key, value); },
      };
    } });
  }
  advance(milliseconds: number) {
    const target = this.now + milliseconds;
    let ticks = 0;
    for (;;) {
      const next = [...this.intervals.values()].sort((a, b) => a.due - b.due)[0];
      if (!next || next.due > target) break;
      assert(++ticks < 1000);
      this.now = next.due;
      next.due += next.delay;
      next.callback();
    }
    this.now = target;
  }
  listenerCount() { return this.window.count() + this.document.count(); }
}

function evaluate(code: string, environment: Environment, react?: unknown): Record<string, any> {
  const testModule = { exports: {} as Record<string, any> };
  const context = createContext({
    module: testModule, exports: testModule.exports, assert, sameDeps,
    window: environment.window, document: environment.document, navigator: environment.navigator,
    performance: { now: () => environment.now },
    console: { warn: () => { environment.warnings++; } },
    require: (name: string) => {
      if (name === 'react') return react;
      if (name === '@/lib/audience-cue-delivery') return delivery;
      if (name === '@/lib/audience-cues') return engine;
      throw new Error(`Unexpected runtime import ${name}; no database/network allowed`);
    },
  });
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  new Script(compiled.outputText).runInContext(context);
  return testModule.exports;
}

const cue: AudienceCue = { id: 'fixture-task', enabled: true, match: { playbackId: 'fixture-media' },
  startSeconds: 10, endSeconds: 20, action: { type: 'commercial' } };
const config: AudienceCueConfig = { enabled: true, showId: 'fixture-show', cues: [cue] };
const stream: ProgramStream = {
  playbackId: 'fixture-media', playbackSessionId: 'fixture-occurrence', playbackRevision: 3,
  serverNow: '2026-10-09T18:00:00Z', playbackState: 'playing', playbackPositionSeconds: 10,
  playbackDurationSeconds: 100, snapshotReceivedAt: 1000, snapshotRoundTripMs: 0,
  token: 'fixture-token', expiresAt: '2026-10-09T19:00:00Z', title: 'Fixture only', kind: 'vod', sourceType: 'mux',
};
function setup(changes: Partial<Props> = {}, environment = new Environment()) {
  const Constructor = evaluate(harnessSource, environment).HookHarness as { new<P, O>(): Harness<P, O> };
  const hook = new Constructor<Props, Output>();
  const actualHook = evaluate(hookSource, environment, hook.react).useAudienceCues as (props: Props) => Output;
  let renders = 0;
  hook.component = props => { renders++; return actualHook(props); };
  const entered: Array<{ cue: AudienceCue; key: string }> = [];
  hook.mount({ stream, viewerId: 'fixture-viewer', config, enabled: true, offline: false,
    onEnter: (item, key) => entered.push({ cue: item, key }), ...changes });
  return { environment, hook, entered, renders: () => renders };
}
const ids = (cues: readonly AudienceCue[]) => Array.from(cues, item => item.id);
let checks = 0;
function test(name: string, check: () => void) { check(); checks++; console.log(`PASS ${name}`); }

test('disabled or empty production configuration installs no storage access, timers or listeners', () => {
  for (const changes of [{ enabled: false }, { config: { ...config, enabled: false } }, { config: { ...config, cues: [] } }]) {
    const fixture = setup(changes);
    assert.equal(fixture.hook.output.armed, false);
    assert.equal(fixture.environment.storageAccesses, 0);
    assert.equal(fixture.environment.intervals.size, 0);
    assert.equal(fixture.environment.listenerCount(), 0);
    assert.equal(fixture.entered.length, 0);
    fixture.hook.unmount();
  }
});
test('invalid show/viewer scope and oversized cue lists fail closed before browser effects', () => {
  for (const changes of [{ viewerId: '' }, { viewerId: ' ' }, { config: { ...config, showId: '' } },
    { config: { ...config, showId: 'x'.repeat(161) } }, { config: { ...config, cues: Array(129).fill(cue) } }]) {
    const fixture = setup(changes);
    assert.equal(fixture.hook.output.armed, false);
    assert.equal(fixture.environment.storageAccesses + fixture.environment.listenerCount() + fixture.environment.intervals.size, 0);
    fixture.hook.unmount();
  }
});
test('healthy cues enter once with their delivery key and an interval independent of stream polls', () => {
  const fixture = setup();
  assert.equal(fixture.hook.output.armed, true);
  assert.equal(fixture.hook.output.occurrenceId, stream.playbackSessionId);
  assert.deepEqual(ids(fixture.hook.output.activeCues), [cue.id]);
  assert.deepEqual(ids(fixture.hook.output.visibleCues), [cue.id]);
  assert.equal(fixture.entered.length, 1);
  assert.equal(fixture.entered[0].key, delivery.getDeliveryKey(config.showId, stream.playbackSessionId, cue));
  const timer = [...fixture.environment.intervals][0];
  const adds = fixture.environment.window.adds + fixture.environment.document.adds;
  for (let poll = 0; poll < 3; poll++) fixture.hook.update({ stream: { ...stream, playbackRevision: 4 + poll } });
  assert.equal([...fixture.environment.intervals][0][0], timer[0]);
  assert.equal([...fixture.environment.intervals][0][1], timer[1]);
  assert.equal(fixture.environment.window.adds + fixture.environment.document.adds, adds);
  assert.equal(fixture.entered.length, 1);
  fixture.hook.unmount();
});
test('quarter-second position ticks do not re-render unchanged cue IDs or rewrite unchanged ledgers', () => {
  const fixture = setup(), renders = fixture.renders(), writes = fixture.environment.writes;
  fixture.environment.advance(2000); fixture.hook.flush();
  assert.equal(fixture.renders(), renders);
  assert.equal(fixture.environment.writes, writes);
  assert.equal(fixture.entered.length, 1);
  fixture.hook.unmount();
});
test('a replaced same-ID cue updates its action payload without redelivery or restarting the timer', () => {
  const fixture = setup();
  const interval = [...fixture.environment.intervals.values()][0];
  const replacement: AudienceCue = { ...cue, action: { type: 'feedback', formUrl: '/updated-form' } };
  fixture.hook.update({ config: { ...config, cues: [replacement] } });
  assert.equal(fixture.hook.output.activeCues[0], replacement);
  assert.equal(fixture.hook.output.visibleCues[0], replacement);
  assert.equal(fixture.hook.output.visibleCues[0].action.type, 'feedback');
  assert.equal(fixture.entered.length, 1);
  assert.equal([...fixture.environment.intervals.values()][0], interval);
  const renders = fixture.renders();
  fixture.environment.advance(1000); fixture.hook.flush();
  assert.equal(fixture.renders(), renders);
  fixture.hook.unmount();
});
test('the latest callback is used without rearming or restarting the observer', () => {
  const nextCue = { ...cue, id: 'later-task', startSeconds: 12, endSeconds: 20 };
  const fixture = setup({ config: { ...config, cues: [cue, nextCue] } });
  const received: string[] = [];
  const timer = [...fixture.environment.intervals.keys()][0];
  fixture.hook.update({ onEnter: item => received.push(item.id) });
  fixture.environment.advance(2000); fixture.hook.flush();
  assert.deepEqual(received, ['later-task']);
  assert.equal([...fixture.environment.intervals.keys()][0], timer);
  fixture.hook.unmount();
});
test('dismissal updates visible invitations immediately and preserves active assignment state', () => {
  const fixture = setup(), writes = fixture.environment.writes;
  fixture.hook.output.dismissCue(cue); fixture.hook.flush();
  assert.deepEqual(ids(fixture.hook.output.visibleCues), []);
  assert.deepEqual(ids(fixture.hook.output.activeCues), [cue.id]);
  assert.equal(fixture.environment.writes, writes + 1);
  fixture.hook.output.dismissCue(cue); fixture.hook.flush();
  assert.equal(fixture.environment.writes, writes + 1);
  fixture.hook.unmount();
});
test('reload restores a closed invitation without reopening it or deleting the assignment', () => {
  const fixture = setup();
  fixture.hook.output.dismissCue(cue); fixture.hook.flush(); fixture.hook.unmount();
  const writes = fixture.environment.writes;
  const restored = setup({}, fixture.environment);
  assert.equal(restored.entered.length, 0);
  assert.deepEqual(ids(restored.hook.output.visibleCues), []);
  assert.deepEqual(ids(restored.hook.output.activeCues), [cue.id]);
  assert.equal(fixture.environment.writes, writes);
  restored.hook.unmount();
});
test('viewer and show scopes never borrow another viewer’s stored dismissals', () => {
  const fixture = setup();
  fixture.hook.output.dismissCue(cue); fixture.hook.flush();
  fixture.hook.update({ viewerId: 'second-viewer' });
  assert.deepEqual(ids(fixture.hook.output.visibleCues), [cue.id]);
  assert.equal(fixture.entered.length, 2);
  fixture.hook.update({ viewerId: 'fixture-viewer' });
  assert.deepEqual(ids(fixture.hook.output.visibleCues), []);
  fixture.hook.update({ config: { ...config, showId: 'next-show' } });
  assert.deepEqual(ids(fixture.hook.output.visibleCues), [cue.id]);
  assert.equal(fixture.entered.length, 3);
  assert.equal(fixture.environment.storage.size, 3);
  fixture.hook.unmount();
});
test('blocked storage remains safe and StrictMode retains the in-memory ledger without duplicate entry', () => {
  const environment = new Environment(); environment.blockedStorage = true;
  const fixture = setup({}, environment);
  assert.equal(fixture.entered.length, 1);
  fixture.hook.strictModeReplay();
  assert.equal(fixture.entered.length, 1);
  fixture.hook.output.dismissCue(cue); fixture.hook.flush();
  assert.deepEqual(ids(fixture.hook.output.visibleCues), []);
  fixture.hook.strictModeReplay();
  assert.deepEqual(ids(fixture.hook.output.visibleCues), []);
  assert.equal(fixture.entered.length, 1);
  assert.equal(environment.intervals.size, 1);
  assert.equal(environment.listenerCount(), 4);
  fixture.hook.unmount();
});
test('hidden tabs break late-join crossing continuity instead of firing a catchup notification', () => {
  const skip = { ...cue, lateJoin: 'skip' as const };
  const fixture = setup({ stream: { ...stream, playbackPositionSeconds: 9 }, config: { ...config, cues: [skip] } });
  fixture.environment.document.hidden = true; fixture.environment.document.emit('visibilitychange'); fixture.hook.flush();
  fixture.hook.update({ stream: { ...stream, playbackPositionSeconds: 15 } });
  assert.equal(fixture.entered.length, 0);
  fixture.environment.document.hidden = false; fixture.environment.document.emit('visibilitychange'); fixture.hook.flush();
  assert.equal(fixture.entered.length, 0);
  assert.deepEqual(ids(fixture.hook.output.activeCues), [cue.id]);
  fixture.hook.unmount();
});
test('navigator offline and explicit feed failures hide cues until healthy recovery', () => {
  const fixture = setup();
  fixture.environment.navigator.onLine = false; fixture.environment.window.emit('offline'); fixture.hook.flush();
  assert.equal(fixture.hook.output.occurrenceId, null);
  assert.deepEqual(ids(fixture.hook.output.activeCues), []);
  fixture.environment.navigator.onLine = true; fixture.environment.window.emit('online'); fixture.hook.flush();
  assert.deepEqual(ids(fixture.hook.output.activeCues), [cue.id]);
  fixture.hook.update({ offline: true });
  assert.deepEqual(ids(fixture.hook.output.visibleCues), []);
  fixture.hook.update({ offline: false });
  assert.deepEqual(ids(fixture.hook.output.visibleCues), [cue.id]);
  assert.equal(fixture.entered.length, 1);
  fixture.hook.unmount();
});
test('stale anchors cannot project notifications into the future and fresh polls recover state', () => {
  const fixture = setup({ stream: { ...stream, playbackState: 'paused' } });
  fixture.environment.advance(10_250); fixture.hook.flush();
  assert.equal(fixture.hook.output.occurrenceId, null);
  assert.deepEqual(ids(fixture.hook.output.activeCues), []);
  fixture.hook.update({ stream: { ...stream, playbackState: 'paused', snapshotReceivedAt: fixture.environment.now } });
  assert.deepEqual(ids(fixture.hook.output.activeCues), [cue.id]);
  assert.equal(fixture.entered.length, 1);
  fixture.hook.unmount();
});
test('holds, missing streams and placeholders cannot expose or enter production cues', () => {
  for (const input of [null, { ...stream, isHoldScreen: true }, { ...stream, playbackId: 'demo-playback-id' }]) {
    const fixture = setup({ stream: input });
    assert.equal(fixture.entered.length, 0);
    assert.deepEqual(ids(fixture.hook.output.activeCues), []);
    fixture.hook.unmount();
  }
});
test('default show scope does not repeat on restart, while explicit occurrence repeat rearms', () => {
  for (const repeat of ['show', 'occurrence'] as const) {
    const fixture = setup({ config: { ...config, cues: [{ ...cue, repeat }] } });
    fixture.hook.update({ stream: { ...stream, playbackSessionId: 'restart-occurrence' } });
    assert.equal(fixture.entered.length, repeat === 'show' ? 1 : 2);
    fixture.hook.unmount();
  }
});
test('stale dismissal handlers cannot dismiss a newer occurrence of the same cue', () => {
  const repeating = { ...cue, repeat: 'occurrence' as const };
  const fixture = setup({ config: { ...config, cues: [repeating] } });
  const oldDismiss = fixture.hook.output.dismissCue;
  fixture.hook.update({ stream: { ...stream, playbackSessionId: 'new-occurrence' } });
  oldDismiss(repeating); fixture.hook.flush();
  assert.deepEqual(ids(fixture.hook.output.visibleCues), [cue.id]);
  fixture.hook.output.dismissCue(repeating); fixture.hook.flush();
  assert.deepEqual(ids(fixture.hook.output.visibleCues), []);
  fixture.hook.unmount();
});
test('one throwing onEnter handler cannot stop the other cues or repeat itself', () => {
  const calls: string[] = [];
  const fixture = setup({ config: { ...config, cues: [cue, { ...cue, id: 'second' }] },
    onEnter: item => { calls.push(item.id); if (item.id === cue.id) throw new Error('Fixture handler failure'); } });
  assert.deepEqual(calls, [cue.id, 'second']);
  assert.equal(fixture.environment.warnings, 1);
  fixture.environment.advance(250); fixture.hook.flush();
  assert.deepEqual(calls, [cue.id, 'second']);
  fixture.hook.unmount();
});
test('disarming removes every interval/listener and delayed callbacks are harmless after unmount', () => {
  const fixture = setup();
  const lateTick = [...fixture.environment.intervals.values()][0].callback;
  fixture.hook.update({ enabled: false });
  assert.equal(fixture.environment.intervals.size, 0);
  assert.equal(fixture.environment.listenerCount(), 0);
  assert.deepEqual(ids(fixture.hook.output.activeCues), []);
  fixture.hook.unmount();
  lateTick();
  assert.equal(fixture.hook.writesAfterUnmount, 0);
  assert.equal(fixture.entered.length, 1);
  assert.equal(fixture.environment.window.adds, fixture.environment.window.removes);
  assert.equal(fixture.environment.document.adds, fixture.environment.document.removes);
});

console.log(`Audience cue hook: ${checks} isolated lifecycle checks passed; actual hook source executed, no database/network.`);
