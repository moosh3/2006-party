/** Actual admin component and realtime-hook regressions, without network or DB. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';
import { RealtimeClient } from '@supabase/realtime-js';
import ts from 'typescript';
import * as constants from '../lib/constants';
import type { RealtimeHealthStatus } from '../hooks/useRealtimeHealth';

type Node = { type: unknown; props: Record<string, any> };
type Harness<P, O> = {
  react: Record<string, any>; component: (props: P) => O; output: O; writesAfterUnmount: number;
  mount(props: P): O; update(props: Partial<P>): O; flush(): O; strictModeReplay(): O; unmount(): void;
};
type Options = Parameters<typeof import('../hooks/useRealtimeHealth').useRealtimeHealth>[0];
const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path: string) => readFileSync(join(project, path), 'utf8');
const shared = source('scripts/test-cast-run-interaction.ts');
const start = shared.indexOf('class HookHarness<');
const end = shared.indexOf('\nfunction evaluateModule(', start);
assert(start >= 0 && end > start);
const harnessSource = `${shared.slice(start, end)}\nexport { HookHarness };`;
const sameDeps = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
let monitorIds = 0;

class Channel {
  state = 'closed';
  subscriptions: ((status: string) => void)[] = [];
  presence: (() => void)[] = [];
  changes: (() => void)[] = [];
  tracks = 0;
  constructor(public topic: string) {}
  on(kind: string, _filter: unknown, callback: () => void) {
    (kind === 'presence' ? this.presence : this.changes).push(callback);
    return this;
  }
  subscribe(callback?: (status: string) => void) {
    // This deliberately models Supabase's real topic reuse: a joining/joined
    // channel does not install a second subscribe callback.
    if (this.state === 'closed') {
      if (callback) this.subscriptions.push(callback);
      this.state = 'joining';
    }
    return this;
  }
  status(value: string) {
    this.state = value === 'SUBSCRIBED' ? 'joined' : value === 'CLOSED' ? 'closed' : 'errored';
    for (const callback of this.subscriptions) callback(value);
  }
  sync() { for (const callback of this.presence) callback(); }
  track() { this.tracks++; }
}
type Request = {
  url: string; options: Record<string, any>;
  resolve(value: unknown, ok?: boolean): void; reject(): void;
};
class Environment {
  now = 0;
  nextTimer = 0;
  timers = new Map<number, { due: number; delay?: number; callback: () => void }>();
  channels = new Map<string, Channel>();
  created: Channel[] = [];
  removed: Channel[] = [];
  requests: Request[] = [];
  health: RealtimeHealthStatus = 'healthy';
  setTimeout = (callback: () => void, delay: number) => {
    const id = ++this.nextTimer;
    this.timers.set(id, { due: this.now + delay, callback }); return id;
  };
  clearTimeout = (id: number) => { this.timers.delete(id); };
  setInterval = (callback: () => void, delay: number) => {
    const id = ++this.nextTimer;
    this.timers.set(id, { due: this.now + delay, delay, callback }); return id;
  };
  clearInterval = this.clearTimeout;
  window = { setTimeout: this.setTimeout, clearTimeout: this.clearTimeout, setInterval: this.setInterval, clearInterval: this.clearInterval };
  supabase = {
    channel: (topic: string) => {
      const reused = this.channels.get(topic);
      if (reused) return reused;
      const channel = new Channel(topic);
      this.channels.set(topic, channel); this.created.push(channel); return channel;
    },
    removeChannel: (channel: Channel) => {
      this.removed.push(channel);
      channel.status('CLOSED');
      // Keep the retired channel registered until asynchronous unsubscribe is
      // complete, as happens during StrictMode replay and reconnects.
      return Promise.resolve().then(() => {
        if (this.channels.get(channel.topic) === channel) this.channels.delete(channel.topic);
      });
    },
  };
  fetch = (url: string, options: Record<string, any> = {}) => {
    if (url === '/api/admin/hold-screen' && !options.method) {
      return Promise.resolve({ ok: true, json: async () => ({ hold_screen_enabled: false, mux_item: null }) });
    }
    assert.equal(url, '/api/admin/playback-control', 'Only isolated playback requests are allowed');
    return new Promise((resolve, reject) => {
      this.requests.push({ url, options,
        resolve: (value, ok = true) => resolve({ ok, status: ok ? 200 : 503, json: async () => value }),
        reject: () => reject(new Error('Isolated network failure')),
      });
    });
  };
  advance(milliseconds: number) {
    const target = this.now + milliseconds;
    let turns = 0;
    for (;;) {
      const next = [...this.timers].sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next || next[1].due > target) break;
      assert(++turns < 1000);
      this.now = next[1].due;
      if (next[1].delay) next[1].due += next[1].delay;
      else this.timers.delete(next[0]);
      next[1].callback();
    }
    this.now = target;
  }
}
function evaluate(code: string, environment: Environment, react?: Record<string, any>, actualHealth = false) {
  const testModule = { exports: {} as Record<string, any> };
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props });
  class FixtureDate extends Date {
    constructor(value?: string | number) { super(value ?? environment.now); }
    static now() { return environment.now; }
  }
  const context = createContext({
    module: testModule, exports: testModule.exports, assert, sameDeps, AbortController, Date: FixtureDate,
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    window: environment.window, setTimeout: environment.setTimeout, clearTimeout: environment.clearTimeout,
    setInterval: environment.setInterval, clearInterval: environment.clearInterval,
    fetch: environment.fetch, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000002' },
    console: { log() {}, warn() {}, error() {} },
    require: (name: string) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === '@/lib/constants') return constants;
      if (name === '@/lib/supabase') return { supabase: environment.supabase };
      if (name === '@/hooks/useRealtimeHealth' && !actualHealth) return { useRealtimeHealth: () => environment.health };
      throw new Error(`Unexpected import ${name}; live providers are forbidden`);
    },
  });
  const compiled = ts.transpileModule(code, { fileName: 'fixture.tsx', compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } });
  new Script(compiled.outputText).runInContext(context);
  return testModule.exports;
}
function createHarness<P, O>(environment: Environment): Harness<P, O> {
  const Constructor = evaluate(harnessSource, environment).HookHarness as { new(): Harness<P, O> };
  return new Constructor();
}
function monitor(environment = new Environment(), options: Options = {}) {
  const hook = createHarness<NonNullable<Options>, RealtimeHealthStatus>(environment);
  const react = { ...hook.react, useId: () => hook.react.useRef(`:fixture-${++monitorIds}:`).current };
  hook.component = evaluate(source('hooks/useRealtimeHealth.ts'), environment, react, true).useRealtimeHealth;
  hook.mount(options);
  return hook;
}
function control(environment = new Environment()) {
  const hook = createHarness<Record<string, never>, Node>(environment);
  hook.component = evaluate(source('components/admin/PlaybackControls.tsx'), environment, hook.react).default;
  hook.mount({});
  return { hook, environment };
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
function status(hook: Harness<Record<string, never>, Node>) {
  const found = nodes(hook.output).filter(node => node.props.role === 'status');
  assert.equal(found.length, 1, 'A single stable status slot must always be present');
  assert.match(found[0].props.className, /min-h-\[88px\]/);
  return text(found[0]);
}
function button(hook: Harness<Record<string, never>, Node>, name: string) {
  const found = nodes(hook.output).find(node => node.type === 'button' && text(node) === name);
  assert(found, `${name} control must remain mounted`); return found;
}
async function settle(hook: Harness<any, any>) {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
  hook.flush();
}
const cue = {
  playback_state: 'playing', playout_mode: 'manual', playback_session_id: '00000000-0000-4000-8000-000000000001',
  title: 'Isolated clip', schedule_status: null, active_slot_id: null, next_transition_at: null,
};
let checks = 0;
async function test(name: string, run: () => void | Promise<void>) {
  await run(); checks++; console.log(`PASS ${name}`);
}

async function main() {
  await test('installed Supabase reuses identical channel topics without any connection', () => {
    const client = new RealtimeClient('ws://127.0.0.1:1/socket', { params: { apikey: 'isolated-no-connect-fixture' } });
    assert.equal(client.channel('health-check'), client.channel('health-check'));
    assert.equal(client.connectionState(), 'closed');
  });
  await test('two actual health monitors own distinct channels and cleanup is independent', async () => {
    const environment = new Environment();
    const preview = monitor(environment); const sidebar = monitor(environment);
    assert.equal(environment.created.length, 2);
    assert.notEqual(environment.created[0].topic, environment.created[1].topic);
    for (const channel of environment.created) channel.status('SUBSCRIBED');
    preview.flush(); sidebar.flush();
    assert.equal(preview.output, 'healthy'); assert.equal(sidebar.output, 'healthy');
    preview.unmount(); await settle(sidebar);
    assert.equal(environment.removed.length, 1);
    assert.equal(environment.created[1].state, 'joined');
    assert.equal(sidebar.output, 'healthy');
    assert.equal(environment.timers.size, 2);
    sidebar.unmount(); assert.equal(environment.timers.size, 0);
  });
  await test('a reconnect retires the old channel before CLOSED and uses a fresh generation', async () => {
    const environment = new Environment(); const hook = monitor(environment);
    const old = environment.created[0]; old.status('SUBSCRIBED'); hook.flush();
    old.status('CHANNEL_ERROR'); hook.flush(); assert.equal(hook.output, 'degraded');
    environment.advance(1000); hook.flush();
    assert.equal(environment.created.length, 2);
    assert.notEqual(old.topic, environment.created[1].topic);
    assert.equal(environment.timers.size, 2, 'Deliberate unsubscribe must not schedule another reconnect');
    environment.created[1].status('SUBSCRIBED'); hook.flush(); assert.equal(hook.output, 'healthy');
    old.status('CHANNEL_ERROR'); old.sync(); hook.flush();
    assert.equal(hook.output, 'healthy', 'Retired callbacks cannot change current health');
    environment.advance(1500); hook.flush(); assert.equal(environment.created.length, 2);
    hook.unmount(); await settle(hook); assert.equal(hook.writesAfterUnmount, 0);
  });
  await test('callback identity changes do not churn subscriptions and the newest callback is used', () => {
    const environment = new Environment(); const calls: string[] = [];
    const hook = monitor(environment, { onStatusChange: value => calls.push(`old:${value}`) });
    environment.created[0].status('SUBSCRIBED'); hook.flush();
    hook.update({ onStatusChange: value => calls.push(`new:${value}`) });
    assert.equal(environment.created.length, 1); assert.equal(environment.removed.length, 0);
    environment.created[0].status('CHANNEL_ERROR'); hook.flush();
    assert.deepEqual(calls, ['new:degraded']); hook.unmount();
  });
  await test('a recovered current channel cancels its queued reconnect instead of churning again', () => {
    for (const recovery of ['subscription', 'presence']) {
      const environment = new Environment(); const hook = monitor(environment);
      const channel = environment.created[0]; channel.status('SUBSCRIBED'); hook.flush();
      channel.status('CHANNEL_ERROR'); hook.flush(); assert.equal(environment.timers.size, 3);
      if (recovery === 'subscription') channel.status('SUBSCRIBED');
      else channel.sync();
      hook.flush(); assert.equal(hook.output, 'healthy'); assert.equal(environment.timers.size, 2);
      environment.advance(1500); hook.flush(); assert.equal(environment.created.length, 1);
      hook.unmount();
    }
  });
  await test('StrictMode replay cannot reuse a pending unsubscribe or leak timers', async () => {
    const environment = new Environment(); const hook = monitor(environment);
    const old = environment.created[0]; hook.strictModeReplay();
    assert.equal(environment.created.length, 2); assert.notEqual(old.topic, environment.created[1].topic);
    assert.equal(environment.timers.size, 2);
    old.status('SUBSCRIBED'); old.sync(); hook.flush();
    environment.created[1].status('SUBSCRIBED'); hook.flush();
    hook.unmount(); await settle(hook);
    assert.equal(environment.timers.size, 0); assert.equal(hook.writesAfterUnmount, 0);
  });
  await test('disabled monitors stop all activity and re-enable on their own new channel', () => {
    const environment = new Environment(); const hook = monitor(environment, { enabled: false });
    assert.equal(environment.created.length + environment.timers.size, 0);
    hook.update({ enabled: true }); assert.equal(environment.created.length, 1);
    const old = environment.created[0]; old.status('SUBSCRIBED'); hook.flush();
    hook.update({ enabled: false }); assert.equal(environment.timers.size, 0);
    old.status('CHANNEL_ERROR'); old.sync(); hook.flush();
    assert.equal(environment.timers.size, 0);
    hook.update({ enabled: true }); assert.equal(environment.created.length, 2); hook.unmount();
  });
  await test('sustained heartbeat loss still becomes offline and a current presence sync recovers', () => {
    const environment = new Environment(); const hook = monitor(environment);
    const channel = environment.created[0]; channel.status('SUBSCRIBED'); hook.flush();
    environment.advance(50000); hook.flush(); assert.equal(hook.output, 'offline');
    channel.sync(); hook.flush(); assert.equal(hook.output, 'healthy'); hook.unmount();
  });
  await test('momentary websocket failures never show a sidebar warning or replace controls', async () => {
    const { environment, hook } = control();
    assert.match(status(hook), /Checking current cue/);
    environment.requests[0].resolve(cue); await settle(hook);
    const rootType = hook.output.type; const buttonCount = nodes(hook.output).filter(node => node.type === 'button').length;
    environment.health = 'degraded'; hook.update({}); environment.advance(4999); hook.flush();
    assert.match(status(hook), /Playback status current/);
    environment.health = 'healthy'; hook.update({}); environment.advance(6000); hook.flush();
    assert.match(status(hook), /Playback status current/);
    assert.equal(hook.output.type, rootType);
    assert.equal(nodes(hook.output).filter(node => node.type === 'button').length, buttonCount);
    assert(!nodes(hook.output).some(node => String(node.props.className || '').includes('animate-pulse')));
    hook.unmount();
  });
  await test('a sustained degraded warning stays in one slot and requires stable recovery', async () => {
    const { environment, hook } = control(); environment.requests[0].resolve(cue); await settle(hook);
    environment.health = 'degraded'; hook.update({}); environment.advance(5000); hook.flush();
    assert.match(status(hook), /Live updates reconnecting/);
    environment.health = 'healthy'; hook.update({}); environment.advance(2999); hook.flush();
    assert.match(status(hook), /Live updates reconnecting/);
    environment.health = 'degraded'; hook.update({}); environment.advance(3000); hook.flush();
    assert.match(status(hook), /Live updates reconnecting/);
    environment.health = 'healthy'; hook.update({}); environment.advance(3000); hook.flush();
    assert.match(status(hook), /Playback status current/); hook.unmount();
  });
  await test('confirmed offline warns immediately and a dismissed alert stays dismissed through a flap', async () => {
    const { environment, hook } = control(); environment.requests[0].resolve(cue); await settle(hook);
    environment.health = 'offline'; hook.update({}); assert.match(status(hook), /Live updates unavailable/);
    button(hook, 'Dismiss').props.onClick(); hook.flush(); assert.match(status(hook), /Playback status current/);
    environment.health = 'healthy'; hook.update({}); environment.advance(1000); hook.flush();
    environment.health = 'offline'; hook.update({}); assert.match(status(hook), /Playback status current/);
    environment.health = 'healthy'; hook.update({}); environment.advance(3000); hook.flush();
    environment.health = 'offline'; hook.update({}); assert.match(status(hook), /Live updates unavailable/); hook.unmount();
  });
  await test('background polling keeps mounted controls, but failed reads lock commands immediately', async () => {
    const { environment, hook } = control();
    assert.equal(button(hook, 'Pause').props.disabled, true);
    environment.requests[0].resolve(cue); await settle(hook);
    assert.equal(button(hook, 'Pause').props.disabled, false);
    environment.advance(3000); hook.flush(); assert.equal(environment.requests.length, 2);
    assert.match(status(hook), /Playback status current/); assert.equal(button(hook, 'Pause').props.disabled, false);
    environment.health = 'degraded'; hook.update({});
    environment.requests[1].reject(); await settle(hook);
    assert.match(status(hook), /Current cue unavailable/);
    assert.equal(button(hook, 'Pause').props.disabled, true); assert.equal(button(hook, 'Restart').props.disabled, true);
    environment.advance(3000); environment.requests[2].resolve(cue); await settle(hook);
    assert.match(status(hook), /Playback status current/); assert.equal(button(hook, 'Pause').props.disabled, false);
    hook.unmount();
  });
  await test('malformed or missing cue identities remain fail closed', async () => {
    for (const payload of [{ ...cue, playback_session_id: null }, { ...cue, playback_state: 'unknown' }]) {
      const { environment, hook } = control(); environment.requests[0].resolve(payload); await settle(hook);
      assert.match(status(hook), /Current cue unavailable/); assert.equal(button(hook, 'Pause').props.disabled, true);
      hook.unmount();
    }
  });
  await test('playback commands still carry their command ID and expected current cue UUID', async () => {
    const { environment, hook } = control(); environment.requests[0].resolve(cue); await settle(hook);
    const pending = button(hook, 'Pause').props.onClick(); hook.flush();
    const request = environment.requests[1]; assert.equal(request.options.method, 'POST');
    assert.deepEqual(JSON.parse(request.options.body), {
      action: 'pause', commandId: '00000000-0000-4000-8000-000000000002', expectedSessionId: cue.playback_session_id,
    });
    assert.equal(button(hook, 'Pause').props.disabled, true);
    request.resolve({ playback_state: 'paused' }); await settle(hook);
    environment.requests[2].resolve({ ...cue, playback_state: 'paused' }); await pending; await settle(hook);
    assert.equal(button(hook, 'Play').props.disabled, false); hook.unmount();
  });
  await test('unmount clears sustained-status timers and ignores a late state read', async () => {
    const { environment, hook } = control(); await settle(hook);
    environment.health = 'degraded'; hook.update({}); hook.unmount();
    environment.requests[0].resolve(cue); await settle(hook); environment.advance(20000); hook.flush();
    assert.equal(environment.timers.size, 0); assert.equal(hook.writesAfterUnmount, 0);
  });
  console.log(`Admin playback stability passed: ${checks} isolated regressions.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
