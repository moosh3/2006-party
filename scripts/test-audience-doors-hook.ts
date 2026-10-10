/** Actual doors-hook lifecycle checks. No database, network, or real browser effects. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';
import * as contracts from '../lib/audience-access';

type Props = { enabled: boolean };
type Output = ReturnType<typeof import('../hooks/useAudienceDoors').useAudienceDoors>;
type Harness = {
  react: unknown; component: (props: Props) => Output; output: Output; writesAfterUnmount: number;
  mount(props: Props): Output; update(props: Partial<Props>): Output; flush(): Output;
  strictModeReplay(): Output; unmount(): void;
};
const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const hookSource = readFileSync(join(project, 'hooks/useAudienceDoors.ts'), 'utf8');
const sharedSource = readFileSync(join(project, 'scripts/test-cast-run-interaction.ts'), 'utf8');
const classStart = sharedSource.indexOf('class HookHarness<');
const classEnd = sharedSource.indexOf('\nfunction evaluateModule(', classStart);
assert(classStart >= 0 && classEnd > classStart, 'Existing hook harness must be available');
const harnessSource = `${sharedSource.slice(classStart, classEnd)}\nexport { HookHarness };`;
const sameDeps = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

class Events {
  private listeners = new Map<string, Set<() => void>>();
  adds = 0;
  removes = 0;
  addEventListener = (type: string, callback: () => void) => {
    const listeners = this.listeners.get(type) || new Set();
    if (!listeners.has(callback)) this.adds++;
    listeners.add(callback);
    this.listeners.set(type, listeners);
  };
  removeEventListener = (type: string, callback: () => void) => {
    if (this.listeners.get(type)?.delete(callback)) this.removes++;
  };
  emit(type: string) { for (const callback of [...(this.listeners.get(type) || [])]) callback(); }
  count() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

type PendingRequest = {
  signal: AbortSignal;
  resolve(payload: unknown, ok?: boolean): void;
  resolveBody(body: Promise<unknown>): void;
  reject(reason?: Error): void;
};
class Environment {
  now = 0;
  private nextTimer = 0;
  intervals = new Map<number, { due: number; delay: number; callback: () => void }>();
  timeouts = new Map<number, { due: number; callback: () => void }>();
  requests: PendingRequest[] = [];
  document = Object.assign(new Events(), { visibilityState: 'visible' });
  window = Object.assign(new Events(), {
    setInterval: (callback: () => void, delay: number) => {
      assert.equal(delay, 3000);
      const id = ++this.nextTimer;
      this.intervals.set(id, { due: this.now + delay, delay, callback });
      return id;
    },
    clearInterval: (id: number) => { this.intervals.delete(id); },
    setTimeout: (callback: () => void, delay: number) => {
      assert.equal(delay, 8000);
      const id = ++this.nextTimer;
      this.timeouts.set(id, { due: this.now + delay, callback });
      return id;
    },
    clearTimeout: (id: number) => { this.timeouts.delete(id); },
  });
  constructor(private abortAware = true) {}
  fetch = (url: string, options: { cache: string; signal: AbortSignal }) => {
    assert.equal(url, '/api/audience/doors');
    assert.equal(options.cache, 'no-store');
    assert(options.signal instanceof AbortSignal);
    return new Promise((resolve, reject) => {
      const abort = () => reject(new Error('Fixture request aborted'));
      if (this.abortAware) options.signal.addEventListener('abort', abort, { once: true });
      const clean = () => options.signal.removeEventListener('abort', abort);
      this.requests.push({
        signal: options.signal,
        resolve: (payload, ok = true) => { clean(); resolve({ ok, json: async () => payload }); },
        resolveBody: body => { clean(); resolve({ ok: true, json: () => body }); },
        reject: (reason = new Error('Fixture network interrupted')) => { clean(); reject(reason); },
      });
    });
  };
  advance(milliseconds: number) {
    const target = this.now + milliseconds;
    let turns = 0;
    for (;;) {
      const interval = [...this.intervals.entries()].sort((a, b) => a[1].due - b[1].due)[0];
      const timeout = [...this.timeouts.entries()].sort((a, b) => a[1].due - b[1].due)[0];
      const nextDue = Math.min(interval?.[1].due ?? Infinity, timeout?.[1].due ?? Infinity);
      if (nextDue > target) break;
      assert(++turns < 1000, 'Unexpected timer loop');
      this.now = nextDue;
      if (timeout && timeout[1].due === nextDue) {
        this.timeouts.delete(timeout[0]); timeout[1].callback();
      } else if (interval) {
        interval[1].due += interval[1].delay; interval[1].callback();
      }
    }
    this.now = target;
  }
  listenerCount() { return this.window.count() + this.document.count(); }
}

function evaluate(code: string, environment: Environment, react?: unknown): Record<string, any> {
  const testModule = { exports: {} as Record<string, any> };
  const context = createContext({
    module: testModule, exports: testModule.exports, assert, sameDeps, AbortController,
    window: environment.window, document: environment.document, fetch: environment.fetch,
    require: (name: string) => {
      if (name === 'react') return react;
      if (name === '@/lib/audience-access') return contracts;
      throw new Error(`Unexpected runtime import ${name}; providers and network are forbidden`);
    },
  });
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  new Script(compiled.outputText).runInContext(context);
  return testModule.exports;
}
function setup(enabled = true, environment = new Environment()) {
  const Constructor = evaluate(harnessSource, environment).HookHarness as { new(): Harness };
  const hook = new Constructor();
  const actualHook = evaluate(hookSource, environment, hook.react).useAudienceDoors as (enabled: boolean) => Output;
  hook.component = props => actualHook(props.enabled);
  hook.mount({ enabled });
  return { environment, hook };
}
async function settle(hook: Harness) {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  hook.flush();
}
const doors = (doorsOpen: boolean, revision: number) => ({ doorsOpen, revision, changedAt: '2026-10-09T20:00:00.000Z' });
let checks = 0;
async function test(name: string, check: () => Promise<void>) { await check(); checks++; console.log(`PASS ${name}`); }

async function main() {
  await test('disabled entry has no admission, request, interval, or listener', async () => {
    const { environment, hook } = setup(false);
    assert.equal(hook.output.doors, null);
    assert.equal(hook.output.error, null);
    await hook.output.refresh();
    hook.strictModeReplay();
    assert.equal(environment.requests.length + environment.intervals.size + environment.timeouts.size + environment.listenerCount(), 0);
    hook.unmount();
  });
  await test('the first unanswered or failed check remains closed', async () => {
    for (const failure of ['http', 'network', 'malformed'] as const) {
      const { environment, hook } = setup();
      assert.equal(hook.output.doors, null);
      assert.equal(hook.output.error, null);
      assert.equal(environment.intervals.size, 1);
      assert.equal(environment.listenerCount(), 3);
      if (failure === 'network') environment.requests[0].reject();
      else environment.requests[0].resolve(failure === 'malformed' ? { doorsOpen: true } : {}, failure !== 'http');
      await settle(hook);
      assert.equal(hook.output.doors, null);
      assert.match(hook.output.error || '', /Connection interrupted/);
      assert.equal(environment.timeouts.size, 0);
      hook.unmount();
    }
  });
  await test('valid host open, close, and reopen snapshots take effect', async () => {
    const { environment, hook } = setup();
    for (const [index, snapshot] of [doors(false, 0), doors(true, 1), doors(false, 2), doors(true, 3)].entries()) {
      if (index) void hook.output.refresh();
      environment.requests[index].resolve(snapshot);
      await settle(hook);
      assert.deepEqual(hook.output.doors, snapshot);
      assert.equal(hook.output.error, null);
    }
    hook.unmount();
  });
  await test('stale or duplicate responses cannot reverse the latest host state', async () => {
    const { environment, hook } = setup();
    environment.requests[0].resolve(doors(true, 4));
    await settle(hook);
    const confirmed = hook.output.doors;
    for (const snapshot of [doors(false, 3), doors(false, 4)]) {
      void hook.output.refresh();
      environment.requests.at(-1)!.resolve(snapshot);
      await settle(hook);
      assert.equal(hook.output.doors, confirmed);
      assert.equal(hook.output.error, null);
    }
    hook.unmount();
  });
  await test('a transient outage retains confirmed admission and recovery clears its error', async () => {
    const { environment, hook } = setup();
    environment.requests[0].resolve(doors(true, 1)); await settle(hook);
    const confirmed = hook.output.doors;
    void hook.output.refresh(); environment.requests[1].reject(); await settle(hook);
    assert.equal(hook.output.doors, confirmed);
    assert.match(hook.output.error || '', /Connection interrupted/);
    void hook.output.refresh(); environment.requests[2].resolve(doors(false, 2)); await settle(hook);
    assert.equal(hook.output.doors?.doorsOpen, false);
    assert.equal(hook.output.error, null);
    hook.unmount();
  });
  await test('concurrent refreshes and polling do not duplicate a pending request', async () => {
    const { environment, hook } = setup();
    void hook.output.refresh(); void hook.output.refresh();
    environment.window.emit('online'); environment.window.emit('pageshow');
    environment.document.emit('visibilitychange'); environment.advance(6000);
    assert.equal(environment.requests.length, 1);
    assert.equal(environment.timeouts.size, 1);
    environment.requests[0].resolve(doors(false, 0)); await settle(hook);
    void hook.output.refresh();
    assert.equal(environment.requests.length, 2);
    hook.unmount(); await settle(hook);
    assert.equal(environment.timeouts.size, 0);
  });
  await test('disabling resets admission and errors, re-enabling requires a fresh response', async () => {
    const { environment, hook } = setup();
    environment.requests[0].resolve(doors(true, 7)); await settle(hook);
    void hook.output.refresh(); environment.requests[1].reject(); await settle(hook);
    assert(hook.output.error);
    hook.update({ enabled: false });
    assert.equal(hook.output.doors, null); assert.equal(hook.output.error, null);
    assert.equal(environment.intervals.size + environment.listenerCount(), 0);
    await hook.output.refresh(); assert.equal(environment.requests.length, 2);
    hook.update({ enabled: true });
    assert.equal(hook.output.doors, null);
    assert.equal(environment.requests.length, 3);
    environment.requests[2].resolve(doors(false, 0)); await settle(hook);
    assert.deepEqual(hook.output.doors, doors(false, 0));
    hook.unmount();
  });
  await test('previously queued enabled callbacks cannot repopulate disabled admission', async () => {
    const { environment, hook } = setup();
    environment.requests[0].resolve(doors(true, 1)); await settle(hook);
    const lateRefresh = hook.output.refresh;
    const lateTick = [...environment.intervals.values()][0].callback;
    hook.update({ enabled: false });
    await lateRefresh(); lateTick(); await settle(hook);
    assert.equal(environment.requests.length, 1, 'A stale enabled callback must not fetch after disabling');
    assert.equal(hook.output.doors, null);
    hook.unmount();
  });
  await test('an aborted old response or rejection cannot replace the new identity check', async () => {
    for (const rejectOld of [false, true]) {
      const { environment, hook } = setup(true, new Environment(false));
      const oldRequest = environment.requests[0];
      hook.update({ enabled: false }); hook.update({ enabled: true });
      assert.equal(oldRequest.signal.aborted, true);
      assert.equal(environment.requests.length, 2);
      if (rejectOld) oldRequest.reject(); else oldRequest.resolve(doors(true, 99));
      await settle(hook);
      assert.equal(hook.output.doors, null); assert.equal(hook.output.error, null);
      void hook.output.refresh(); assert.equal(environment.requests.length, 2, 'Old cleanup must not unlock a current pending request');
      environment.requests[1].resolve(doors(false, 1)); await settle(hook);
      assert.deepEqual(hook.output.doors, doors(false, 1));
      hook.unmount();
    }
  });
  await test('eight-second aborts fail closed and the next poll can recover', async () => {
    const { environment, hook } = setup();
    environment.advance(8000); await settle(hook);
    assert.equal(environment.requests[0].signal.aborted, true);
    assert.equal(hook.output.doors, null);
    assert.match(hook.output.error || '', /Connection interrupted/);
    assert.equal(environment.timeouts.size, 0);
    environment.advance(1000);
    assert.equal(environment.requests.length, 2);
    environment.requests[1].resolve(doors(true, 1)); await settle(hook);
    assert.equal(hook.flush().doors?.doorsOpen, true); assert.equal(hook.output.error, null);
    hook.unmount();
  });
  await test('aborting while the response body is pending cannot admit its late open state', async () => {
    const { environment, hook } = setup();
    let resolveBody!: (value: unknown) => void;
    environment.requests[0].resolveBody(new Promise(resolve => { resolveBody = resolve; }));
    await settle(hook);
    environment.advance(8000);
    assert.equal(environment.requests[0].signal.aborted, true);
    resolveBody(doors(true, 1)); await settle(hook);
    assert.equal(hook.output.doors, null);
    assert.equal(environment.timeouts.size, 0);
    hook.unmount();
  });
  await test('visible resume, online, and page restore each refresh without duplicate observers', async () => {
    const { environment, hook } = setup();
    environment.requests[0].resolve(doors(false, 0)); await settle(hook);
    environment.document.visibilityState = 'hidden';
    environment.document.emit('visibilitychange'); environment.window.emit('pageshow'); environment.window.emit('online');
    assert.equal(environment.requests.length, 1);
    environment.document.visibilityState = 'visible';
    for (const event of ['visibilitychange', 'pageshow', 'online']) {
      if (event === 'visibilitychange') environment.document.emit(event); else environment.window.emit(event);
      environment.requests.at(-1)!.resolve(doors(false, 0)); await settle(hook);
    }
    assert.equal(environment.requests.length, 4);
    assert.equal(environment.intervals.size, 1); assert.equal(environment.listenerCount(), 3);
    hook.unmount();
  });
  await test('same-enabled renders preserve the observer, interval, and refresh identity', async () => {
    const { environment, hook } = setup();
    environment.requests[0].resolve(doors(false, 0)); await settle(hook);
    const timer = [...environment.intervals.keys()][0];
    const refresh = hook.output.refresh;
    const adds = environment.document.adds + environment.window.adds;
    for (let render = 0; render < 3; render++) hook.update({ enabled: true });
    assert.equal(hook.output.refresh, refresh);
    assert.equal([...environment.intervals.keys()][0], timer);
    assert.equal(environment.requests.length, 1);
    assert.equal(environment.document.adds + environment.window.adds, adds);
    hook.unmount();
  });
  await test('StrictMode cleanup leaves one live request, interval, and listener set', async () => {
    const { environment, hook } = setup();
    hook.strictModeReplay(); await settle(hook);
    assert.equal(environment.requests.length, 2);
    assert.equal(environment.requests[0].signal.aborted, true);
    assert.equal(environment.requests[1].signal.aborted, false);
    assert.equal(environment.timeouts.size, 1);
    assert.equal(environment.intervals.size, 1); assert.equal(environment.listenerCount(), 3);
    environment.requests[1].resolve(doors(true, 1)); await settle(hook);
    assert.deepEqual(hook.output.doors, doors(true, 1));
    hook.unmount(); await settle(hook);
    assert.equal(environment.timeouts.size + environment.intervals.size + environment.listenerCount(), 0);
    assert.equal(environment.window.adds, environment.window.removes);
    assert.equal(environment.document.adds, environment.document.removes);
    assert.equal(hook.writesAfterUnmount, 0);
  });
  await test('StrictMode ignores a deliberately late first-effect admission', async () => {
    const { environment, hook } = setup(true, new Environment(false));
    hook.strictModeReplay();
    environment.requests[1].resolve(doors(false, 2)); await settle(hook);
    environment.requests[0].resolve(doors(true, 99)); await settle(hook);
    assert.deepEqual(hook.output.doors, doors(false, 2));
    assert.equal(hook.output.error, null); assert.equal(environment.timeouts.size, 0);
    hook.unmount();
  });
  await test('unmount removes browser effects and ignores late replies and captured callbacks', async () => {
    for (const rejectLate of [false, true]) {
      const { environment, hook } = setup(true, new Environment(false));
      const refresh = hook.output.refresh;
      const lateTick = [...environment.intervals.values()][0].callback;
      hook.unmount();
      assert.equal(environment.requests[0].signal.aborted, true);
      if (rejectLate) environment.requests[0].reject(); else environment.requests[0].resolve(doors(true, 99));
      await settle(hook); await refresh(); lateTick(); environment.advance(10000); await settle(hook);
      assert.equal(environment.requests.length, 1);
      assert.equal(hook.writesAfterUnmount, 0);
      assert.equal(environment.timeouts.size + environment.intervals.size + environment.listenerCount(), 0);
    }
  });
  console.log(`Audience doors hook: ${checks} isolated lifecycle checks passed; actual hook source executed, no database/network.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
