/**
 * AIM delivery regressions against the actual message hook source. The same
 * deterministic hook harness used by the cast and audience-door tests supplies
 * React lifecycle semantics; HTTP, websocket events, and time are isolated.
 * No production credentials, database, browser, or network are used.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';
import * as constants from '../lib/constants';
import * as reactions from '../lib/reactions';

type Props = { room: string; userId: string };
type Output = ReturnType<typeof import('../hooks/useChatMessages').useChatMessages>;
type Message = Output['messages'][number];
type Harness = {
  react: Record<string, any>; component: (props: Props) => Output; output: Output; writesAfterUnmount: number;
  mount(props: Props): Output; update(props: Partial<Props>): Output; flush(): Output;
  strictModeReplay(): Output; unmount(): void;
};
type Row = Record<string, unknown>;
type Timer = { due: number; delay?: number; callback: () => void };
const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path: string) => readFileSync(join(project, path), 'utf8');
const hookSource = source('hooks/useChatMessages.ts');
const sharedSource = source('scripts/test-cast-run-interaction.ts');
const classStart = sharedSource.indexOf('class HookHarness<');
const classEnd = sharedSource.indexOf('\nfunction evaluateModule(', classStart);
assert(classStart >= 0 && classEnd > classStart, 'The shared deterministic React hook harness must be available');
const harnessSource = `${sharedSource.slice(classStart, classEnd)}\nexport { HookHarness };`;
const sameDeps = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

class Events {
  private listeners = new Map<string, Set<() => void>>();
  adds = 0;
  removes = 0;
  addEventListener = (type: string, callback: () => void) => {
    const callbacks = this.listeners.get(type) || new Set();
    if (!callbacks.has(callback)) this.adds++;
    callbacks.add(callback);
    this.listeners.set(type, callbacks);
  };
  removeEventListener = (type: string, callback: () => void) => {
    if (this.listeners.get(type)?.delete(callback)) this.removes++;
  };
  emit(type: string) { for (const callback of [...(this.listeners.get(type) || [])]) callback(); }
  count(type?: string) {
    return type ? this.listeners.get(type)?.size || 0 : [...this.listeners.values()].reduce((total, callbacks) => total + callbacks.size, 0);
  }
}

class Channel {
  removed = false;
  state = 'joining';
  handlers: { type: string; filter: Record<string, unknown>; callback: (payload: any) => void }[] = [];
  callback?: (status: string) => void;
  constructor(public name: string) {}
  on = (type: string, filter: Record<string, unknown>, callback: (payload: any) => void) => {
    this.handlers.push({ type, filter, callback });
    return this;
  };
  subscribe = (callback: (status: string) => void) => { this.callback = callback; return this; };
  status(status: string) {
    this.state = status === 'SUBSCRIBED' ? 'joined' : 'closed';
    this.callback?.(status);
  }
  emit(eventType: 'INSERT' | 'UPDATE' | 'DELETE', next: Row = {}, previous: Row = {}, table = 'messages') {
    for (const handler of this.handlers) {
      if (handler.type !== 'postgres_changes' || handler.filter.table !== table) continue;
      if (handler.filter.event !== '*' && handler.filter.event !== eventType) continue;
      handler.callback({ eventType, new: next, old: previous });
    }
  }
}

type PendingRequest = {
  url: URL;
  signal: AbortSignal;
  settled: boolean;
  resolve(payload: unknown, ok?: boolean): void;
  resolveBody(body: Promise<unknown>): void;
  reject(reason?: Error): void;
};
class Environment {
  now = 0;
  hookId = 0;
  private nextTimer = 0;
  timers = new Map<number, Timer>();
  requests: PendingRequest[] = [];
  channels: Channel[] = [];
  navigator = { onLine: true };
  document = Object.assign(new Events(), { visibilityState: 'visible', hidden: false });
  setTimeout = (callback: () => void, delay: number) => {
    const id = ++this.nextTimer;
    this.timers.set(id, { due: this.now + delay, callback });
    return id;
  };
  clearTimeout = (id: number) => { this.timers.delete(id); };
  setInterval = (callback: () => void, delay: number) => {
    assert(delay > 0, 'Polling must have a positive delay');
    const id = ++this.nextTimer;
    this.timers.set(id, { due: this.now + delay, delay, callback });
    return id;
  };
  clearInterval = this.clearTimeout;
  window = Object.assign(new Events(), {
    setTimeout: this.setTimeout, clearTimeout: this.clearTimeout,
    setInterval: this.setInterval, clearInterval: this.clearInterval,
  });
  supabase = {
    channel: (name: string) => { const channel = new Channel(name); this.channels.push(channel); return channel; },
    removeChannel: (channel: Channel) => {
      channel.removed = true;
      // Supabase can synchronously report CLOSED during intentional cleanup.
      channel.status('CLOSED');
      return Promise.resolve('ok');
    },
  };
  constructor(private abortAware = true) {}
  fetch = (url: string, options: { cache: string; signal: AbortSignal }) => {
    const parsed = new URL(url, 'https://local-chat.test');
    assert.equal(parsed.pathname, '/api/chat/messages');
    assert.equal(options.cache, 'no-store');
    assert(options.signal instanceof AbortSignal, 'Every request must be abortable');
    assert.equal(parsed.searchParams.get('limit'), '100', 'History must remain bounded');
    return new Promise((resolve, reject) => {
      let request!: PendingRequest;
      const clean = () => options.signal.removeEventListener('abort', abort);
      const abort = () => { request.settled = true; clean(); reject(new Error('Fixture request aborted')); };
      request = {
        url: parsed, signal: options.signal, settled: false,
        resolve: (payload, ok = true) => {
          request.settled = true; clean();
          resolve({ ok, status: ok ? 200 : 503, json: async () => payload });
        },
        resolveBody: body => {
          request.settled = true; clean();
          resolve({ ok: true, status: 200, json: () => body });
        },
        reject: (reason = new Error('Fixture network interrupted')) => { request.settled = true; clean(); reject(reason); },
      };
      this.requests.push(request);
      if (this.abortAware) options.signal.addEventListener('abort', abort, { once: true });
    });
  };
  advance(milliseconds: number) {
    const target = this.now + milliseconds;
    let turns = 0;
    for (;;) {
      const next = [...this.timers.entries()].sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next || next[1].due > target) break;
      assert(++turns < 1000, 'Unexpected timer loop');
      this.now = next[1].due;
      if (next[1].delay) next[1].due += next[1].delay;
      else this.timers.delete(next[0]);
      next[1].callback();
    }
    this.now = target;
  }
  listenerCount() { return this.document.count() + this.window.count(); }
  activeChannels() { return this.channels.filter(channel => !channel.removed); }
  activeRequests() { return this.requests.filter(request => !request.settled && !request.signal.aborted); }
}

function evaluate(code: string, filename: string, environment: Environment, react?: unknown): Record<string, any> {
  const testModule = { exports: {} as Record<string, any> };
  const imports: Record<string, unknown> = {
    react, '@/lib/supabase': { supabase: environment.supabase },
    '@/lib/constants': constants, '@/lib/reactions': reactions,
  };
  const ClockDate = class extends Date { static now() { return environment.now; } };
  const context = createContext({
    module: testModule, exports: testModule.exports, assert, sameDeps, AbortController, URL, URLSearchParams,
    window: environment.window, document: environment.document, navigator: environment.navigator,
    fetch: environment.fetch, Date: ClockDate, console,
    setTimeout: environment.setTimeout, clearTimeout: environment.clearTimeout,
    setInterval: environment.setInterval, clearInterval: environment.clearInterval,
    require: (name: string) => {
      if (Object.prototype.hasOwnProperty.call(imports, name)) return imports[name];
      // Evaluate only project-owned pure chat contracts, never provider code.
      if (name === '@/lib/chat-message-state') return evaluate(source('lib/chat-message-state.ts'), 'lib/chat-message-state.ts', environment, react);
      throw new Error(`Unexpected runtime import ${name}; production providers and network are forbidden`);
    },
  });
  const compiled = ts.transpileModule(code, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length || 0, 0);
  new Script(compiled.outputText, { filename }).runInContext(context);
  return testModule.exports;
}

function setup(props: Partial<Props> = {}, environment = new Environment()) {
  const Constructor = evaluate(harnessSource, 'shared-hook-harness.ts', environment).HookHarness as { new(): Harness };
  const hook = new Constructor();
  hook.react.useId = () => hook.react.useRef(`:chat-test-${++environment.hookId}:`).current;
  const actualHook = evaluate(hookSource, 'hooks/useChatMessages.ts', environment, hook.react).useChatMessages as (room: string, userId: string) => Output;
  hook.component = next => actualHook(next.room, next.userId);
  hook.mount({ room: 'event', userId: 'viewer-one', ...props });
  return { environment, hook };
}
async function settle(hook: Harness) {
  for (let turn = 0; turn < 12; turn++) { await Promise.resolve(); hook.flush(); }
}
const message = (id: number, overrides: Row = {}): Message => ({
  id, room: 'event', user_id: 'viewer-two', user_name: 'Buddy', body: `Message ${id}`,
  kind: 'user', created_at: new Date(1_800_000_000_000 + id * 1000).toISOString(), deleted_at: null,
  reactions: [], viewerReaction: null, ...overrides,
} as Message);
const ids = (hook: Harness) => Array.from(hook.output.messages, row => row.id);
const latest = (environment: Environment) => environment.requests.at(-1)!;
async function snapshot(environment: Environment, hook: Harness, rows: Message[] = []) {
  latest(environment).resolve({ messages: rows }); await settle(hook);
}
let checks = 0;
async function test(name: string, check: () => Promise<void>) { await check(); checks++; console.log(`PASS ${name}`); }

async function main() {
  await test('initial history is fetched fresh for the room and viewer, with honest connecting status', async () => {
    const { environment, hook } = setup({ room: 'green room', userId: 'viewer & two' });
    assert.equal(environment.requests.length, 1);
    assert.equal(latest(environment).url.searchParams.get('room'), 'green room');
    assert.equal(latest(environment).url.searchParams.get('userId'), 'viewer & two');
    assert.equal(hook.output.loading, true);
    assert.equal(hook.output.connectionStatus, 'connecting');
    assert.deepEqual(ids(hook), []);
    await snapshot(environment, hook, [message(1, { room: 'green room' })]);
    assert.equal(hook.output.loading, false);
    assert.deepEqual(ids(hook), [1]);
    assert.equal(hook.output.syncError, null);
    assert.notEqual(hook.output.connectionStatus, 'live', 'A successful HTTP read must not claim a working socket');
    hook.unmount();
  });

  await test('fallback polling receives a saved buddy message without any websocket event', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook, [message(1)]);
    environment.advance(3000); await settle(hook);
    assert.equal(environment.requests.length, 2, 'A disconnected room must repair within three seconds');
    await snapshot(environment, hook, [message(1), message(2)]);
    assert.deepEqual(ids(hook), [1, 2]);
    hook.unmount();
  });

  await test('own accepted send and repeated realtime INSERT render only one copy', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook);
    const own = message(2, { user_id: 'viewer-one', user_name: 'Me' });
    hook.output.acceptMessage(own); hook.flush();
    environment.activeChannels()[0].emit('INSERT', own as unknown as Row);
    environment.activeChannels()[0].emit('INSERT', own as unknown as Row);
    hook.flush();
    assert.deepEqual(ids(hook), [2]);
    assert.equal(hook.output.messages[0].body, own.body);
    hook.unmount();
  });

  await test('soft deletion immediately removes the newest row and can clear the entire room', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook, [message(1), message(2)]);
    const channel = environment.activeChannels()[0];
    channel.emit('UPDATE', message(2, { deleted_at: '2026-10-09T22:00:00Z' }) as unknown as Row);
    hook.flush(); assert.deepEqual(ids(hook), [1]);
    channel.emit('UPDATE', message(1, { deleted_at: '2026-10-09T22:00:00Z' }) as unknown as Row);
    hook.flush(); assert.deepEqual(ids(hook), []);
    hook.unmount();
  });

  await test('message UPDATE and duplicate INSERT preserve existing reaction summaries', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook, [message(1, {
      reactions: [{ reaction: 'like', count: 3, viewerReacted: true }], viewerReaction: 'like',
    })]);
    const rowWithoutSummaries = message(1, { body: 'Edited message' }) as unknown as Row;
    delete rowWithoutSummaries.reactions; delete rowWithoutSummaries.viewerReaction;
    const channel = environment.activeChannels()[0];
    channel.emit('UPDATE', rowWithoutSummaries); channel.emit('INSERT', rowWithoutSummaries); hook.flush();
    assert.deepEqual(ids(hook), [1]); assert.equal(hook.output.messages[0].body, 'Edited message');
    assert.equal(hook.output.messages[0].reactions?.[0]?.count, 3); assert.equal(hook.output.messages[0].viewerReaction, 'like');
    hook.unmount();
  });

  await test('hard DELETE removes a row even when the old payload contains only its primary key', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook, [message(1), message(2)]);
    environment.activeChannels()[0].emit('DELETE', {}, { id: 2 });
    hook.flush(); assert.deepEqual(ids(hook), [1]);
    hook.unmount();
  });

  await test('a confirmed deleted ID cannot reappear through delayed own-send, INSERT, or stale repair copies', async () => {
    for (const deletion of ['UPDATE', 'DELETE'] as const) {
      const { environment, hook } = setup(); await snapshot(environment, hook, [message(1)]);
      const channel = environment.activeChannels()[0];
      if (deletion === 'UPDATE') channel.emit('UPDATE', message(1, { deleted_at: '2026-10-09T22:00:00Z' }) as unknown as Row);
      else channel.emit('DELETE', {}, { id: 1 });
      channel.emit('INSERT', message(1) as unknown as Row); hook.output.acceptMessage(message(1)); hook.flush();
      assert.deepEqual(ids(hook), []);
      void hook.output.refresh(); await snapshot(environment, hook, [message(1)]);
      assert.deepEqual(ids(hook), [], 'A known tombstone must dominate delayed copies of that ID');
      hook.unmount();
    }
  });

  await test('authoritative repair snapshots prune missed deletions, including empty history', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook, [message(1), message(2)]);
    void hook.output.refresh(); await snapshot(environment, hook, [message(1)]);
    assert.deepEqual(ids(hook), [1], 'A deleted last message must not be retained as a supposedly newer row');
    void hook.output.refresh(); await snapshot(environment, hook);
    assert.deepEqual(ids(hook), [], 'An empty authoritative history must clear stale rows');
    hook.unmount();
  });

  await test('realtime insert, edits, and deletion during a fetch win over its stale snapshot', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook, [message(1), message(2)]);
    void hook.output.refresh();
    const channel = environment.activeChannels()[0];
    channel.emit('INSERT', message(3) as unknown as Row);
    channel.emit('UPDATE', message(1, { body: 'Edited while loading' }) as unknown as Row);
    channel.emit('UPDATE', message(2, { deleted_at: '2026-10-09T22:00:00Z' }) as unknown as Row);
    hook.flush();
    await snapshot(environment, hook, [message(1), message(2)]);
    assert.deepEqual(ids(hook), [1, 3]);
    assert.equal(hook.output.messages[0].body, 'Edited while loading');
    hook.unmount();
  });

  await test('a delete received while JSON parsing is pending cannot be resurrected by that response', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook, [message(1)]);
    void hook.output.refresh();
    let resolveBody!: (value: unknown) => void;
    latest(environment).resolveBody(new Promise(resolve => { resolveBody = resolve; }));
    await settle(hook);
    environment.activeChannels()[0].emit('DELETE', {}, { id: 1 }); hook.flush();
    resolveBody({ messages: [message(1)] }); await settle(hook);
    assert.deepEqual(ids(hook), []);
    hook.unmount();
  });

  await test('an accepted own message and local reaction patch survive an in-flight stale history', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook, [message(1)]);
    void hook.output.refresh();
    hook.output.acceptMessage(message(2, { user_id: 'viewer-one' }));
    hook.output.updateMessage(1, { reactions: [{ reaction: 'love', count: 1, viewerReacted: true }], viewerReaction: 'love' });
    hook.flush();
    await snapshot(environment, hook, [message(1)]);
    assert.deepEqual(ids(hook), [1, 2]);
    assert.equal(hook.output.messages[0].viewerReaction, 'love');
    assert.equal(hook.output.messages[0].reactions?.[0]?.count, 1);
    hook.unmount();
  });

  await test('raw realtime UPDATE cannot erase an in-flight local reaction patch from the replay journal', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook, [message(1)]);
    void hook.output.refresh();
    hook.output.updateMessage(1, { reactions: [{ reaction: 'love', count: 1, viewerReacted: true }], viewerReaction: 'love' });
    const raw = message(1, { body: 'Edited after reaction' }) as unknown as Row;
    delete raw.reactions; delete raw.viewerReaction;
    environment.activeChannels()[0].emit('UPDATE', raw);
    environment.activeChannels()[0].emit('INSERT', raw); hook.flush();
    assert.equal(hook.output.messages[0].viewerReaction, 'love', 'The visible cache preserves the local patch');
    await snapshot(environment, hook, [message(1)]);
    assert.equal(hook.output.messages[0].viewerReaction, 'love', 'The journal must preserve that same patch when replayed over a stale response');
    assert.equal(hook.output.messages[0].reactions?.[0]?.count, 1);
    assert.equal(hook.output.messages[0].body, 'Edited after reaction');
    hook.unmount();
  });

  await test('failed HTTP, network, and malformed snapshots preserve confirmed history without fake messages', async () => {
    for (const failure of ['http', 'network', 'malformed'] as const) {
      const { environment, hook } = setup();
      await snapshot(environment, hook, [message(4)]);
      void hook.output.refresh();
      if (failure === 'network') latest(environment).reject();
      else latest(environment).resolve(failure === 'malformed' ? { messages: 'not an array' } : { error: 'Unavailable' }, failure !== 'http');
      await settle(hook);
      assert.deepEqual(ids(hook), [4]);
      assert(hook.output.syncError, `${failure} must visibly report sync failure`);
      assert.equal(hook.output.loading, false);
      assert.notEqual(hook.output.connectionStatus, 'live');
      void hook.output.refresh(); await snapshot(environment, hook, [message(4), message(5)]);
      assert.deepEqual(ids(hook), [4, 5]); assert.equal(hook.output.syncError, null);
      hook.unmount();
    }
  });

  await test('first-load failure leaves empty real history, and recovery fills it', async () => {
    const { environment, hook } = setup();
    latest(environment).reject(); await settle(hook);
    assert.deepEqual(ids(hook), []); assert(hook.output.syncError); assert.equal(hook.output.loading, false);
    environment.advance(3000); await snapshot(environment, hook, [message(1)]);
    assert.deepEqual(ids(hook), [1]); assert.equal(hook.output.syncError, null);
    hook.unmount();
  });

  await test('a hanging HTTP request is aborted within twelve seconds and the repair can recover', async () => {
    const { environment, hook } = setup();
    const first = environment.requests[0];
    environment.advance(12000); await settle(hook);
    assert.equal(first.signal.aborted, true); assert.deepEqual(ids(hook), []);
    assert.equal(hook.output.loading, false); assert(hook.output.syncError);
    assert.notEqual(hook.output.connectionStatus, 'live');
    assert(environment.activeRequests().length <= 1, 'Timeout retries must not overlap');
    if (!environment.activeRequests().length) { environment.advance(3000); await settle(hook); }
    await snapshot(environment, hook, [message(1)]);
    assert.deepEqual(ids(hook), [1]); assert.equal(hook.output.syncError, null);
    hook.unmount(); await settle(hook);
    assert.equal(environment.timers.size, 0);
  });

  await test('an uncooperative body resolved after its timeout cannot be accepted as healthy history', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook, [message(1)]);
    void hook.output.refresh();
    const request = latest(environment);
    let resolveBody!: (value: unknown) => void;
    request.resolveBody(new Promise(resolve => { resolveBody = resolve; })); await settle(hook);
    environment.advance(12000); assert(request.signal.aborted);
    resolveBody({ messages: [message(99)] }); await settle(hook);
    assert.deepEqual(ids(hook), [1]); assert(hook.output.syncError);
    assert.notEqual(hook.output.connectionStatus, 'live');
    hook.unmount(); await settle(hook);
    assert.equal(environment.timers.size, 0);
  });

  await test('invalid message records fail visibly without replacing real history', async () => {
    for (const invalid of [message(0), message(2, { kind: 'unexpected' }), message(2, { body: null })]) {
      const { environment, hook } = setup(); await snapshot(environment, hook, [message(1)]);
      void hook.output.refresh(); latest(environment).resolve({ messages: [invalid] }); await settle(hook);
      assert.deepEqual(ids(hook), [1]); assert(hook.output.syncError);
      hook.unmount();
    }
  });

  await test('subscribe, interruption, offline, and recovery expose honest connection states', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook);
    const channel = environment.activeChannels()[0];
    channel.status('SUBSCRIBED'); await settle(hook);
    if (environment.activeRequests().length) await snapshot(environment, hook);
    assert.equal(hook.output.connectionStatus, 'live');
    channel.status('CHANNEL_ERROR'); await settle(hook);
    assert.equal(hook.output.connectionStatus, 'reconnecting');
    environment.navigator.onLine = false; environment.window.emit('offline'); hook.flush();
    assert.equal(hook.output.connectionStatus, 'offline');
    environment.navigator.onLine = true; environment.window.emit('online'); hook.flush();
    assert.notEqual(hook.output.connectionStatus, 'offline');
    const recovered = environment.activeChannels().at(-1)!;
    recovered.status('SUBSCRIBED'); await settle(hook);
    if (environment.activeRequests().length) await snapshot(environment, hook);
    assert.equal(hook.output.connectionStatus, 'live');
    hook.unmount();
  });

  await test('closed and timed-out sockets never retain a misleading live status', async () => {
    for (const interrupted of ['CLOSED', 'TIMED_OUT']) {
      const { environment, hook } = setup(); await snapshot(environment, hook);
      const channel = environment.activeChannels()[0];
      channel.status('SUBSCRIBED'); await settle(hook);
      if (environment.activeRequests().length) await snapshot(environment, hook);
      assert.equal(hook.output.connectionStatus, 'live');
      channel.status(interrupted); hook.flush();
      assert.equal(hook.output.connectionStatus, 'reconnecting');
      environment.advance(3000); await settle(hook);
      assert.equal(environment.activeRequests().length, 1);
      await snapshot(environment, hook); assert.notEqual(hook.output.connectionStatus, 'live');
      hook.unmount();
    }
  });

  await test('healthy realtime still repairs missed message/reaction changes within thirty seconds', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook, [message(1)]);
    environment.activeChannels()[0].status('SUBSCRIBED'); await settle(hook);
    if (environment.activeRequests().length) await snapshot(environment, hook, [message(1)]);
    const before = environment.requests.length;
    environment.advance(30000); await settle(hook);
    assert(environment.requests.length > before, 'A healthy socket cannot be the only history repair mechanism');
    await snapshot(environment, hook, [message(1, { reactions: [{ reaction: 'haha', count: 2, viewerReacted: false }] }), message(2)]);
    assert.deepEqual(ids(hook), [1, 2]); assert.equal(hook.output.messages[0].reactions?.[0]?.count, 2);
    hook.unmount();
  });

  await test('concurrent resume, reaction, polling, and manual refresh keep one request in flight', async () => {
    const { environment, hook } = setup();
    void hook.output.refresh(); void hook.output.refresh();
    environment.window.emit('pageshow'); environment.window.emit('online'); environment.document.emit('visibilitychange');
    environment.activeChannels()[0].emit('INSERT', { id: 1 }, {}, 'message_reactions');
    environment.advance(3000); await settle(hook);
    assert.equal(environment.requests.length, 1); assert.equal(environment.activeRequests().length, 1);
    await snapshot(environment, hook);
    assert(environment.activeRequests().length <= 1);
    if (environment.activeRequests().length) await snapshot(environment, hook);
    hook.unmount();
  });

  await test('visibility and page restore catch up on resume without duplicate listeners', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook, [message(1)]);
    const listenerCount = environment.listenerCount();
    assert.equal(environment.document.count('visibilitychange'), 1);
    assert.equal(environment.window.count('pageshow'), 1);
    assert.equal(environment.window.count('online'), 1);
    assert.equal(environment.window.count('offline'), 1);
    for (const event of ['visibilitychange', 'pageshow']) {
      const before = environment.requests.length;
      if (event === 'visibilitychange') environment.document.emit(event); else environment.window.emit(event);
      await settle(hook);
      assert.equal(environment.requests.length, before + 1);
      await snapshot(environment, hook, [message(1), message(2)]);
    }
    assert.deepEqual(ids(hook), [1, 2]); assert.equal(environment.listenerCount(), listenerCount);
    hook.unmount();
  });

  await test('room changes abort the old request and cannot mix late messages or errors', async () => {
    for (const failOld of [false, true]) {
      const { environment, hook } = setup({}, new Environment(false));
      const oldRequest = environment.requests[0]; const oldChannel = environment.channels[0];
      hook.update({ room: 'lobby' });
      assert(oldRequest.signal.aborted); assert(oldChannel.removed);
      assert.equal(environment.activeChannels().length, 1);
      assert.deepEqual(ids(hook), []);
      assert.equal(latest(environment).url.searchParams.get('room'), 'lobby');
      if (failOld) oldRequest.reject(); else oldRequest.resolve({ messages: [message(99)] });
      oldChannel.emit('INSERT', message(100) as unknown as Row); oldChannel.status('SUBSCRIBED');
      await settle(hook);
      assert.deepEqual(ids(hook), []); assert.equal(hook.output.syncError, null);
      assert.equal(environment.activeRequests().length, 1, 'Old cleanup must not unlock the new request');
      await snapshot(environment, hook, [message(7, { room: 'lobby' })]);
      assert.deepEqual(ids(hook), [7]);
      hook.unmount();
    }
  });

  await test('changing viewers refetches viewer-specific reactions and rejects a late prior-viewer response', async () => {
    const { environment, hook } = setup({}, new Environment(false));
    const old = environment.requests[0];
    hook.update({ userId: 'viewer-other' });
    assert(old.signal.aborted); assert.equal(latest(environment).url.searchParams.get('userId'), 'viewer-other');
    old.resolve({ messages: [message(1, { viewerReaction: 'love' })] }); await settle(hook);
    assert.deepEqual(ids(hook), []);
    await snapshot(environment, hook, [message(1, { viewerReaction: null })]);
    assert.equal(hook.output.messages[0].viewerReaction, null);
    hook.unmount();
  });

  await test('untrusted cross-room and malformed realtime messages cannot contaminate the active room', async () => {
    const { environment, hook } = setup(); await snapshot(environment, hook, [message(1)]);
    const channel = environment.activeChannels()[0];
    channel.emit('INSERT', message(2, { room: 'other' }) as unknown as Row);
    channel.emit('UPDATE', message(1, { room: 'other', body: 'Wrong room edit' }) as unknown as Row);
    channel.emit('INSERT', { id: 99, room: 'event', body: 'Malformed' });
    hook.output.acceptMessage(message(3, { room: 'other' })); hook.flush();
    assert.deepEqual(ids(hook), [1]); assert.equal(hook.output.messages[0].body, 'Message 1');
    hook.unmount();
  });

  await test('same-room rerenders preserve the single channel, observers, and refresh identity', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook);
    const refresh = hook.output.refresh; const channel = environment.channels[0]; const before = environment.requests.length;
    const adds = environment.document.adds + environment.window.adds;
    for (let turn = 0; turn < 3; turn++) hook.update({ room: 'event', userId: 'viewer-one' });
    assert.equal(hook.output.refresh, refresh); assert.equal(environment.activeChannels()[0], channel);
    assert.equal(environment.channels.length, 1); assert.equal(environment.requests.length, before);
    assert.equal(environment.document.adds + environment.window.adds, adds);
    hook.unmount();
  });

  await test('StrictMode setup/cleanup/setup retains exactly one live owner and ignores old callbacks', async () => {
    const { environment, hook } = setup({}, new Environment(false));
    const oldRequest = environment.requests[0]; const oldChannel = environment.channels[0];
    hook.strictModeReplay(); await settle(hook);
    assert(oldRequest.signal.aborted); assert(oldChannel.removed);
    assert.equal(environment.activeChannels().length, 1); assert.equal(environment.activeRequests().length, 1);
    assert.equal(environment.listenerCount(), 4);
    oldRequest.resolve({ messages: [message(99)] }); oldChannel.emit('INSERT', message(100) as unknown as Row);
    oldChannel.status('CHANNEL_ERROR'); await settle(hook);
    assert.deepEqual(ids(hook), []); assert.equal(hook.output.syncError, null);
    await snapshot(environment, hook, [message(1)]); assert.deepEqual(ids(hook), [1]);
    hook.unmount(); await settle(hook);
    assert.equal(environment.timers.size + environment.listenerCount() + environment.activeChannels().length, 0);
    assert.equal(environment.document.adds, environment.document.removes); assert.equal(environment.window.adds, environment.window.removes);
    assert.equal(hook.writesAfterUnmount, 0);
  });

  await test('two mounted chats own different topics and one cleanup cannot close the other', async () => {
    const environment = new Environment();
    const first = setup({}, environment).hook;
    const firstChannel = environment.channels[0];
    await snapshot(environment, first, [message(1)]);
    const second = setup({}, environment).hook;
    const secondChannel = environment.channels[1];
    await snapshot(environment, second, [message(1)]);
    assert.notEqual(firstChannel.name, secondChannel.name, 'Supabase reuses identical topics, so each owner needs its own');
    first.unmount(); await settle(first);
    assert(firstChannel.removed); assert.equal(secondChannel.removed, false);
    secondChannel.emit('INSERT', message(2) as unknown as Row); second.flush();
    assert.deepEqual(ids(second), [1, 2]);
    second.unmount(); await settle(second);
    assert.equal(environment.timers.size + environment.listenerCount() + environment.activeChannels().length, 0);
  });

  await test('unmount aborts requests and ignores late responses, timers, socket events, and captured refresh', async () => {
    for (const failLate of [false, true]) {
      const { environment, hook } = setup({}, new Environment(false));
      const request = environment.requests[0]; const channel = environment.channels[0];
      const refresh = hook.output.refresh; const callbacks = [...environment.timers.values()].map(timer => timer.callback);
      hook.unmount(); assert(request.signal.aborted); assert(channel.removed);
      if (failLate) request.reject(); else request.resolve({ messages: [message(99)] });
      channel.emit('INSERT', message(100) as unknown as Row); channel.status('SUBSCRIBED');
      for (const callback of callbacks) callback(); await refresh(); await settle(hook);
      environment.advance(30000); await settle(hook);
      assert.equal(environment.requests.length, 1); assert.equal(hook.writesAfterUnmount, 0);
      assert.equal(environment.timers.size + environment.listenerCount() + environment.activeChannels().length, 0);
    }
  });

  await test('confirmed message history remains bounded and chronological during repeated inserts', async () => {
    const { environment, hook } = setup();
    await snapshot(environment, hook);
    for (let id = 1; id <= 125; id++) environment.activeChannels()[0].emit('INSERT', message(id) as unknown as Row);
    hook.flush();
    assert.equal(hook.output.messages.length, 100);
    assert.deepEqual(ids(hook), Array.from({ length: 100 }, (_, index) => index + 26));
    hook.unmount();
  });
  console.log(`\n${checks} AIM message hook checks passed.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
