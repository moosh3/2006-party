/** Actual admin JSX/handlers with isolated requests; no live providers or DB. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';
import * as youtube from '../lib/youtube';

type Node = { type: unknown; key?: string; props: Record<string, any> };
type Harness = { react: Record<string, any>; component: (props: any) => Node; output: Node; mount(props: any): Node; flush(): Node; unmount(): void };
const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path: string) => readFileSync(join(project, path), 'utf8');
const shared = source('scripts/test-cast-run-interaction.ts');
const start = shared.indexOf('class HookHarness<');
const end = shared.indexOf('\nfunction evaluateModule(', start);
assert(start >= 0 && end > start);
const harnessSource = `${shared.slice(start, end)}\nexport { HookHarness };`;
const sameDeps = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
let ids = 0;
const video = { id: 'youtube-video', label: 'Captioned clip', playback_id: 'youtube:video:abcdefghijk', kind: 'vod', source_type: 'youtube_video', source_url: 'https://www.youtube.com/watch?v=abcdefghijk', youtube_playlist_id: null, duration_seconds: 213.5 };

class Environment {
  items: Record<string, any>[] = [
    { id: 'mux', label: 'Mux clip', playback_id: 'mux-clip', kind: 'vod', duration_seconds: 123 },
    video,
    { id: 'playlist', label: 'Ambient playlist', playback_id: 'youtube:playlist:PL1234567890', kind: 'vod', source_type: 'youtube_playlist' },
    { id: 'live', label: 'Live feed', playback_id: 'mux-live', kind: 'live', duration_seconds: 99 },
    { id: 'missing-duration', label: 'Needs duration clip', playback_id: 'unknown-duration', kind: 'vod' },
  ];
  requests: { url: string; method: string; body: any }[] = [];
  intervals = new Map<number, () => void>();
  warning = 'YouTube caption availability and embedding have not been verified. Preview this video before the show.';
  addError = false;
  currentError = false;
  metadataError = false;
  metadataUnavailable = false;
  captionsAvailable: boolean | null | undefined = true;
  metadataWarning: string | null = null;
  setInterval = (callback: () => void) => { const id = this.intervals.size + 1; this.intervals.set(id, callback); return id; };
  clearInterval = (id: number) => { this.intervals.delete(id); };
  fetch = async (url: string, options: Record<string, any> = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    this.requests.push({ url, method, body });
    let data: unknown;
    let ok = true;
    if (url === '/api/admin/mux-items' && method === 'GET') data = { items: this.items };
    else if (url.startsWith('/api/admin/youtube-video?url=') && method === 'GET') {
      ok = !this.metadataError;
      data = !ok ? { error: 'YouTube embedding is disabled for this video' }
        : this.metadataUnavailable ? { videoId: 'abcdefghijk', title: null, durationSeconds: null, captionsAvailable: null, metadataVerified: false, warning: 'YouTube metadata verification is temporarily unavailable. Enter the exact full duration and verify captions and embed playback before the show.' }
          : { videoId: 'abcdefghijk', title: 'Metadata clip title', durationSeconds: 213.5, captionsAvailable: this.captionsAvailable, metadataVerified: true, warning: this.metadataWarning };
    }
    else if (url === '/api/admin/mux-items' && method === 'POST') {
      ok = !this.addError;
      data = ok ? { item: { ...video, label: body.label || video.label }, duration_source: 'operator', warning: this.warning || undefined } : { error: 'Exact duration is required without YouTube metadata' };
    } else if (url === '/api/admin/set-current' && method === 'GET') data = null;
    else if (url === '/api/admin/set-current' && method === 'POST') {
      ok = !this.currentError;
      data = ok ? { stream: { playback_id: body.playbackId, title: body.title, kind: body.kind, source_type: body.sourceType } } : { error: 'Could not make the video current' };
    } else if (url === '/api/admin/polls?room=event') data = { polls: [] };
    else if (url === '/api/admin/hold-screen') data = { hold_screen_enabled: false, hold_screen_mux_item_id: null };
    else if (url === '/api/admin/queue' && method === 'GET') data = { queue: [] };
    else if (url === '/api/admin/queue' && method === 'POST') data = { ok: true };
    else if (url === '/api/admin/queue/auto-advance') data = { auto_advance_enabled: false };
    else throw new Error(`Unexpected request ${method} ${url}; live providers are forbidden`);
    return { ok, status: ok ? 200 : 400, json: async () => data };
  };
  posts(path: string) { return this.requests.filter((request) => request.url === path && request.method === 'POST'); }
}

function evaluate(code: string, environment: Environment, react?: Record<string, any>) {
  const testModule = { exports: {} as Record<string, any> };
  const jsx = (type: unknown, props: Record<string, any>, key?: string) => ({ type, props, key });
  const context = createContext({
    module: testModule, exports: testModule.exports, assert, sameDeps,
    fetch: environment.fetch, setInterval: environment.setInterval, clearInterval: environment.clearInterval,
    setTimeout: () => 1, clearTimeout() {}, confirm: () => true,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000002' },
    console: { error() {}, log() {}, warn() {} },
    require: (name: string) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === '@/lib/youtube') return youtube;
      if (name === './PlaybackControls') return { default: 'playback-controls-fixture' };
      throw new Error(`Unexpected import ${name}; live providers are forbidden`);
    },
  });
  const compiled = ts.transpileModule(code, { fileName: 'fixture.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  new Script(compiled.outputText).runInContext(context);
  return testModule.exports;
}
function mount(path: string, props: Record<string, any> = {}, environment = new Environment()) {
  const Constructor = evaluate(harnessSource, environment).HookHarness as { new(): Harness };
  const harness = new Constructor();
  const react = { ...harness.react, useId: () => harness.react.useRef(`:youtube-test-${++ids}:`).current };
  harness.component = evaluate(source(path), environment, react).default;
  harness.mount(props);
  return { harness, environment };
}
function nodes(node: unknown): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const value = node as Node;
  return [value, ...nodes(value.props.children)];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return text((node as Node).props.children);
}
function find(node: Node, type: string, label: string) {
  const result = nodes(node).find((candidate) => candidate.type === type && text(candidate) === label);
  assert(result, `Missing ${type}: ${label}`);
  return result;
}
function videoForm(harness: Harness) {
  const form = nodes(harness.output).find((node) => node.type === 'form' && nodes(node).some((child) => child.type === 'h3' && text(child) === 'Add YouTube Video'));
  assert(form);
  return form;
}
function input(harness: Harness, label: string) {
  const form = videoForm(harness);
  const labelNode = find(form, 'label', label);
  const field = nodes(form).find((node) => node.type === 'input' && node.props.id === labelNode.props.htmlFor);
  assert(field, `Label is not associated with ${label}`);
  return field;
}
function change(harness: Harness, label: string, value: string) { input(harness, label).props.onChange({ target: { value } }); harness.flush(); }
async function settle(harness: Harness) { for (let i = 0; i < 40; i++) { await Promise.resolve(); harness.flush(); } }
function status(harness: Harness) { const value = nodes(harness.output).find((node) => node.props.role === 'status'); assert(value); return value; }
async function submit(harness: Harness, makeCurrent = false) {
  if (makeCurrent) await find(videoForm(harness), 'button', 'Add & Make Current').props.onClick();
  else await videoForm(harness).props.onSubmit({ preventDefault() {} });
  await settle(harness);
}
const create = () => mount('components/admin/StreamControl.tsx', { showLibraryControls: true, showPlaybackControls: false });


async function main() {
  const environment = new Environment();
  const baseFetch = environment.fetch;
  let queue = ['A', 'B', 'C', 'D', 'E'].map((id, index) => ({ id, position: index + 1, mux_item_id: id, mux_items: { ...video, id, label: `Cue ${id}` } }));
  let fail = false;
  let release: (() => void) | undefined;
  let waitForSave = false;
  environment.fetch = async (url, options = {}) => {
    if (url === '/api/admin/queue' && (!options.method || options.method === 'GET')) return { ok: true, status: 200, json: async () => ({ queue: [...queue] }) };
    if (url === '/api/admin/queue' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      environment.requests.push({ url, method: 'PATCH', body });
      if (waitForSave) await new Promise<void>(resolve => { release = resolve; });
      if (!fail) queue = body.items.map((item: any) => ({ ...queue.find(cue => cue.id === item.id)!, position: item.position }));
      return { ok: !fail, status: fail ? 500 : 200, json: async () => fail ? { error: 'Save failed' } : { success: true } };
    }
    return baseFetch(url, options);
  };
  const { harness } = mount('components/admin/QueueManager.tsx', {}, environment);
  await settle(harness);
  const click = async (label: string) => { await find(harness.output, 'button', label).props.onClick(); await settle(harness); };
  const select = (id: string, shiftKey = false) => {
    const cue = nodes(harness.output).find(node => node.type === 'button' && node.props['aria-label']?.endsWith(`: Cue ${id}`));
    assert(cue); cue.props.onClick({ shiftKey }); harness.flush();
  };
  const order = () => queue.map(cue => cue.id).join('');
  const selected = () => nodes(harness.output).filter(node => node.type === 'button' && node.props['aria-pressed']).length;
  select('B'); select('D');
  await click('↑ Up'); assert.equal(order(), 'BADCE'); assert.equal(selected(), 2);
  await click('↓ Down'); assert.equal(order(), 'ABCDE');
  await click('Move to top'); assert.equal(order(), 'BDACE');
  await click('Undo move'); assert.equal(order(), 'ABCDE');
  await click('Move to end'); assert.equal(order(), 'ACEBD');
  await click('Undo move');
  const field = nodes(harness.output).find(node => node.type === 'input' && node.props.type === 'number')!;
  field.props.onChange({ target: { value: '3' } }); harness.flush();
  const submit = () => nodes(harness.output).find(node => node.type === 'form')!.props.onSubmit({ preventDefault() {} });
  submit(); await settle(harness); assert.equal(order(), 'ACBDE');
  await click('Undo move'); assert.equal(order(), 'ABCDE');
  console.log('PASS disjoint selection, one-step moves, group placement, exact position and undo preserve relative order');
  await click('Clear'); select('B'); select('D', true); assert.equal(selected(), 3);
  for (const callback of environment.intervals.values()) callback();
  await settle(harness); assert.equal(selected(), 3);
  await click('Move to top'); assert.equal(order(), 'BCDAE');
  console.log('PASS Shift range selection and selection preservation through polling');
  fail = true; await click('Move to end'); assert.equal(order(), 'BCDAE');
  assert(text(harness.output).includes('Save failed')); assert.equal(find(harness.output, 'button', 'Move to end').props.disabled, false);
  fail = false;
  waitForSave = true;
  const save = find(harness.output, 'button', 'Move to end').props.onClick();
  await settle(harness); assert.equal(find(harness.output, 'button', 'Move to top').props.disabled, true);
  assert(release); release(); await save; await settle(harness); waitForSave = false;
  assert.equal(order(), 'AEBCD');
  console.log('PASS failed save preserves order and pending save prevents duplicate actions');
  queue = queue.filter(cue => cue.id !== 'B');
  for (const callback of environment.intervals.values()) callback();
  await settle(harness); assert.equal(selected(), 2);
  assert.equal(find(harness.output, 'button', 'Undo move').props.disabled, true);
  assert.equal(environment.requests.filter(request => request.url.includes('/next') || request.url.includes('playback')).length, 0);
  harness.unmount();
  console.log('PASS external queue changes prune selection and invalidate undo; arranging never sends playback commands');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
