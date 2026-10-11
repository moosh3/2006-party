/** Executes the real IFrame loader and player component with a fake browser/API.
 * No network, live show commands, credentials, or renderer dependencies. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';
import * as clockHelpers from '../lib/playback-sync';
import * as youtubeHelpers from '../lib/youtube-playback';
import type PlayerComponent from '../components/YouTubeVideoPlayer';

type Props = Parameters<typeof PlayerComponent>[0];
type Node = { type: unknown; props: Record<string, any>; key?: string };
type Harness<P, O> = {
  component: (props: P) => O; props: P; output: O; react: Record<string, any>; writesAfterUnmount: number;
  mount(props: P): O; update(props: Partial<P>): O; flush(): O; strictModeReplay(): O; unmount(): void;
};
const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path: string) => readFileSync(join(project, path), 'utf8');
const shared = source('scripts/test-cast-run-interaction.ts');
const harnessStart = shared.indexOf('class HookHarness<');
const harnessEnd = shared.indexOf('\nfunction evaluateModule(', harnessStart);
assert(harnessStart >= 0 && harnessEnd > harnessStart);
const harnessSource = `${shared.slice(harnessStart, harnessEnd)}\nexport { HookHarness };`;
const sameDeps = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

class Events {
  listeners = new Map<string, Set<() => void>>();
  addEventListener = (name: string, callback: () => void) => {
    const values = this.listeners.get(name) || new Set(); values.add(callback); this.listeners.set(name, values);
  };
  removeEventListener = (name: string, callback: () => void) => { this.listeners.get(name)?.delete(callback); };
  emit(name: string) { for (const callback of [...(this.listeners.get(name) || [])]) callback(); }
  count(name: string) { return this.listeners.get(name)?.size || 0; }
}
class Element extends Events {
  src = ''; title = ''; async = false; referrerPolicy = ''; style: Record<string, any> = {};
  attributes: Record<string, string> = {}; children: Element[] = []; removed = false;
  constructor(public tag: string) { super(); }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  replaceChildren(...children: Element[]) { this.children = children; }
  remove() { this.removed = true; }
}
type Request = { signal: AbortSignal; resolve(data: unknown): void; reject(): void };
class Environment {
  now = 1000;
  nextTimer = 0;
  timers = new Map<number, { due: number; interval?: number; callback: () => void }>();
  scripts: Element[] = [];
  mount = new Element('div');
  window = Object.assign(new Events(), {
    location: { origin: 'https://show.invalid' },
    setTimeout: (callback: () => void, delay: number) => this.timer(callback, delay),
    clearTimeout: (id: number) => { this.timers.delete(id); },
    setInterval: (callback: () => void, delay: number) => this.timer(callback, delay, delay),
    clearInterval: (id: number) => { this.timers.delete(id); },
  }) as Events & Record<string, any>;
  document = Object.assign(new Events(), {
    visibilityState: 'visible',
    querySelector: (_selector: string) => this.scripts.find(script => !script.removed) || null,
    createElement: (tag: string) => new Element(tag),
    head: { appendChild: (script: Element) => { this.scripts.push(script); } },
  });
  requests: Request[] = [];
  players: FakePlayer[] = [];
  refreshes = 0;
  loader: () => Promise<any> = () => Promise.resolve(this.api);
  api = {
    Player: (() => {
      const environment = this;
      return class extends FakePlayer {
        constructor(element: Element, options: Record<string, any>) { super(environment, element, options); }
      };
    })(),
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  };
  timer(callback: () => void, delay: number, interval?: number) {
    const id = ++this.nextTimer; this.timers.set(id, { due: this.now + delay, interval, callback }); return id;
  }
  advance(milliseconds: number) {
    const target = this.now + milliseconds;
    let turns = 0;
    for (;;) {
      const next = [...this.timers].sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next || next[1].due > target) break;
      assert(++turns < 2000, 'Unexpected timer loop'); this.now = next[1].due;
      if (next[1].interval) next[1].due += next[1].interval;
      else this.timers.delete(next[0]);
      next[1].callback();
    }
    this.now = target;
  }
  fetch = (url: string, options: Record<string, any> = {}) => {
    assert.equal(url, '/api/current', 'A browser may only read the authoritative clock, never advance the queue');
    assert.equal(options.method, undefined, 'No browser-ended mutation is allowed');
    assert.equal(options.cache, 'no-store');
    return new Promise((resolve, reject) => {
      const request = {
        signal: options.signal as AbortSignal,
        resolve: (data: unknown) => resolve({ ok: true, json: async () => data }),
        reject: () => reject(new Error('Isolated network failure')),
      };
      request.signal.addEventListener('abort', () => reject(new Error('Aborted')));
      this.requests.push(request);
    });
  };
}
class FakePlayer {
  duration = 0; current = 0; state = -1; muted = false; destroyed = 0; seeks: number[] = [];
  loads: Record<string, any>[] = []; cues: Record<string, any>[] = []; plays = 0; pauses = 0;
  ignoreSeek = false; blockPlay = false;
  constructor(public environment: Environment, public element: Element, public options: Record<string, any>) {
    // Referrer, native accessibility, CC defaults, and permissions must be set
    // before YouTube starts the iframe, not only after a possible error 153.
    assert.equal(element.referrerPolicy, 'strict-origin-when-cross-origin');
    assert.match(element.attributes.allow, /autoplay/);
    assert.equal(options.playerVars.controls, 1);
    assert.equal(options.playerVars.cc_load_policy, 1);
    assert.equal(options.playerVars.origin, 'https://show.invalid');
    environment.players.push(this);
  }
  ready() { this.options.events.onReady({ target: this }); }
  emit(state: number) { this.state = state; this.options.events.onStateChange({ target: this, data: state }); }
  error(code: number) { this.options.events.onError({ target: this, data: code }); }
  autoplayBlocked() { this.options.events.onAutoplayBlocked({ target: this }); }
  getIframe = () => this.element;
  destroy = () => { this.destroyed++; };
  mute = () => { this.muted = true; };
  unMute = () => { this.muted = false; };
  isMuted = () => this.muted;
  getDuration = () => this.duration;
  getCurrentTime = () => this.current;
  getPlayerState = () => this.state;
  loadVideoById = (options: Record<string, any>) => { this.loads.push(options); this.state = 3; };
  cueVideoById = (options: Record<string, any>) => { this.cues.push(options); this.state = 5; };
  seekTo = (seconds: number) => {
    this.seeks.push(seconds);
    if (this.ignoreSeek) { this.ignoreSeek = false; return; }
    this.current = seconds;
    if (this.state === 5) this.state = 1;
  };
  playVideo = () => {
    this.plays++;
    if (this.blockPlay) this.autoplayBlocked(); else this.state = 1;
  };
  pauseVideo = () => { this.pauses++; this.state = 2; };
}
function evaluate(code: string, environment: Environment, react?: Record<string, any>) {
  const module = { exports: {} as Record<string, any> };
  const jsx = (type: unknown, props: Record<string, any>, key?: string) => {
    if (props.ref && type === 'div') props.ref.current = environment.mount;
    return { type, props, key };
  };
  const context = createContext({
    module, exports: module.exports, assert, sameDeps,
    window: environment.window, document: environment.document,
    performance: { now: () => environment.now }, AbortController, URLSearchParams,
    fetch: environment.fetch, console: { log() {}, warn() {}, error() {} },
    require: (name: string) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === '@/lib/playback-sync') return clockHelpers;
      if (name === '@/lib/youtube-playback') return youtubeHelpers;
      if (name === '@/lib/youtube-iframe') return { loadYouTubeIframeApi: () => environment.loader() };
      throw new Error(`Unexpected import ${name}; live providers are prohibited`);
    },
  });
  const output = ts.transpileModule(code, { fileName: 'fixture.tsx', compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } });
  new Script(output.outputText).runInContext(context);
  return module.exports;
}
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node; return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (value && typeof value === 'object' && 'props' in value) return text((value as Node).props.children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function button(harness: Harness<Props, Node>, name: string) {
  const found = nodes(harness.output).find(node => node.type === 'button' && text(node) === name);
  assert(found, `${name} must remain available`); return found;
}
const baseSnapshot = {
  playbackId: 'youtube:video:M7lc1UVf-VE', sourceType: 'youtube_video',
  playbackSessionId: '00000000-0000-4000-8000-000000000001', playbackRevision: 4,
  serverNow: '2026-10-09T22:00:00.000Z', playbackState: 'playing', playbackPositionSeconds: 83,
  playbackDurationSeconds: 250,
};
async function settle(harness?: Harness<any, any>) {
  for (let tick = 0; tick < 12; tick++) await Promise.resolve();
  harness?.flush();
}
async function setup(overrides: Partial<Props> = {}, environment = new Environment()) {
  const Constructor = evaluate(harnessSource, environment).HookHarness as { new(): Harness<Props, Node> };
  const harness = new Constructor();
  harness.component = evaluate(source('components/YouTubeVideoPlayer.tsx'), environment, harness.react).default;
  harness.mount({ videoId: 'M7lc1UVf-VE', title: 'Isolated video', snapshot: { ...baseSnapshot },
    snapshotReceivedAt: environment.now, onStreamRefresh: () => environment.refreshes++, ...overrides });
  await settle(harness);
  return { harness, environment, player: environment.players[0] };
}
let checks = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run(); checks++; process.stdout.write(`✓ ${name}\n`);
}

async function main() {
await test('shared script load deduplicates and preserves other callbacks', async () => {
  const environment = new Environment();
  let previous = 0;
  const original = () => { previous++; throw new Error('Other embed failure'); };
  environment.window.onYouTubeIframeAPIReady = original;
  const loader = evaluate(source('lib/youtube-iframe.ts'), environment).loadYouTubeIframeApi;
  const first = loader(); const second = loader();
  assert.equal(first, second); assert.equal(environment.scripts.length, 1);
  environment.window.YT = environment.api;
  environment.window.onYouTubeIframeAPIReady();
  assert.equal(await first, environment.api); assert.equal(previous, 1);
  assert.equal(environment.window.onYouTubeIframeAPIReady, original);
  assert.equal(environment.timers.size, 0); assert.equal(environment.scripts[0].count('error'), 0);
  assert.equal(await loader(), environment.api);
});
await test('script network error rejects, cleans up, and permits a real retry', async () => {
  const environment = new Environment();
  const loader = evaluate(source('lib/youtube-iframe.ts'), environment).loadYouTubeIframeApi;
  const failure = loader(); environment.scripts[0].emit('error');
  await assert.rejects(failure, /could not be reached/); await settle();
  assert(environment.scripts[0].removed); assert.equal(environment.timers.size, 0);
  const retry = loader(); assert.equal(environment.scripts.length, 2);
  environment.window.YT = environment.api; environment.window.onYouTubeIframeAPIReady();
  assert.equal(await retry, environment.api);
});
await test('script timeout rejects within 12 seconds and releases the shared promise', async () => {
  const environment = new Environment();
  const loader = evaluate(source('lib/youtube-iframe.ts'), environment).loadYouTubeIframeApi;
  const attempt = loader(); const rejected = assert.rejects(attempt, /could not be reached/);
  environment.advance(12000); await rejected; await settle();
  assert.equal(environment.timers.size, 0); assert(environment.scripts[0].removed);
  const retry = loader(); environment.window.YT = environment.api; environment.window.onYouTubeIframeAPIReady(); await retry;
});
await test('late join loads the sampled position and retries the seek after metadata', async () => {
  const { harness, environment, player } = await setup();
  player.ready(); harness.flush(); assert.equal(player.loads[0].startSeconds, 83); assert(player.muted);
  assert.equal(player.seeks.length, 0, 'Missing duration must not consume the forced metadata seek');
  environment.advance(2000); player.duration = 250; player.current = 0;
  environment.advance(500); harness.flush();
  assert.equal(player.seeks.at(-1), 85.5);
  assert.equal(player.current, 85.5); player.emit(1); assert.equal(player.state, 1);
  assert.equal(player.options.playerVars.cc_lang_pref, 'en');
  assert.match(player.element.src, /cc_load_policy=1/);
  assert.equal(player.element.title, 'Isolated video');
  harness.unmount();
});
await test('server pause seeks exactly, stays paused, and resumes with the next revision', async () => {
  const { harness, environment, player } = await setup({ snapshot: { ...baseSnapshot, playbackState: 'paused', playbackPositionSeconds: 37.25 } });
  player.ready(); harness.flush(); assert.equal(player.cues[0].startSeconds, 37.25);
  player.duration = 250; player.current = 12; player.state = 1;
  environment.advance(500); harness.flush(); assert.equal(player.current, 37.25); assert.equal(player.state, 2);
  environment.advance(3000); harness.flush(); assert.equal(player.current, 37.25);
  harness.update({ snapshot: { ...baseSnapshot, playbackRevision: 5, playbackPositionSeconds: 37.25 }, snapshotReceivedAt: environment.now });
  assert.equal(player.state, 1); environment.advance(500); harness.flush();
  assert(player.current >= 37.25); harness.unmount();
});
await test('a metadata-less initial paused cue loads media when the host resumes', async () => {
  const { harness, environment, player } = await setup({ snapshot: { ...baseSnapshot, playbackState: 'paused', playbackPositionSeconds: 120.265 } });
  player.ready(); harness.flush();
  assert.equal(player.duration, 0); assert.equal(player.cues[0].startSeconds, 120.265);
  assert.equal(player.plays, 0, 'Paused entry must not flash a playing video');
  environment.advance(30000); harness.flush();
  assert.equal(player.plays, 0); assert.equal(player.current, 0);
  harness.update({ snapshot: { ...baseSnapshot, playbackRevision: 5, playbackPositionSeconds: 120.265 }, snapshotReceivedAt: environment.now });
  assert(player.plays > 0, 'Resume must request media even before metadata exists');
  assert.equal(player.state, 1); assert.equal(player.duration, 0);
  environment.advance(1000); player.duration = 250; player.current = 0; player.emit(1); harness.flush();
  assert.equal(player.current, 121.265, 'Metadata arrival must reproject and seek the latest show clock');
  assert.equal(player.state, 1); harness.unmount();
});
await test('drift and native seeks follow the server without hiding CC controls', async () => {
  const { harness, environment, player } = await setup();
  player.duration = 250; player.ready(); harness.flush(); player.current = 5;
  environment.advance(500); harness.flush(); assert.equal(player.current, 83.5);
  player.state = 2; player.emit(2); harness.flush(); assert.equal(player.state, 1);
  assert(!nodes(harness.output).some(node => /absolute inset-0/.test(node.props.className || '')));
  assert.equal(player.options.playerVars.disablekb, undefined);
  harness.unmount();
});
await test('autoplay fallback has a tap-to-join path that seeks before unmuting/play', async () => {
  const { harness, environment, player } = await setup();
  player.ready(); player.blockPlay = true; player.autoplayBlocked(); harness.flush();
  const join = button(harness, 'Join live show');
  environment.advance(1200); player.blockPlay = false;
  join.props.onClick(); harness.flush();
  assert.equal(player.current, 84.2); assert.equal(player.muted, false); assert.equal(player.state, 1);
  environment.advance(500); harness.flush();
  assert(!nodes(harness.output).some(node => node.type === 'button')); harness.unmount();
});
await test('registered Reconnect seeks and starts synchronously before refreshing the clock', async () => {
  const environment = new Environment();
  const recovery: { current: (() => void) | null } = { current: null };
  let registrations = 0;
  let assertStartBeforeFetch = false;
  let playsBeforeReconnect = 0;
  const originalFetch = environment.fetch;
  environment.fetch = (url, options) => {
    if (assertStartBeforeFetch) {
      assert.equal(environment.players[0].plays, playsBeforeReconnect + 1);
      assert.equal(environment.players[0].muted, false);
    }
    return originalFetch(url, options);
  };
  const { harness, player } = await setup({ onReconnectReady: callback => {
    recovery.current = callback; registrations++;
  } }, environment);
  player.duration = 250; player.ready(); harness.flush();
  environment.requests[0].resolve({ ...baseSnapshot }); await settle(harness);
  environment.advance(1200); player.current = 0; player.state = 2;
  const registered = recovery.current;
  assert(registered, 'The current iframe must register a direct tap handler');
  playsBeforeReconnect = player.plays;
  const requestsBeforeReconnect = environment.requests.length;
  assertStartBeforeFetch = true;
  registered();
  assert.equal(player.current, 84.2);
  assert.equal(player.state, 1);
  assert.equal(environment.requests.length, requestsBeforeReconnect + 1);
  assertStartBeforeFetch = false; harness.flush();
  const registrationsBeforePoll = registrations;
  harness.update({ snapshot: { ...baseSnapshot, serverNow: '2026-10-09T22:00:01.200Z', playbackPositionSeconds: 84.2 }, snapshotReceivedAt: environment.now });
  assert.equal(recovery.current, registered, 'Healthy polls must not replace the direct tap handler');
  assert.equal(registrations, registrationsBeforePoll);
  harness.unmount(); assert.equal(recovery.current, null);
});
await test('registered Reconnect honors a paused server and loops a hold cue', async () => {
  const recovery: { current: (() => void) | null } = { current: null };
  const { harness, player } = await setup({
    snapshot: { ...baseSnapshot, playbackState: 'paused', playbackPositionSeconds: 44 },
    onReconnectReady: callback => { recovery.current = callback; },
  });
  player.ready(); harness.flush(); assert(recovery.current);
  const playsBefore = player.plays;
  recovery.current(); harness.flush();
  assert.equal(player.plays, playsBefore, 'Reconnect must never override the host pause');
  assert.equal(player.current, 44); assert.equal(player.state, 2);
  harness.update({ isHoldScreen: true }); await settle(harness);
  const holdPlayer = player.environment.players.at(-1)!;
  holdPlayer.ready(); harness.flush(); assert(recovery.current);
  const holdPlaysBefore = holdPlayer.plays;
  recovery.current(); harness.flush();
  assert.equal(holdPlayer.plays, holdPlaysBefore + 1);
  assert.equal(holdPlayer.state, 1); assert.equal(holdPlayer.current, 44);
  harness.unmount();
});
await test('registered Reconnect retries a failed iframe without resetting its shared position', async () => {
  const recovery: { current: (() => void) | null } = { current: null };
  const { harness, environment, player } = await setup({ onReconnectReady: callback => { recovery.current = callback; } });
  player.ready(); harness.flush(); player.error(5); harness.flush();
  assert(recovery.current); recovery.current(); harness.flush(); await settle(harness);
  assert.equal(player.destroyed, 1); assert.equal(environment.players.length, 2);
  environment.advance(1200);
  const replacement = environment.players[1]; replacement.ready(); harness.flush();
  assert.equal(replacement.loads[0].startSeconds, 84.2);
  assert.equal(replacement.options.playerVars.cc_load_policy, 1);
  assert(recovery.current); recovery.current(); harness.flush(); assert.equal(replacement.state, 1);
  harness.unmount(); assert.equal(recovery.current, null);
});
await test('Reconnect registration survives StrictMode and retires its unmounted handler', async () => {
  const recovery: { current: (() => void) | null } = { current: null };
  const registrations: Array<(() => void) | null> = [];
  const { harness, environment, player } = await setup({ onReconnectReady: callback => {
    recovery.current = callback; registrations.push(callback);
  } });
  player.ready(); harness.flush(); harness.strictModeReplay(); await settle(harness);
  assert(registrations.includes(null)); assert(recovery.current);
  const replacement = environment.players[1]; replacement.ready(); harness.flush();
  const retired = recovery.current;
  const playsBefore = replacement.plays; const requestsBefore = environment.requests.length;
  harness.unmount(); assert.equal(recovery.current, null); retired(); await settle();
  assert.equal(replacement.plays, playsBefore);
  assert.equal(environment.requests.length, requestsBefore);
  assert.equal(harness.writesAfterUnmount, 0);
});
await test('turning on sound during a server pause never plays the show locally', async () => {
  const { harness, player } = await setup({ snapshot: { ...baseSnapshot, playbackState: 'paused', playbackPositionSeconds: 44 } });
  player.ready(); harness.flush(); button(harness, 'Turn on sound').props.onClick(); harness.flush();
  assert.equal(player.current, 44); assert.equal(player.state, 2); assert.equal(player.muted, false);
  harness.unmount();
});
await test('native volume controls can dismiss the transient sound prompt', async () => {
  const { harness, environment, player } = await setup();
  player.duration = 250; player.ready(); harness.flush(); button(harness, 'Turn on sound');
  player.unMute(); environment.advance(500); harness.flush();
  assert(!nodes(harness.output).some(node => node.type === 'button')); harness.unmount();
});
await test('a retry retains the viewer sound choice and falls back if unmuted autoplay is blocked', async () => {
  const { harness, environment, player } = await setup();
  player.ready(); harness.flush(); button(harness, 'Turn on sound').props.onClick(); harness.flush();
  player.error(5); harness.flush(); button(harness, 'Retry YouTube').props.onClick(); harness.flush(); await settle(harness);
  const next = environment.players[1]; next.ready(); harness.flush(); assert.equal(next.muted, false);
  next.autoplayBlocked(); harness.flush(); assert.equal(next.muted, true);
  button(harness, 'Join live show'); harness.unmount();
});
await test('ended is only a refresh hint and a finished cue is not restarted', async () => {
  const { harness, environment, player } = await setup({ snapshot: { ...baseSnapshot, playbackPositionSeconds: 249.5 } });
  player.duration = 250; player.ready(); harness.flush(); environment.advance(1000);
  player.current = 250; const playsBefore = player.plays; player.emit(0); harness.flush();
  environment.advance(1000); harness.flush();
  assert.equal(player.plays, playsBefore); assert(environment.refreshes > 0);
  assert(environment.requests.length > 0); harness.unmount();
});
await test('a server seek back after an ended cue can resume the same session', async () => {
  const { harness, environment, player } = await setup({ snapshot: { ...baseSnapshot, playbackPositionSeconds: 249.5 } });
  player.duration = 250; player.ready(); environment.advance(1000); player.current = 250; player.emit(0); harness.flush();
  harness.update({ snapshot: { ...baseSnapshot, playbackRevision: 5, playbackPositionSeconds: 20 }, snapshotReceivedAt: environment.now });
  assert.equal(player.current, 20); assert.equal(player.state, 1); harness.unmount();
});
await test('stale clock responses cannot rewind a new revision', async () => {
  const { harness, environment, player } = await setup();
  player.duration = 250; player.ready(); harness.flush();
  harness.update({ snapshot: { ...baseSnapshot, playbackRevision: 6, playbackPositionSeconds: 120 }, snapshotReceivedAt: environment.now });
  environment.requests[0].resolve({ ...baseSnapshot, playbackPositionSeconds: 2 }); await settle(harness);
  assert.equal(player.current, 120); harness.unmount();
});
await test('a new session refreshes the parent instead of applying its position to this iframe', async () => {
  const { harness, environment, player } = await setup();
  player.duration = 250; player.ready(); harness.flush();
  environment.requests[0].resolve({ ...baseSnapshot, playbackSessionId: 'next-session', playbackPositionSeconds: 0 });
  await settle(harness); assert.equal(environment.refreshes, 1); assert.equal(player.current, 83);
  harness.unmount();
});
await test('tab resume projects its monotonic anchor and requests a fresh snapshot', async () => {
  const { harness, environment, player } = await setup();
  player.duration = 250; player.ready(); harness.flush();
  environment.requests[0].resolve({ ...baseSnapshot }); await settle(harness);
  environment.document.visibilityState = 'hidden'; environment.advance(2000); player.current = 1;
  environment.document.emit('visibilitychange'); assert.equal(player.current, 1);
  environment.document.visibilityState = 'visible'; environment.document.emit('visibilitychange'); harness.flush();
  assert.equal(player.current, 85); assert.equal(environment.requests.length, 2);
  assert.equal(environment.refreshes, 1); harness.unmount();
});
await test('privacy/deletion/embed-denial errors are truthful and retry creates a fresh iframe', async () => {
  const { harness, environment, player } = await setup();
  player.ready(); player.error(101); harness.flush();
  assert.match(text(harness.output), /does not allow/);
  button(harness, 'Retry YouTube').props.onClick(); harness.flush(); await settle(harness);
  assert.equal(player.destroyed, 1); assert.equal(environment.players.length, 2);
  environment.players[1].ready(); environment.players[1].error(100); harness.flush();
  assert.match(text(harness.output), /private, deleted, or unavailable/);
  assert.match(youtubeHelpers.getYouTubePlaybackError(153), /identify this embedded player/);
  harness.unmount();
});
await test('player-ready timeout is bounded and actionable', async () => {
  const { harness, environment } = await setup();
  environment.advance(15000); harness.flush(); assert.match(text(harness.output), /taking too long/);
  button(harness, 'Retry YouTube'); harness.unmount();
});
await test('StrictMode cleanup, retry, stale events, and aborted reads do not leak', async () => {
  const { harness, environment, player } = await setup();
  player.ready(); harness.flush(); const pending = environment.requests[0];
  harness.strictModeReplay(); await settle(harness);
  assert.equal(player.destroyed, 1); assert.equal(environment.players.length, 2);
  assert(pending.signal.aborted); assert.equal(environment.document.count('visibilitychange'), 1);
  assert.equal(environment.window.count('pageshow'), 1);
  player.error(101); harness.flush(); assert.doesNotMatch(text(harness.output), /does not allow/);
  const next = environment.players[1]; next.ready(); harness.flush(); const finalRequest = environment.requests.at(-1)!;
  harness.unmount(); assert(finalRequest.signal.aborted); finalRequest.resolve({ ...baseSnapshot }); await settle();
  next.error(100); await settle(); assert.equal(harness.writesAfterUnmount, 0);
  assert.equal(next.destroyed, 1); assert.equal(environment.timers.size, 0);
  assert.equal(environment.document.count('visibilitychange'), 0); assert.equal(environment.window.count('pageshow'), 0);
});
await test('unmount before the script resolves cannot create a player', async () => {
  const environment = new Environment(); let resolve!: (value: unknown) => void;
  environment.loader = () => new Promise(complete => { resolve = complete; });
  const { harness } = await setup({}, environment); harness.unmount(); resolve(environment.api); await settle();
  assert.equal(environment.players.length, 0); assert.equal(environment.timers.size, 0); assert.equal(harness.writesAfterUnmount, 0);
});
await test('caption availability is not invented and repeated cues use session-specific keys', () => {
  const playerSource = source('components/YouTubeVideoPlayer.tsx');
  assert.match(playerSource, /Caption availability depends on this video/);
  assert.doesNotMatch(playerSource, /trackList|setOption|loadModule|unloadModule|nextVideo|\/api\/playout/);
  const parent = source('components/VideoPlayer.tsx');
  assert.match(parent, /key=\{`\$\{playbackSessionId \|\| activeSlotId \|\| 'manual'\}:\$\{videoId\}`\}/);
});
await test('countdown out point pauses YouTube and Reconnect cannot restart an expired excerpt', async () => {
  let reconnect: (() => void) | null = null;
  const { harness, environment, player } = await setup({ snapshot: { ...baseSnapshot, playbackPositionSeconds:50, clipEndSeconds:65 }, onReconnectReady: value => { reconnect = value; } });
  player.ready(); player.duration=240; player.emit(1); harness.flush();
  environment.advance(16000); await settle(harness);
  assert.equal(player.state,2);
  const plays=player.plays;
  (reconnect as (() => void) | null)?.(); await settle(harness);
  assert.equal(player.plays,plays); assert.equal(player.state,2);
  assert.equal(player.options.playerVars.fs,0);
  harness.unmount();
});
process.stdout.write(`\n${checks} isolated YouTube player scenarios passed.\n`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
