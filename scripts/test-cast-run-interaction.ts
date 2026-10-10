/**
 * Isolated hook/component regressions. Executes the actual TypeScript source
 * with the project's existing compiler and a tiny deterministic React-hook
 * harness. No React renderer dependency, browser, database, or network.
 *
 * This tests lifecycle/interaction ownership, not browser GIF decoding/layout.
 * The independent asset checks verify the original frames and bytes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';
import type { CastRunId } from '../lib/cast-runs';
import type ShowBuddyStrip from '../components/2006/ShowBuddyStrip';

type RunProps = Parameters<typeof import('../hooks/useCastRun').useCastRun>[0];
type RunOutput = ReturnType<typeof import('../hooks/useCastRun').useCastRun>;
type StripProps = Parameters<typeof ShowBuddyStrip>[0];
type Cleanup = () => void;
type Effect = () => void | Cleanup;
type VirtualNode = { type: unknown; key?: string; props: Record<string, unknown> };
type Cell =
  | { kind: 'state'; value: unknown; setter: (value: unknown) => void }
  | { kind: 'ref'; value: { current: unknown } }
  | { kind: 'callback'; value: unknown; deps: readonly unknown[] | undefined }
  | { kind: 'effect'; effect: Effect; deps: readonly unknown[] | undefined; cleanup?: Cleanup };

const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path: string) => readFileSync(join(project, path), 'utf8');
const assetsSource = source('lib/cast-runs.ts');
const hookSource = source('hooks/useCastRun.ts');
const stripSource = source('components/2006/ShowBuddyStrip.tsx');
const stripCss = source('components/2006/show-personality.css');
const sameDeps = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

class FakeEvents {
  private events = new Map<string, Set<() => void>>();
  adds = 0;
  removes = 0;
  addEventListener = (type: string, callback: () => void) => {
    const listeners = this.events.get(type) || new Set();
    if (!listeners.has(callback)) this.adds++;
    listeners.add(callback);
    this.events.set(type, listeners);
  };
  removeEventListener = (type: string, callback: () => void) => {
    if (this.events.get(type)?.delete(callback)) this.removes++;
  };
  emit(type: string) { for (const callback of [...(this.events.get(type) || [])]) callback(); }
  count(type: string) { return this.events.get(type)?.size || 0; }
}
class FakeMediaQuery extends FakeEvents {
  constructor(public matches = false) { super(); }
  change(matches: boolean) { this.matches = matches; this.emit('change'); }
}
class FakeClock {
  now = 0;
  private nextId = 0;
  timers = new Map<number, { due: number; callback: () => void }>();
  setTimeout = (callback: () => void, delay: number) => {
    const id = ++this.nextId;
    this.timers.set(id, { due: this.now + delay, callback });
    return id;
  };
  clearTimeout = (id: number) => { this.timers.delete(id); };
  advance(milliseconds: number) {
    const target = this.now + milliseconds;
    assert(milliseconds >= 0);
    let iterations = 0;
    for (;;) {
      const next = [...this.timers].sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next || next[1].due > target) break;
      assert(++iterations < 100, 'Unexpected timer loop');
      this.now = next[1].due;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.now = target;
  }
  onlyTimer() {
    assert.equal(this.timers.size, 1, 'Exactly one owner timer is allowed');
    return [...this.timers.values()][0];
  }
}
class Environment {
  clock = new FakeClock();
  mobile = new FakeMediaQuery(false);
  reduced = new FakeMediaQuery(false);
  document = Object.assign(new FakeEvents(), { hidden: false });
  private uuid = 0;
  window = {
    matchMedia: (query: string) => {
      if (query === '(max-width: 900px)') return this.mobile;
      if (query === '(prefers-reduced-motion: reduce)') return this.reduced;
      throw new Error('Unexpected media query');
    },
  };
  crypto = { randomUUID: () => `00000000-0000-4000-8000-${String(++this.uuid).padStart(12, '0')}` };
  listenerCounts() {
    return [this.mobile.count('change'), this.reduced.count('change'), this.document.count('visibilitychange')];
  }
}

/** React state batching, stable refs/callbacks, dependency-based effect cleanup,
 * and development StrictMode setup -> cleanup -> setup, without a renderer. */
class HookHarness<P, O> {
  private cells: Cell[] = [];
  private cursor = 0;
  private pending = new Set<number>();
  private dirty = false;
  private mounted = false;
  private everMounted = false;
  props!: P;
  output!: O;
  component!: (props: P) => O;
  writesAfterUnmount = 0;
  react = {
    useState: (initial: unknown) => {
      const index = this.cursor++;
      if (!this.cells[index]) {
        const cell: Extract<Cell, { kind: 'state' }> = {
          kind: 'state', value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
          setter: (next: unknown) => {
            if (this.everMounted && !this.mounted) { this.writesAfterUnmount++; return; }
            const value = typeof next === 'function' ? (next as (previous: unknown) => unknown)(cell.value) : next;
            if (!Object.is(cell.value, value)) { cell.value = value; this.dirty = true; }
          },
        };
        this.cells[index] = cell;
      }
      const cell = this.cells[index];
      assert.equal(cell.kind, 'state', 'Hook call order changed');
      if (cell.kind !== 'state') throw new Error('Invalid state slot');
      return [cell.value, cell.setter];
    },
    useRef: (initial: unknown) => {
      const index = this.cursor++;
      if (!this.cells[index]) this.cells[index] = { kind: 'ref', value: { current: initial } };
      const cell = this.cells[index];
      if (cell.kind !== 'ref') throw new Error('Hook call order changed');
      return cell.value;
    },
    useCallback: (callback: unknown, deps?: readonly unknown[]) => {
      const index = this.cursor++;
      const current = this.cells[index];
      if (!current || (current.kind === 'callback' && !sameDeps(current.deps, deps))) {
        this.cells[index] = { kind: 'callback', value: callback, deps };
      }
      const cell = this.cells[index];
      if (cell.kind !== 'callback') throw new Error('Hook call order changed');
      return cell.value;
    },
    useEffect: (effect: Effect, deps?: readonly unknown[]) => {
      const index = this.cursor++;
      const current = this.cells[index];
      if (!current) {
        this.cells[index] = { kind: 'effect', effect, deps };
        this.pending.add(index);
      } else {
        if (current.kind !== 'effect') throw new Error('Hook call order changed');
        if (!sameDeps(current.deps, deps)) this.pending.add(index);
        current.effect = effect;
        current.deps = deps;
      }
    },
  };
  renderOnly(props: P) {
    this.props = props;
    this.cursor = 0;
    this.dirty = false;
    this.output = this.component(props);
    return this.output;
  }
  mount(props: P) {
    this.renderOnly(props);
    this.mounted = true;
    this.everMounted = true;
    this.flush();
    return this.output;
  }
  flush() {
    for (let turns = 0; this.dirty || this.pending.size; turns++) {
      assert(turns < 20, 'Unexpected hook render loop');
      if (this.dirty) this.renderOnly(this.props);
      const pending = [...this.pending];
      this.pending.clear();
      for (const index of pending) {
        const cell = this.cells[index];
        if (cell.kind !== 'effect') throw new Error('Invalid effect slot');
        cell.cleanup?.();
        cell.cleanup = cell.effect() || undefined;
      }
    }
    return this.output;
  }
  update(props: Partial<P>) { this.renderOnly({ ...this.props, ...props }); return this.flush(); }
  strictModeReplay() {
    assert(this.mounted);
    for (const cell of this.cells) if (cell.kind === 'effect') {
      cell.cleanup?.();
      cell.cleanup = undefined;
    }
    for (const cell of this.cells) if (cell.kind === 'effect') cell.cleanup = cell.effect() || undefined;
    return this.flush();
  }
  unmount() {
    this.mounted = false;
    for (const cell of this.cells) if (cell.kind === 'effect') {
      cell.cleanup?.();
      cell.cleanup = undefined;
    }
    this.pending.clear();
    this.dirty = false;
  }
}

function evaluateModule(code: string, filename: string, environment: Environment, react: HookHarness<unknown, unknown>['react'], imports: Record<string, unknown> = {}) {
  const testModule = { exports: {} as Record<string, any> };
  const jsx = (type: unknown, props: Record<string, unknown>, key?: string): VirtualNode => ({ type, props, key });
  const context = createContext({
    module: testModule, exports: testModule.exports,
    require: (name: string) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (Object.prototype.hasOwnProperty.call(imports, name)) return imports[name];
      throw new Error(`Unexpected import ${name}; this test must not use network/database code`);
    },
    window: environment.window, document: environment.document, crypto: environment.crypto,
    setTimeout: environment.clock.setTimeout, clearTimeout: environment.clock.clearTimeout,
  });
  const compiled = ts.transpileModule(code, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error).length || 0, 0);
  new Script(compiled.outputText, { filename }).runInContext(context);
  return testModule.exports;
}

const defaultProps: RunProps = { paused: false, visible: true, mobilePanel: 'watch', safariVisible: true };
function setup(props: Partial<RunProps> = {}, browser: { mobile?: boolean; reduced?: boolean } = {}, ready = true) {
  const environment = new Environment();
  environment.mobile.matches = Boolean(browser.mobile);
  environment.reduced.matches = Boolean(browser.reduced);
  const hook = new HookHarness<RunProps, RunOutput>();
  const assets = evaluateModule(assetsSource, 'lib/cast-runs.ts', environment, hook.react);
  hook.component = evaluateModule(hookSource, 'hooks/useCastRun.ts', environment, hook.react, { '@/lib/cast-runs': assets }).useCastRun;
  if (ready) hook.mount({ ...defaultProps, ...props });
  else hook.renderOnly({ ...defaultProps, ...props });
  return {
    environment, hook,
    assets: assets.CAST_RUNS as typeof import('../lib/cast-runs').CAST_RUNS,
    sizing: assets.CAST_RUN_SIZING as typeof import('../lib/cast-runs').CAST_RUN_SIZING,
    canvasScale: assets.getCastRunCanvasScale as typeof import('../lib/cast-runs').getCastRunCanvasScale,
  };
}
function nodes(tree: unknown): VirtualNode[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
  const node = tree as VirtualNode;
  return [node, ...nodes(node.props.children)];
}
function createStrip(fixture: ReturnType<typeof setup>, origin: StripProps['origin'] = 'desktop') {
  const harness = new HookHarness<StripProps, VirtualNode>();
  const assets = evaluateModule(assetsSource, 'lib/cast-runs.ts', fixture.environment, harness.react);
  harness.component = evaluateModule(stripSource, 'components/2006/ShowBuddyStrip.tsx', fixture.environment, harness.react, { '@/lib/cast-runs': assets }).default;
  const props = (): StripProps => ({
    buddies: (Object.keys(fixture.assets) as CastRunId[]).map((art, index) => ({ art, index, name: art, screenName: art })),
    origin, run: fixture.hook.output.run, canRun: fixture.hook.output.canRun,
    reducedMotion: fixture.hook.output.reducedMotion, paused: fixture.hook.props.paused,
    onRun: fixture.hook.output.startRun, onLoad: fixture.hook.output.loadRun,
    onFinish: fixture.hook.output.finishRun, onOpen: () => undefined, onToggleMotion: () => undefined,
  });
  harness.mount(props());
  const refresh = () => { harness.update(props()); return harness.output; };
  const image = () => nodes(refresh()).find((node) => node.props.className === 'show2006-running-sprite');
  const status = () => nodes(refresh()).find((node) => node.props.className === 'show2006-run-status')?.props.children;
  return { harness, refresh, image, status };
}
function currentNonce(fixture: ReturnType<typeof setup>) {
  fixture.hook.flush();
  assert(fixture.hook.output.run);
  return fixture.hook.output.run.nonce;
}

let checks = 0;
function test(name: string, check: () => void) { check(); checks++; console.log(`PASS ${name}`); }

test('initial hydration is motion-safe until preferences have mounted', () => {
  const fixture = setup({}, {}, false);
  assert.equal(fixture.hook.output.canRun, false);
  assert.equal(fixture.hook.output.reducedMotion, true);
  assert.equal(fixture.hook.output.startRun('mk', 'desktop'), false);
  assert.equal(fixture.environment.clock.timers.size, 0);
  fixture.hook.mount(defaultProps);
  assert.equal(fixture.hook.output.canRun, true);
  assert.deepEqual(fixture.environment.listenerCounts(), [1, 1, 1]);
  fixture.hook.unmount();
});

test('rapid clicks are synchronously locked to one owner before a React render', () => {
  const fixture = setup();
  const start = fixture.hook.output.startRun;
  assert.equal(start('mk', 'desktop'), true);
  assert.equal(fixture.hook.output.run, null, 'State updates remain batched before flush');
  for (const origin of ['desktop', 'watch', 'extras'] as const) assert.equal(start('jen', origin), false);
  assert.equal(fixture.environment.clock.timers.size, 1);
  const running = fixture.hook.flush().run;
  assert.equal(running?.art, 'mk');
  assert.equal(running?.origin, 'desktop');
  const strips = (['desktop', 'watch', 'extras'] as const).map((origin) => createStrip(fixture, origin));
  assert.deepEqual(strips.map((strip) => Boolean(strip.image())), [true, false, false]);
  strips.forEach((strip) => strip.harness.unmount());
  fixture.hook.unmount();
});

for (const art of ['mk', 'jen', 'lip', 'yongwoo', 'emma', 'alec'] as const) {
  test(`${art} finishes after its complete asset duration measured from onLoad`, () => {
    const fixture = setup();
    assert.equal(fixture.hook.output.startRun(art, 'desktop'), true);
    const nonce = currentNonce(fixture);
    assert.equal(fixture.environment.clock.onlyTimer().due, 8000);
    fixture.environment.clock.advance(7000);
    fixture.hook.flush();
    assert.equal(fixture.hook.output.run?.loaded, false);
    fixture.hook.output.loadRun(nonce);
    fixture.hook.flush();
    const duration = fixture.assets[art].durationMs;
    assert.equal(fixture.hook.output.run?.loaded, true);
    assert.equal(fixture.environment.clock.onlyTimer().due, 7000 + duration);
    fixture.environment.clock.advance(duration - 1);
    fixture.hook.flush();
    assert.equal(fixture.hook.output.run?.nonce, nonce, 'The final frame must not be cut off');
    fixture.environment.clock.advance(1);
    fixture.hook.flush();
    assert.equal(fixture.hook.output.run, null);
    assert.equal(fixture.environment.clock.timers.size, 0);
    fixture.hook.unmount();
  });
}

test('duplicate onLoad events do not extend or restart the one-shot timer', () => {
  const fixture = setup();
  fixture.hook.output.startRun('jen', 'desktop');
  const nonce = currentNonce(fixture);
  fixture.hook.output.loadRun(nonce); fixture.hook.flush();
  const timer = fixture.environment.clock.onlyTimer();
  fixture.environment.clock.advance(1000);
  fixture.hook.output.loadRun(nonce); fixture.hook.flush();
  assert.equal(fixture.environment.clock.onlyTimer(), timer);
  fixture.environment.clock.advance(fixture.assets.jen.durationMs - 1000);
  fixture.hook.flush();
  assert.equal(fixture.hook.output.run, null);
  fixture.hook.unmount();
});

test('missing images unlock exactly at the eight-second loading deadline', () => {
  const fixture = setup();
  fixture.hook.output.startRun('alec', 'desktop');
  currentNonce(fixture);
  fixture.environment.clock.advance(7999); fixture.hook.flush();
  assert(fixture.hook.output.run);
  fixture.environment.clock.advance(1); fixture.hook.flush();
  assert.equal(fixture.hook.output.run, null);
  assert.equal(fixture.hook.output.startRun('emma', 'desktop'), true);
  fixture.hook.unmount();
});

test('stale load, finish, error, and timer callbacks cannot stop or mark a later owner', () => {
  const fixture = setup();
  const strip = createStrip(fixture);
  fixture.hook.output.startRun('mk', 'desktop');
  const oldNonce = currentNonce(fixture);
  const oldImage = strip.image()!;
  const oldTimer = fixture.environment.clock.onlyTimer().callback;
  assert.equal(fixture.hook.output.finishRun(oldNonce), true);
  fixture.hook.flush();
  assert.equal(fixture.hook.output.startRun('emma', 'desktop'), true);
  const newNonce = currentNonce(fixture);
  const currentTimer = fixture.environment.clock.onlyTimer();
  (oldImage.props.onLoad as () => void)();
  (oldImage.props.onError as () => void)();
  assert.equal(fixture.hook.output.finishRun(oldNonce), false);
  oldTimer();
  fixture.hook.flush();
  assert.equal(fixture.hook.output.run?.nonce, newNonce);
  assert.equal(fixture.hook.output.run?.loaded, false);
  assert.equal(fixture.environment.clock.onlyTimer(), currentTimer);
  assert.equal(strip.status(), 'emma is getting ready…');
  assert.equal(fixture.hook.output.finishRun(newNonce), true);
  fixture.hook.flush();
  assert.equal(fixture.hook.output.run, null);
  strip.harness.unmount(); fixture.hook.unmount();
});

test('repeated runs mount unique actual GIF URLs and image keys', () => {
  const fixture = setup();
  const strip = createStrip(fixture);
  const seen = new Set<string>();
  for (let repeat = 0; repeat < 4; repeat++) {
    assert.equal(fixture.hook.output.startRun('alec', 'desktop'), true);
    const nonce = currentNonce(fixture), image = strip.image()!;
    assert.equal(image.key, nonce);
    assert.equal(image.props.src, `${fixture.assets.alec.src}?run=${nonce}`);
    assert.equal(image.props.width, fixture.assets.alec.width);
    assert.equal(image.props.height, fixture.assets.alec.height);
    assert(!seen.has(String(image.props.src)));
    seen.add(String(image.props.src));
    (image.props.onLoad as () => void)(); fixture.hook.flush();
    fixture.environment.clock.advance(fixture.assets.alec.durationMs); fixture.hook.flush();
    assert.equal(strip.image(), undefined);
  }
  strip.harness.unmount(); fixture.hook.unmount();
});

for (const art of ['mk', 'jen', 'lip', 'yongwoo', 'emma', 'alec'] as const) {
  test(`${art} keeps its calibrated full canvas and idle-sized body on desktop and both mobile strips`, () => {
    let desktopScale: number | undefined;
    for (const origin of ['desktop', 'watch', 'extras'] as const) {
      const fixture = setup(origin === 'extras' ? { mobilePanel: 'extras' } : {}, { mobile: origin !== 'desktop' });
      const strip = createStrip(fixture, origin);
      const asset = fixture.assets[art], sizing = fixture.sizing[art];
      assert.equal(fixture.hook.output.startRun(art, origin), true);
      const nonce = currentNonce(fixture);
      for (const loaded of [false, true]) {
        if (loaded) { fixture.hook.output.loadRun(nonce); fixture.hook.flush(); }
        const tree = nodes(strip.refresh());
        const stages = tree.filter((node) => node.props.className === 'show2006-run-stage');
        assert.equal(stages.length, 1, 'The complete GIF has one owned stage');
        const style = stages[0].props.style as Record<string, number>;
        const scale = style['--cast-run-scale'];
        assert.equal(scale, fixture.canvasScale(art));
        assert(Number.isFinite(scale) && scale > 0);
        assert.deepEqual(Object.keys(style), ['--cast-run-scale'], 'No origin/phase-specific shrink or transform');
        if (desktopScale === undefined) desktopScale = scale;
        assert.equal(scale, desktopScale, 'Desktop, Watch, and Extras use the same fixed calibration');

        // These bounds were measured independently from the original frames.
        // A 48px idle canvas has a slightly shorter visible body for each person.
        const idleCanvasHeight = 48, idleSourceHeight = 160;
        const canvasHeight = idleCanvasHeight * scale;
        const visibleRunBody = canvasHeight * sizing.bodyHeight / asset.height;
        const visibleIdleBody = idleCanvasHeight * sizing.idleBodyHeight / idleSourceHeight;
        assert(Math.abs(visibleRunBody - visibleIdleBody) < 1e-10, 'The upright run body matches the original idle body');
        assert(canvasHeight <= 102, 'The full canvas keeps its calibration while transparent padding overflows the compact button');
        assert(canvasHeight * asset.width / asset.height <= 102, 'The full GIF width fits without cropping or shrinking');
        const image = tree.find((node) => node.props.className === 'show2006-running-sprite')!;
        assert.equal(image.props.src, `${asset.src}?run=${nonce}`, 'Use the unchanged original complete GIF');
        assert.equal(image.props.width, asset.width);
        assert.equal(image.props.height, asset.height);
        assert.equal(image.key, nonce);
        const idleImages = tree.filter((node) => node.type === 'img' && node.props.className !== 'show2006-running-sprite');
        assert.equal(idleImages.length, 6);
        assert(idleImages.every((node) => node.props.height === idleCanvasHeight));
      }
      strip.harness.unmount(); fixture.hook.unmount();
    }
  });
}

test('shared CSS preserves the 48px calibration and full canvas without mobile auto-shrink', () => {
  const definitions = [...stripCss.matchAll(/--cast-sprite-height\s*:\s*([^;}]+)/g)];
  assert(definitions.length > 0);
  assert(definitions.every((match) => match[1].trim() === '48px'), 'Viewport rules cannot replace the calibrated idle height');
  const rules = [...stripCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const canvasRules = rules.filter((match) => match[1].includes('.show2006-running-sprite'));
  assert(canvasRules.length > 0);
  for (const [, , declaration] of canvasRules) {
    assert.match(declaration, /width\s*:\s*calc\(var\(--cast-sprite-height\)\s*\*\s*var\(--cast-run-scale\)\)\s*;/);
    assert.match(declaration, /height\s*:\s*auto\s*;/);
    assert.match(declaration, /max-width\s*:\s*none\s*;/, 'The idle image max-width must not shrink the complete run canvas');
    assert.doesNotMatch(declaration, /(?:transform|scale|clip-path|object-position)\s*:/);
  }
  const slotRules = rules.filter((match) => /\.show2006-sprite-button\s*$/.test(match[1]) && /\bheight\s*:/.test(match[2]));
  assert(slotRules.length >= 2, 'Both desktop and mobile retain a stable compact portrait lane');
  for (const [, , declaration] of slotRules) {
    assert.match(declaration, /(?:^|;)\s*height\s*:\s*64px\s*;/);
    assert.match(declaration, /padding\s*:\s*0\s*;/);
  }
  const rosterRule = rules.find((match) => /(?:^|\s)\.show2006-cast-roster\s*$/.test(match[1]));
  assert(rosterRule);
  assert.match(rosterRule[2], /padding-top\s*:\s*6px\s*;/, 'All-frame overhead pixels retain their clearance');
  assert.match(rosterRule[2], /overflow-x\s*:\s*auto\s*;/, 'Narrow screens scroll the roster, not the page');
  assert.match(stripCss, /grid-auto-flow\s*:\s*column\s*;/, 'The cast stays in one row without pushing down the video');
  assert.match(stripCss, /grid-auto-columns\s*:\s*minmax\(104px,\s*1fr\)\s*;/, 'Full canvases keep enough horizontal room');
  const stageRule = rules.find((match) => /(?:^|\s)\.show2006-run-stage\s*$/.test(match[1]));
  assert(stageRule);
  assert.match(stageRule[2], /display\s*:\s*flex\s*;/, 'Grid intrinsic sizing must not push the oversized transparent canvas into names');
  assert.match(stageRule[2], /align-items\s*:\s*center\s*;/);
  assert.match(stageRule[2], /justify-content\s*:\s*center\s*;/);
});

for (const loaded of [false, true]) {
  for (const [label, changed, restored, blockedOrigin] of [
    ['pause', { paused: true }, { paused: false }, 'desktop'],
    ['hidden show', { visible: false }, { visible: true }, 'desktop'],
    ['closed Safari', { safariVisible: false }, { safariVisible: true }, 'desktop'],
  ] as const) {
    test(`${label} cancels a ${loaded ? 'loaded' : 'loading'} run and never resumes it automatically`, () => {
      const fixture = setup();
      fixture.hook.output.startRun('lip', 'desktop');
      const nonce = currentNonce(fixture);
      if (loaded) { fixture.hook.output.loadRun(nonce); fixture.hook.flush(); }
      fixture.hook.update(changed);
      assert.equal(fixture.hook.output.run, null);
      assert.equal(fixture.environment.clock.timers.size, 0);
      assert.equal(fixture.hook.output.startRun('lip', blockedOrigin), false);
      fixture.hook.output.loadRun(nonce);
      fixture.hook.update(restored);
      assert.equal(fixture.hook.output.run, null);
      assert.equal(fixture.hook.output.startRun('mk', 'desktop'), true);
      fixture.hook.unmount();
    });
  }
}

test('reduced-motion changes cancel immediately, keep original stills, and never replay on restoration', () => {
  const fixture = setup();
  const strip = createStrip(fixture);
  fixture.hook.output.startRun('mk', 'desktop');
  const nonce = currentNonce(fixture);
  fixture.hook.output.loadRun(nonce); fixture.hook.flush();
  fixture.environment.reduced.change(true); fixture.hook.flush();
  assert.equal(fixture.hook.output.run, null);
  assert.equal(fixture.hook.output.canRun, false);
  assert.equal(fixture.environment.clock.timers.size, 0);
  assert.equal(fixture.hook.output.startRun('mk', 'desktop'), false);
  const idleImages = nodes(strip.refresh()).filter((node) => node.type === 'img');
  assert.equal(idleImages.length, 6);
  assert(idleImages.every((node) => String(node.props.src).endsWith('.png')));
  fixture.environment.reduced.change(false); fixture.hook.flush();
  assert.equal(fixture.hook.output.run, null);
  assert.equal(fixture.hook.output.canRun, true);
  strip.harness.unmount(); fixture.hook.unmount();
});

test('mobile panel ownership cancels old runs and rejects hidden strips', () => {
  const fixture = setup({}, { mobile: true });
  assert.equal(fixture.hook.output.startRun('mk', 'desktop'), false);
  assert.equal(fixture.hook.output.startRun('mk', 'extras'), false);
  const watchStart = fixture.hook.output.startRun;
  assert.equal(watchStart('mk', 'watch'), true);
  const oldNonce = currentNonce(fixture);
  fixture.hook.update({ mobilePanel: 'extras' });
  assert.equal(fixture.hook.output.run, null);
  assert.equal(fixture.environment.clock.timers.size, 0);
  assert.equal(fixture.hook.output.startRun('jen', 'watch'), false);
  assert.equal(fixture.hook.output.startRun('jen', 'extras'), true);
  const nextNonce = currentNonce(fixture);
  assert.equal(watchStart('lip', 'watch'), false, 'A stale visible-origin handler cannot steal ownership');
  assert.equal(fixture.hook.output.finishRun(oldNonce), false);
  assert.equal(fixture.hook.flush().run?.nonce, nextNonce);
  for (const mobilePanel of ['game', 'chat'] as const) {
    fixture.hook.update({ mobilePanel });
    assert.equal(fixture.hook.output.run, null);
    for (const origin of ['desktop', 'watch', 'extras'] as const) assert.equal(fixture.hook.output.startRun('mk', origin), false);
  }
  fixture.hook.update({ mobilePanel: 'watch' });
  assert.equal(fixture.hook.output.run, null);
  assert.equal(fixture.hook.output.startRun('mk', 'watch'), true);
  fixture.hook.unmount();
});

test('viewport transitions cancel rather than transferring animation to another strip', () => {
  const fixture = setup();
  fixture.hook.output.startRun('mk', 'desktop'); currentNonce(fixture);
  fixture.environment.mobile.change(true); fixture.hook.flush();
  assert.equal(fixture.hook.output.run, null);
  assert.equal(fixture.environment.clock.timers.size, 0);
  assert.equal(fixture.hook.output.startRun('mk', 'desktop'), false);
  assert.equal(fixture.hook.output.startRun('mk', 'watch'), true);
  currentNonce(fixture);
  fixture.environment.mobile.change(false); fixture.hook.flush();
  assert.equal(fixture.hook.output.run, null);
  assert.equal(fixture.hook.output.startRun('mk', 'watch'), false);
  assert.equal(fixture.hook.output.startRun('mk', 'desktop'), true);
  fixture.hook.unmount();
});

test('document visibility cancels and blocks stale taps until visible, without resuming', () => {
  const fixture = setup();
  const start = fixture.hook.output.startRun;
  start('emma', 'desktop'); currentNonce(fixture);
  fixture.environment.document.hidden = true;
  fixture.environment.document.emit('visibilitychange'); fixture.hook.flush();
  assert.equal(fixture.hook.output.run, null);
  assert.equal(fixture.environment.clock.timers.size, 0);
  assert.equal(start('mk', 'desktop'), false);
  fixture.environment.document.hidden = false;
  fixture.environment.document.emit('visibilitychange'); fixture.hook.flush();
  assert.equal(fixture.hook.output.run, null);
  assert.equal(fixture.hook.output.startRun('mk', 'desktop'), true);
  fixture.hook.unmount();
});

test('StrictMode replay and final unmount remove every timer/listener and ignore late callbacks', () => {
  const fixture = setup();
  const events = [fixture.environment.mobile, fixture.environment.reduced, fixture.environment.document];
  assert.deepEqual(fixture.environment.listenerCounts(), [1, 1, 1]);
  fixture.hook.strictModeReplay();
  assert.deepEqual(fixture.environment.listenerCounts(), [1, 1, 1]);
  assert(events.every((event) => event.adds === 2 && event.removes === 1));
  fixture.hook.output.startRun('yongwoo', 'desktop');
  const nonce = currentNonce(fixture);
  fixture.hook.output.loadRun(nonce); fixture.hook.flush();
  const lateLoad = fixture.hook.output.loadRun, lateFinish = fixture.hook.output.finishRun;
  const lateTimer = fixture.environment.clock.onlyTimer().callback;
  fixture.hook.unmount();
  assert.deepEqual(fixture.environment.listenerCounts(), [0, 0, 0]);
  assert.equal(fixture.environment.clock.timers.size, 0);
  assert(events.every((event) => event.adds === event.removes));
  lateLoad(nonce);
  assert.equal(lateFinish(nonce), false);
  lateTimer();
  fixture.environment.mobile.change(true);
  fixture.environment.reduced.change(true);
  fixture.environment.document.hidden = true;
  fixture.environment.document.emit('visibilitychange');
  fixture.environment.clock.advance(8000);
  assert.equal(fixture.environment.clock.timers.size, 0);
  assert.equal(fixture.hook.writesAfterUnmount, 0);
});

console.log(`Cast run interactions: ${checks} isolated lifecycle checks passed; actual hook and strip source executed, no database/network.`);
