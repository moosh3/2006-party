/**
 * Executes the actual Mux player component and playback-clock helpers with a
 * deterministic media element. This proves the seek-event regression, not a
 * particular phone/browser failure. No renderer, provider, database, or network.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';
import * as constants from '../lib/constants';
import * as playbackSync from '../lib/playback-sync';
import * as youtube from '../lib/youtube';

type Node = { type: unknown; props: Record<string, any> };
type Props = Parameters<typeof import('../components/VideoPlayer').default>[0];
type Harness = {
  react: Record<string, any>; component: (props: Props) => Node; output: Node;
  mount(props: Props): Node; update(props: Partial<Props>): Node; flush(): Node; unmount(): void; writesAfterUnmount: number;
};
type Timer = { due: number; callback: () => void; interval?: number };
type PlayOutcome = 'resolve' | 'pending' | 'deferred' | 'NotAllowedError' | 'AbortError';
const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path: string) => readFileSync(join(project, path), 'utf8');
const shared = source('scripts/test-cast-run-interaction.ts');
const start = shared.indexOf('class HookHarness<');
const end = shared.indexOf('\nfunction evaluateModule(', start);
assert(start >= 0 && end > start, 'The existing actual-source hook harness must be available');
const harnessSource = `${shared.slice(start, end)}\nexport { HookHarness };`;
const componentSource = source('components/VideoPlayer.tsx');
const sameDeps = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

class Events {
  private listeners = new Map<string, Set<() => void>>();
  addEventListener = (type: string, callback: () => void) => {
    const callbacks = this.listeners.get(type) || new Set();
    callbacks.add(callback); this.listeners.set(type, callbacks);
  };
  removeEventListener = (type: string, callback: () => void) => { this.listeners.get(type)?.delete(callback); };
  emit(type: string) { for (const callback of [...(this.listeners.get(type) || [])]) callback(); }
}

class Environment {
  now = 0;
  nextTimer = 0;
  timers = new Map<number, Timer>();
  media: Media;
  playerProps: Record<string, any> = {};
  playbackMilliseconds = 0;
  currentReads = 0;
  operations: string[] = [];
  commands: { url: string; body: Record<string, unknown> }[] = [];
  snapshot = {
    playbackId: 'isolated-mux-cue', sourceType: 'mux', playbackSessionId: 'isolated-session',
    playbackRevision: 1, serverNow: '2026-10-09T20:00:00.000Z', playbackState: 'playing',
    playbackPositionSeconds: 40, playbackDurationSeconds: 600,
  };
  constructor(public seekLatency: number, public reactEventFirst = true) { this.media = new Media(this); }
  setTimeout = (callback: () => void, delay: number) => {
    const id = ++this.nextTimer; this.timers.set(id, { due: this.now + delay, callback }); return id;
  };
  clearTimeout = (id: number) => { this.timers.delete(id); };
  setInterval = (callback: () => void, interval: number) => {
    const id = ++this.nextTimer; this.timers.set(id, { due: this.now + interval, interval, callback }); return id;
  };
  window = Object.assign(new Events(), {
    setTimeout: this.setTimeout, clearTimeout: this.clearTimeout,
    setInterval: this.setInterval, clearInterval: this.clearTimeout,
  });
  document = Object.assign(new Events(), { visibilityState: 'visible' });
  fetch = async (url: string, options: Record<string, any> = {}) => {
    if (url === '/api/current' && !options.method) {
      this.operations.push('fetch');
      this.currentReads++;
      const snapshot = { ...this.snapshot,
        serverNow: new Date(Date.parse(this.snapshot.serverNow) + this.now).toISOString(),
        playbackPositionSeconds: this.snapshot.playbackPositionSeconds + (this.snapshot.playbackState === 'playing' ? this.now / 1000 : 0),
      };
      return { ok: true, status: 200, json: async () => snapshot };
    }
    assert.equal(url, '/api/admin/playback-control', 'Unexpected request: live/provider access is forbidden');
    assert.equal(options.method, 'POST');
    this.commands.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  supabase = {
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => Promise.resolve(),
  };
  emit(type: string) {
    const prop = type === 'seeked' ? 'onSeeked' : type === 'pause' ? 'onPause' : undefined;
    if (this.reactEventFirst && prop) this.playerProps[prop]?.();
    this.media.emit(type);
    if (!this.reactEventFirst && prop) this.playerProps[prop]?.();
  }
  private progress(to: number) {
    const elapsed = to - this.now;
    if (!this.media.paused && !this.media.media.seeking) {
      this.media.position += elapsed / 1000 * this.media.playbackRate;
      this.playbackMilliseconds += elapsed;
    }
    this.now = to;
  }
  async advance(milliseconds: number, harness: Harness) {
    const target = this.now + milliseconds;
    let turns = 0;
    for (;;) {
      const next = [...this.timers].sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next || next[1].due > target) break;
      assert(++turns < 1000, 'Unexpected timer runaway');
      this.progress(next[1].due);
      if (next[1].interval) next[1].due += next[1].interval;
      else this.timers.delete(next[0]);
      next[1].callback(); await settle(harness);
    }
    this.progress(target); await settle(harness);
  }
}

class Media extends Events {
  position = 0;
  readyState = 4;
  paused = false;
  ended = false;
  duration = 600;
  muted = false;
  playbackRate = 1;
  media = { seeking: false };
  textTracks: unknown[] = [];
  shadowRoot = null;
  seeks: { at: number; target: number }[] = [];
  playCalls = 0;
  pauseCalls = 0;
  deferredPlays: { resolve(): void; reject(error: Error): void }[] = [];
  playOutcomes: PlayOutcome[] = [];
  playRequests: { at: number; muted: boolean; readyState: number; seeking: boolean }[] = [];
  throwOnSeek = false;
  private seekTimer: number | null = null;
  constructor(private environment: Environment) { super(); }
  get currentTime() { return this.position; }
  set currentTime(target: number) {
    this.environment.operations.push('seek');
    if (this.throwOnSeek) throw new DOMException('Isolated native HLS seek failure', 'InvalidStateError');
    this.position = target; this.media.seeking = true;
    this.seeks.push({ at: this.environment.now, target });
    if (this.seekTimer !== null) this.environment.clearTimeout(this.seekTimer);
    this.seekTimer = this.environment.setTimeout(() => {
      this.seekTimer = null; this.media.seeking = false; this.environment.emit('seeked');
    }, this.environment.seekLatency);
  }
  play() {
    this.environment.operations.push('play');
    this.playCalls++;
    this.playRequests.push({ at: this.environment.now, muted: this.muted,
      readyState: this.readyState, seeking: this.media.seeking,
    });
    const outcome = this.playOutcomes.shift() || 'resolve';
    if (outcome === 'pending') return new Promise<void>(() => undefined);
    if (outcome === 'deferred') return new Promise<void>((resolve, reject) => {
      this.deferredPlays.push({ resolve: () => { this.paused = false; resolve(); }, reject });
    });
    if (outcome !== 'resolve') return Promise.reject(new DOMException('Isolated play failure', outcome));
    this.paused = false; return Promise.resolve();
  }
  pause() { this.pauseCalls++; this.paused = true; this.environment.emit('pause'); }
}

function evaluate(code: string, environment: Environment, react?: Record<string, any>) {
  const testModule = { exports: {} as Record<string, any> };
  const jsx = (type: unknown, props: Record<string, any>) => {
    if (type === 'fixture-mux-player') { props.ref.current = environment.media; environment.playerProps = props; }
    return { type, props };
  };
  const imports: Record<string, unknown> = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    '@mux/mux-player-react': { default: 'fixture-mux-player' },
    '@/components/CountdownFrame': { default: 'fixture-countdown-frame' },
    '@/components/YouTubeVideoPlayer': { default: 'fixture-youtube-player' },
    '@/lib/youtube-iframe': {}, '@/lib/supabase': { supabase: environment.supabase },
    '@/hooks/useRealtimeHealth': { useRealtimeHealth: () => 'healthy' },
    '@/lib/constants': constants, '@/lib/playback-sync': playbackSync, '@/lib/youtube': youtube,
  };
  const context = createContext({
    module: testModule, exports: testModule.exports, assert, sameDeps, AbortController, DOMException,
    window: environment.window, document: environment.document, performance: { now: () => environment.now },
    setTimeout: environment.setTimeout, clearTimeout: environment.clearTimeout,
    setInterval: environment.setInterval, clearInterval: environment.clearTimeout,
    fetch: environment.fetch, HTMLElement: class {}, CustomEvent: class {},
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    console: { log() {}, warn() {}, error() {} },
    require: (name: string) => {
      if (Object.prototype.hasOwnProperty.call(imports, name)) return imports[name];
      throw new Error(`Unexpected import ${name}; live providers are forbidden`);
    },
  });
  const compiled = ts.transpileModule(code, { fileName: 'isolated-player.tsx', compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } });
  new Script(compiled.outputText).runInContext(context);
  return testModule.exports;
}
function player(environment: Environment, code = componentSource, props: Partial<Props> = {}) {
  const Constructor = evaluate(harnessSource, environment).HookHarness as { new(): Harness };
  const harness = new Constructor();
  harness.component = (evaluate(code, environment, harness.react).ProgramVideoPlayer || evaluate(code, environment, harness.react).default);
  harness.mount({ ...environment.snapshot, token: 'unsigned', title: 'Isolated cue',
    snapshotReceivedAt: 0, ...props,
  });
  return harness;
}
async function settle(harness: Harness) { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); harness.flush(); }
async function authoritativePause(environment: Environment, harness: Harness) {
  environment.snapshot.playbackState = 'paused'; environment.snapshot.playbackRevision++;
  harness.update({ playbackState: 'paused', playbackRevision: environment.snapshot.playbackRevision,
    serverNow: '2026-10-09T20:00:01.000Z', playbackPositionSeconds: 40, snapshotReceivedAt: environment.now,
  });
  await settle(harness);
}
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (value && typeof value === 'object' && 'props' in value) return text((value as Node).props.children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function recoveryLabel(harness: Harness) {
  return nodes(harness.output).filter(node => node.type === 'button').map(node => text(node)).find(label => /JOIN LIVE SHOW|TAP TO UNMUTE/.test(label));
}

// Reconstruct only the original faulty event binding in memory. Everything
// else, including the component, helper, clock and event handling, stays real.
const seekedBinding = /onSeeked=\{canBroadcastAdminControls \? handleSeek : [^}]+\}/;
assert(seekedBinding.test(componentSource), 'The host/guest seeked binding must remain explicit');
const legacySource = componentSource.replace(seekedBinding,
  'onSeeked={canBroadcastAdminControls ? handleSeek : correctViewerControlAttempt}');
const initialRecoveryState = "useState(viewerLocked && (isHoldScreen || playbackState === 'playing'))";
assert.equal(componentSource.split(initialRecoveryState).length - 1, 2, 'Both startup recovery flags must have the guest-playing initializer');
// Diagnostic-only reconstruction: the guards and play handling remain real,
// but the original hidden recovery flags reproduce the pre-fix UI dead ends.
const legacyStartupSource = componentSource.split(initialRecoveryState).join('useState(false)');
let checks = 0;
async function test(name: string, run: () => void | Promise<void>) { await run(); checks++; console.log(`PASS ${name}`); }

async function main() {
  await test('original forced seeked binding reproduces continuous seek starvation above 150ms', async () => {
    for (const reactEventFirst of [true, false]) {
      const environment = new Environment(300, reactEventFirst); const harness = player(environment, legacySource);
      await settle(harness); await environment.advance(3000, harness);
      assert.equal(environment.media.seeks.length, 11);
      assert.equal(environment.playbackMilliseconds, 0);
      assert.equal(environment.media.media.seeking, true);
      assert.equal(environment.media.playCalls, 0);
      harness.unmount();
    }
  });
  await test('fast 80ms seek control does not manufacture the original failure', async () => {
    const environment = new Environment(80); const harness = player(environment, legacySource);
    await settle(harness); await environment.advance(3000, harness);
    assert.equal(environment.media.seeks.length, 1); assert.equal(environment.playbackMilliseconds, 2920);
    assert.equal(environment.media.media.seeking, false); harness.unmount();
  });
  await test('current guest handler permits 300ms seeks to finish and playback to advance', async () => {
    for (const reactEventFirst of [true, false]) {
      const environment = new Environment(300, reactEventFirst); const harness = player(environment);
      await settle(harness); await environment.advance(3000, harness);
      assert.equal(environment.playerProps.onSeeked, undefined, 'Guest seek completion must not force another seek');
      assert.equal(environment.media.seeks.length, 1); assert.equal(environment.playbackMilliseconds, 2700);
      assert.equal(environment.media.media.seeking, false);
      assert(environment.media.currentTime > 42.5); assert.equal(environment.commands.length, 0); harness.unmount();
    }
  });
  await test('existing non-forced seeked listener still restores a large viewer seek', async () => {
    const environment = new Environment(300); environment.media.position = 40;
    const harness = player(environment); await settle(harness);
    assert.equal(environment.media.seeks.length, 0);
    environment.media.currentTime = 10;
    await environment.advance(3000, harness);
    assert.equal(environment.media.seeks.length, 2, 'One viewer seek followed by one authoritative correction');
    assert.equal(environment.media.seeks[1].at, 300);
    assert.equal(environment.media.seeks[1].target, 40.3);
    assert.equal(environment.media.media.seeking, false); assert(environment.playbackMilliseconds >= 2400);
    assert.equal(environment.commands.length, 0); harness.unmount();
  });
  await test('500ms timer still repairs large drift without a seeked event', async () => {
    const environment = new Environment(300); environment.media.position = 40;
    const harness = player(environment); await settle(harness);
    environment.media.position = 10;
    await environment.advance(2000, harness);
    assert.equal(environment.media.seeks.length, 1); assert.equal(environment.media.seeks[0].at, 500);
    assert(environment.media.currentTime > 41); assert.equal(environment.media.media.seeking, false); harness.unmount();
  });
  await test('host seeked control still emits exactly one debounced authoritative command', async () => {
    const environment = new Environment(300); const harness = player(environment, componentSource, { isAdmin: true });
    await settle(harness); assert.equal(typeof environment.playerProps.onSeeked, 'function');
    environment.media.paused = true; environment.media.position = 22; environment.emit('seeked');
    await environment.advance(499, harness); assert.equal(environment.commands.length, 0);
    await environment.advance(1, harness); assert.equal(environment.commands.length, 1);
    assert.equal(environment.commands[0].body.action, 'seek'); assert.equal(environment.commands[0].body.position, 22);
    assert.equal(environment.media.seeks.length, 0); harness.unmount();
  });
  await test('paused server cue stays paused at its exact target with no play or seek loop', async () => {
    const environment = new Environment(300); environment.snapshot.playbackState = 'paused';
    const harness = player(environment); await settle(harness); await environment.advance(3000, harness);
    assert.equal(environment.media.paused, true); assert.equal(environment.media.currentTime, 40);
    assert.equal(environment.media.seeks.length, 1); assert.equal(environment.media.playCalls, 0);
    assert.equal(environment.playbackMilliseconds, 0); assert.equal(environment.commands.length, 0); harness.unmount();
  });
  await test('hold video keeps its shared wrapped position and playing behavior', async () => {
    const environment = new Environment(300); environment.snapshot.playbackPositionSeconds = 41;
    environment.snapshot.playbackDurationSeconds = 10; environment.media.duration = 10;
    const harness = player(environment, componentSource, { isHoldScreen: true });
    await settle(harness); await environment.advance(3000, harness);
    assert.equal(environment.media.seeks.length, 1); assert.equal(environment.media.seeks[0].target, 1);
    assert.equal(environment.media.paused, false); assert.equal(environment.media.media.seeking, false);
    assert(environment.media.currentTime > 3.5); assert.equal(environment.playbackMilliseconds, 2700);
    assert.equal(environment.commands.length, 0); harness.unmount();
  });
  await test('pre-metadata guest retains Join and direct Reconnect calls play before fetching', async () => {
    const environment = new Environment(300); environment.media.readyState = 0; environment.media.paused = true;
    environment.media.playOutcomes = ['pending'];
    let reconnect: (() => void) | null = null;
    const registrations: ((() => void) | null)[] = [];
    const harness = player(environment, componentSource, { onReconnectReady: value => { reconnect = value; registrations.push(value); } });
    await settle(harness); await environment.advance(6000, harness);
    assert.equal(environment.media.playCalls, 0); assert.equal(recoveryLabel(harness), 'JOIN LIVE SHOW');
    assert.equal(typeof reconnect, 'function');
    const joinButton = nodes(harness.output).find(node => node.type === 'button' && text(node) === 'JOIN LIVE SHOW');
    assert.equal(joinButton?.props.onClick, reconnect, 'The visible Join button must use the direct registered recovery callback');
    environment.operations = [];
    (reconnect as unknown as () => void)();
    assert.equal(environment.media.playCalls, 1, 'The click must synchronously initiate playback without metadata');
    assert.deepEqual(environment.operations.slice(0, 2), ['play', 'fetch']);
    assert.equal(environment.media.playRequests[0].readyState, 0); assert.equal(environment.media.seeks.length, 0);
    await settle(harness); assert.equal(recoveryLabel(harness), 'JOIN LIVE SHOW', 'Pending play must retain the recovery path');
    assert.equal(environment.commands.length, 0); harness.unmount();
    assert.equal(reconnect, null); assert.equal(registrations.at(-1), null, 'Cleanup must clear the parent callback');
  });
  await test('unresolved startup seek does not prevent direct tap playback', async () => {
    const environment = new Environment(300); environment.media.readyState = 1; environment.media.paused = true;
    environment.media.media.seeking = true; environment.media.playOutcomes = ['pending'];
    let reconnect: (() => void) | null = null;
    const harness = player(environment, componentSource, { onReconnectReady: value => { reconnect = value; } });
    await settle(harness); await environment.advance(6000, harness);
    assert.equal(recoveryLabel(harness), 'JOIN LIVE SHOW'); assert.equal(environment.media.playCalls, 0);
    environment.operations = []; (reconnect as unknown as () => void)();
    assert.equal(environment.media.playCalls, 1); assert.equal(environment.media.playRequests[0].seeking, true);
    assert.deepEqual(environment.operations.slice(0, 2), ['play', 'fetch']); assert.equal(environment.media.seeks.length, 0);
    await settle(harness); assert.equal(recoveryLabel(harness), 'JOIN LIVE SHOW'); assert.equal(environment.commands.length, 0); harness.unmount();
  });
  await test('Reconnect retries a stalled element even when it reports paused=false', async () => {
    const environment = new Environment(300); environment.media.position = 40;
    let reconnect: (() => void) | null = null;
    const harness = player(environment, componentSource, { onReconnectReady: value => { reconnect = value; } });
    await settle(harness); assert.equal(environment.media.paused, false); assert.equal(environment.media.playCalls, 0);
    environment.operations = []; (reconnect as unknown as () => void)();
    assert.equal(environment.media.playCalls, 1); assert.deepEqual(environment.operations.slice(0, 2), ['play', 'fetch']);
    await settle(harness); assert.equal(recoveryLabel(harness), undefined); assert.equal(environment.commands.length, 0); harness.unmount();
  });
  await test('tap projects the latest cue before play, but a native seek error cannot suppress play', async () => {
    for (const throwOnSeek of [false, true]) {
      const environment = new Environment(300); environment.media.readyState = 0; environment.media.paused = true;
      environment.media.position = 10; environment.media.playOutcomes = ['pending'];
      let reconnect: (() => void) | null = null;
      const harness = player(environment, componentSource, { onReconnectReady: value => { reconnect = value; } });
      await settle(harness); environment.media.readyState = 1; environment.media.throwOnSeek = throwOnSeek;
      environment.operations = []; (reconnect as unknown as () => void)();
      assert.deepEqual(environment.operations.slice(0, 3), ['seek', 'play', 'fetch']);
      assert.equal(environment.media.playCalls, 1);
      if (!throwOnSeek) assert.equal(environment.media.seeks[0].target, 40);
      assert.equal(environment.commands.length, 0); harness.unmount();
    }
  });
  await test('Reconnect respects an authoritative paused cue and never sends playback commands', async () => {
    const environment = new Environment(300); environment.snapshot.playbackState = 'paused';
    let reconnect: (() => void) | null = null;
    const harness = player(environment, componentSource, { onReconnectReady: value => { reconnect = value; } });
    await settle(harness); await environment.advance(1000, harness);
    assert.equal(recoveryLabel(harness), undefined); assert.equal(environment.media.paused, true);
    environment.operations = []; (reconnect as unknown as () => void)();
    assert(!environment.operations.includes('play')); assert.equal(environment.media.playCalls, 0);
    await settle(harness); assert.equal(environment.media.paused, true); assert.equal(environment.commands.length, 0); harness.unmount();
  });
  await test('pending or aborted startup cannot remove the guest recovery control', async () => {
    for (const outcome of ['pending', 'AbortError'] as const) {
      const environment = new Environment(300); environment.media.position = 40; environment.media.paused = true;
      environment.media.playOutcomes = Array<PlayOutcome>(30).fill(outcome);
      const harness = player(environment); await settle(harness);
      assert.equal(recoveryLabel(harness), 'JOIN LIVE SHOW'); await environment.advance(6000, harness);
      assert.equal(recoveryLabel(harness), 'JOIN LIVE SHOW'); assert.equal(environment.media.paused, true);
      assert.equal(environment.commands.length, 0); harness.unmount();
    }
  });
  await test('authoritative pause arriving during first play prevents a late muted retry or error prompt', async () => {
    for (const name of ['NotAllowedError', 'AbortError', 'NotSupportedError']) {
      const environment = new Environment(300); environment.media.position = 40; environment.media.paused = true;
      environment.media.playOutcomes = ['deferred'];
      const harness = player(environment); await settle(harness);
      assert.equal(environment.media.playCalls, 1); assert.equal(environment.media.deferredPlays.length, 1);
      await authoritativePause(environment, harness); assert.equal(recoveryLabel(harness), undefined);
      environment.media.deferredPlays[0].reject(new DOMException('Isolated late first-play rejection', name));
      await settle(harness);
      assert.equal(environment.media.playCalls, 1, 'A paused cue must not trigger a muted fallback');
      assert.equal(environment.media.muted, false); assert.equal(environment.media.paused, true);
      assert.equal(recoveryLabel(harness), undefined); assert.equal(environment.commands.length, 0); harness.unmount();
    }
  });
  await test('late first-play success is immediately paused when the authoritative cue stopped', async () => {
    const environment = new Environment(300); environment.media.position = 40; environment.media.paused = true;
    environment.media.playOutcomes = ['deferred'];
    const harness = player(environment); await settle(harness); await authoritativePause(environment, harness);
    environment.media.deferredPlays[0].resolve(); assert.equal(environment.media.paused, false, 'Model the provider completing its old play request');
    await settle(harness);
    assert.equal(environment.media.paused, true); assert.equal(environment.media.pauseCalls, 1);
    assert.equal(environment.media.playCalls, 1); assert.equal(recoveryLabel(harness), undefined);
    assert.equal(environment.commands.length, 0); harness.unmount();
  });
  await test('authoritative pause during muted fallback suppresses both late success and late error UI', async () => {
    for (const outcome of ['resolve', 'reject'] as const) {
      const environment = new Environment(300); environment.media.position = 40; environment.media.paused = true;
      environment.media.playOutcomes = ['NotAllowedError', 'deferred'];
      const harness = player(environment); await settle(harness);
      assert.equal(environment.media.playCalls, 2); assert.equal(environment.media.muted, true);
      assert.equal(environment.media.deferredPlays.length, 1); await authoritativePause(environment, harness);
      if (outcome === 'resolve') environment.media.deferredPlays[0].resolve();
      else environment.media.deferredPlays[0].reject(new DOMException('Isolated late muted rejection', 'NotAllowedError'));
      await settle(harness);
      assert.equal(environment.media.paused, true); assert.equal(environment.media.playCalls, 2);
      assert.equal(recoveryLabel(harness), undefined);
      if (outcome === 'resolve') assert.equal(environment.media.pauseCalls, 1);
      assert.equal(environment.commands.length, 0); harness.unmount();
    }
  });
  await test('retired player callback and late first-play failure cannot restart media or write state', async () => {
    const environment = new Environment(300); environment.media.position = 40; environment.media.paused = true;
    environment.media.playOutcomes = ['deferred']; let reconnect: (() => void) | null = null;
    const harness = player(environment, componentSource, { onReconnectReady: value => { reconnect = value; } });
    await settle(harness); const retiredReconnect = reconnect as unknown as () => void; harness.unmount();
    assert.equal(reconnect, null); retiredReconnect(); assert.equal(environment.media.playCalls, 1);
    environment.media.deferredPlays[0].reject(new DOMException('Isolated late unmounted failure', 'NotAllowedError'));
    await settle(harness); assert.equal(environment.media.playCalls, 1); assert.equal(harness.writesAfterUnmount, 0);
    assert.equal(environment.commands.length, 0);
  });
  await test('audience Reconnect and Reload are wired to immediate player recovery before cue refresh', async () => {
    const audienceSource = source('components/2006/AimExperience.tsx');
    const ast = ts.createSourceFile('AimExperience.tsx', audienceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declarations = new Map<string, string>(); let clickBindings = 0; let readyBinding = false;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        && ['reconnectVideoRef', 'registerVideoReconnect', 'reconnectStream'].includes(node.name.text)) {
        declarations.set(node.name.text, `const ${node.getText(ast)};`);
      }
      if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer)
        && node.initializer.expression && ts.isIdentifier(node.initializer.expression)) {
        if (node.name.getText(ast) === 'onClick' && node.initializer.expression.text === 'reconnectStream') clickBindings++;
        if (node.name.getText(ast) === 'onReconnectReady' && node.initializer.expression.text === 'registerVideoReconnect') readyBinding = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(ast); assert.equal(declarations.size, 3); assert(clickBindings >= 2); assert.equal(readyBinding, true);
    const environment = new Environment(300);
    const callbackModule = evaluate(`import { useCallback, useRef } from 'react';
      const refreshStream = () => fetch('/api/current');
      ${[...declarations.values()].join('\n')}
      export { registerVideoReconnect, reconnectStream };`, environment,
    { useCallback: (callback: () => void) => callback, useRef: () => ({ current: null }) });
    callbackModule.registerVideoReconnect(() => environment.operations.push('play'));
    callbackModule.reconnectStream(); assert.deepEqual(environment.operations, ['play', 'fetch']);
    environment.operations = []; callbackModule.registerVideoReconnect(null); callbackModule.reconnectStream();
    assert.deepEqual(environment.operations, ['fetch']); assert.equal(environment.commands.length, 0);
    environment.operations = []; callbackModule.registerVideoReconnect(() => { throw new Error('Isolated provider callback failure'); });
    assert.doesNotThrow(() => callbackModule.reconnectStream()); assert.deepEqual(environment.operations, ['fetch']);
  });
  if (process.argv.includes('--diagnose-startup')) {
    console.log('DIAGNOSTIC MODE: assertions below reconstruct the original hidden-startup gap in memory.');
    await test('original pre-metadata state never reaches play deadline or renders a recovery control', async () => {
      const environment = new Environment(300); environment.media.readyState = 0; environment.media.paused = true;
      const harness = player(environment, legacyStartupSource); await settle(harness); await environment.advance(6000, harness);
      assert.equal(environment.playerProps.autoPlay, false);
      assert.equal(environment.playerProps.style['--play-button'], 'none');
      assert.equal(environment.media.playCalls, 0); assert.equal(environment.media.seeks.length, 0);
      assert.equal(recoveryLabel(harness), undefined);
      // Model a freshly read unchanged cue, as the parent's Reconnect does.
      harness.update({ serverNow: '2026-10-09T20:00:06.000Z', playbackPositionSeconds: 46, snapshotReceivedAt: environment.now });
      await settle(harness); await environment.advance(1000, harness);
      assert.equal(environment.media.playCalls, 0); assert.equal(recoveryLabel(harness), undefined);
      console.log(`EVIDENCE readyState=0: ${environment.media.playCalls} play calls, no Join, ${environment.currentReads} successful fake cue reads, including unchanged-cue refresh.`);
      assert.equal(environment.commands.length, 0); harness.unmount();
    });
    await test('original metadata-ready but unresolved seek also bypasses play and recovery UI', async () => {
      const environment = new Environment(300); environment.media.readyState = 1; environment.media.paused = true;
      environment.media.media.seeking = true;
      const harness = player(environment, legacyStartupSource); await settle(harness); await environment.advance(6000, harness);
      assert.equal(environment.media.playCalls, 0); assert.equal(environment.media.seeks.length, 0);
      assert.equal(recoveryLabel(harness), undefined); assert.equal(environment.media.media.seeking, true);
      console.log('EVIDENCE readyState=1,seeking=true: 0 play calls, no Join after 6 seconds; safePlay timeout never starts.');
      assert.equal(environment.commands.length, 0); harness.unmount();
    });
    await test('NotAllowed rejection retries muted and exposes an unmute control after actual play resolves', async () => {
      const environment = new Environment(300); environment.media.position = 40; environment.media.paused = true;
      environment.media.playOutcomes = ['NotAllowedError', 'resolve'];
      const harness = player(environment, legacyStartupSource); await settle(harness);
      assert.equal(environment.media.playCalls, 2); assert.equal(environment.media.paused, false);
      assert.equal(environment.media.playRequests[0].muted, false); assert.equal(environment.media.playRequests[1].muted, true);
      assert.match(recoveryLabel(harness) || '', /TAP TO UNMUTE/); assert(!/JOIN LIVE SHOW/.test(recoveryLabel(harness) || ''));
      assert.equal(environment.commands.length, 0); harness.unmount();
    });
    await test('both unmuted and muted NotAllowed rejection expose Join instead of silently freezing', async () => {
      const environment = new Environment(300); environment.media.position = 40; environment.media.paused = true;
      environment.media.playOutcomes = ['NotAllowedError', 'NotAllowedError'];
      const harness = player(environment, legacyStartupSource); await settle(harness);
      assert.equal(environment.media.playCalls, 2); assert.equal(environment.media.paused, true);
      assert.equal(recoveryLabel(harness), 'JOIN LIVE SHOW'); assert.equal(environment.commands.length, 0); harness.unmount();
    });
    await test('initial AbortError keeps recovery control absent despite repeated paused retries', async () => {
      const environment = new Environment(300); environment.media.position = 40; environment.media.paused = true;
      environment.media.playOutcomes = Array<PlayOutcome>(30).fill('AbortError');
      const harness = player(environment, legacyStartupSource); await settle(harness); await environment.advance(6000, harness);
      assert(environment.media.playCalls >= 10); assert.equal(environment.media.paused, true);
      assert.equal(recoveryLabel(harness), undefined);
      console.log(`EVIDENCE AbortError: ${environment.media.playCalls} failed play calls after 6 seconds, no Join.`);
      assert.equal(environment.commands.length, 0); harness.unmount();
    });
    await test('never-settling initial play promise shows Join only once safePlay deadline can run', async () => {
      const environment = new Environment(300); environment.media.position = 40; environment.media.paused = true;
      environment.media.playOutcomes = Array<PlayOutcome>(10).fill('pending');
      const harness = player(environment, legacyStartupSource); await settle(harness); await environment.advance(4999, harness);
      assert.equal(environment.media.playCalls, 1); assert.equal(recoveryLabel(harness), undefined);
      await environment.advance(1, harness);
      assert.equal(recoveryLabel(harness), 'JOIN LIVE SHOW'); assert.equal(environment.media.paused, true);
      assert.equal(environment.commands.length, 0); harness.unmount();
    });
    await test('never-settling muted fallback also reaches Join after its deadline', async () => {
      const environment = new Environment(300); environment.media.position = 40; environment.media.paused = true;
      environment.media.playOutcomes = ['NotAllowedError', 'pending', 'pending'];
      const harness = player(environment, legacyStartupSource); await settle(harness); await environment.advance(4999, harness);
      assert.equal(environment.media.playCalls, 2); assert.equal(environment.media.muted, true);
      assert.equal(recoveryLabel(harness), undefined); await environment.advance(1, harness);
      assert.equal(recoveryLabel(harness), 'JOIN LIVE SHOW'); assert.equal(environment.commands.length, 0); harness.unmount();
    });
  }
  await test('countdown out point pauses the actual player and Reconnect cannot restart it', async () => {
    const environment = new Environment(80);
    environment.snapshot = { ...environment.snapshot, clipEndSeconds: 42 } as typeof environment.snapshot;
    let reconnect: (() => void) | null = null;
    const harness = player(environment, componentSource, { clipEndSeconds: 42, onReconnectReady: value => { reconnect = value; } });
    await settle(harness); await environment.advance(3500,harness);
    assert.equal(environment.media.paused,true);
    const plays = environment.media.playCalls;
    (reconnect as (() => void) | null)?.();
    await settle(harness); await environment.advance(500,harness);
    assert.equal(environment.media.playCalls,plays);
    assert.equal(environment.media.paused,true);
    assert.equal(environment.commands.length,0);
    harness.unmount();
  });
  console.log(`Mux seek recovery: ${checks} actual-source checks passed; no network, database, browser, or live writes.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
