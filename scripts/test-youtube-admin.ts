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
{
  const { harness } = create(); await settle(harness);
  const other = create(); await settle(other.harness);
  for (const label of ['Video URL or ID', 'Title / label (optional)', 'Exact video duration (seconds)']) {
    const field = input(harness, label);
    assert(field.props.className.includes('min-h-[44px]'));
    assert.notEqual(field.props.id, input(other.harness, label).props.id);
  }
  assert(input(harness, 'Exact video duration (seconds)').props['aria-describedby']);
  assert(text(videoForm(harness)).includes('when the video has them'));
  for (const button of nodes(videoForm(harness)).filter((node) => node.type === 'button')) assert(button.props.className.includes('min-h-[44px]'));
  harness.unmount(); other.harness.unmount();
  console.log('PASS unique associated input labels, duration help, caption caveat, 44px targets');
}
{
  const { harness, environment } = create(); await settle(harness);
  change(harness, 'Video URL or ID', 'https://youtu.be/abcdefghijk');
  await find(videoForm(harness), 'button', 'Check Video').props.onClick(); await settle(harness);
  assert.equal(input(harness, 'Title / label (optional)').props.value, 'Metadata clip title');
  assert.equal(input(harness, 'Exact video duration (seconds)').props.value, '213.5');
  assert(text(status(harness)).includes('reports captions available'));
  assert.equal(environment.posts('/api/admin/mux-items').length, 0);
  assert.equal(environment.posts('/api/admin/set-current').length, 0);
  change(harness, 'Title / label (optional)', 'Operator label');
  environment.captionsAvailable = false;
  await find(videoForm(harness), 'button', 'Check Video').props.onClick(); await settle(harness);
  assert.equal(input(harness, 'Title / label (optional)').props.value, 'Operator label');
  assert(text(status(harness)).includes('Caption availability is unverified'));
  assert(text(status(harness)).includes('Auto-generated captions may still work'));
  assert.equal(input(harness, 'Exact video duration (seconds)').props.value, '213.5');
  assert(status(harness).props.className.includes('text-amber-900'));
  environment.captionsAvailable = null;
  environment.metadataWarning = 'Caption availability is unverified. Auto-generated captions may still work; confirm captions in the embedded player before the show.';
  await find(videoForm(harness), 'button', 'Check Video').props.onClick(); await settle(harness);
  assert.equal(text(status(harness)).split('Caption availability is unverified').length, 2, 'Warning is shown once, not duplicated');
  assert(!find(videoForm(harness), 'button', 'Add to Library').props.disabled);
  assert.equal(environment.posts('/api/admin/mux-items').length, 0, 'Check stays read-only for unverified captions');
  environment.metadataError = true;
  await find(videoForm(harness), 'button', 'Check Video').props.onClick(); await settle(harness);
  assert(text(status(harness)).includes('embedding is disabled'));
  assert.equal(input(harness, 'Video URL or ID').props.value, 'https://youtu.be/abcdefghijk');
  environment.metadataError = false; environment.metadataUnavailable = true;
  await find(videoForm(harness), 'button', 'Check Video').props.onClick(); await settle(harness);
  assert(text(status(harness)).includes('verification is temporarily unavailable'));
  assert(status(harness).props.className.includes('text-amber-900'));
  assert.equal(input(harness, 'Exact video duration (seconds)').props.value, '213.5');
  harness.unmount(); console.log('PASS read-only metadata check, autofill, operator-label preservation, caption and embed errors');
}
{
  const { harness, environment } = create(); await settle(harness);
  environment.captionsAvailable = null;
  environment.metadataWarning = 'Caption availability is unverified. Auto-generated captions may still work; confirm captions in the embedded player before the show.';
  environment.warning = environment.metadataWarning;
  change(harness, 'Video URL or ID', 'https://youtu.be/abcdefghijk');
  await find(videoForm(harness), 'button', 'Check Video').props.onClick(); await settle(harness);
  await submit(harness);
  assert.equal(environment.posts('/api/admin/mux-items').length, 1);
  assert.equal(environment.posts('/api/admin/mux-items')[0].body.durationSeconds, 213.5);
  assert.equal(environment.posts('/api/admin/set-current').length, 0);
  assert(text(status(harness)).includes('Auto-generated captions may still work'));
  assert(status(harness).props.className.includes('text-amber-900'));
  harness.unmount(); console.log('PASS unverified automatic-caption metadata allows library-only add and retains its warning');
}
{
  const { harness, environment } = create(); await settle(harness);
  await submit(harness);
  assert.equal(environment.posts('/api/admin/mux-items').length, 0);
  change(harness, 'Video URL or ID', 'abcdefghijk');
  for (const duration of ['-4', '0', 'Infinity']) {
    change(harness, 'Exact video duration (seconds)', duration); await submit(harness);
    assert.equal(environment.posts('/api/admin/mux-items').length, 0);
    assert(text(status(harness)).includes('positive number'));
  }
  harness.unmount(); console.log('PASS empty URL and non-positive/non-finite durations rejected before request');
}
for (const makeCurrent of [false, true]) {
  const { harness, environment } = create(); await settle(harness);
  change(harness, 'Video URL or ID', ' https://youtu.be/abcdefghijk ');
  change(harness, 'Title / label (optional)', ' My show clip ');
  change(harness, 'Exact video duration (seconds)', '213.5');
  await submit(harness, makeCurrent);
  assert.deepEqual(environment.posts('/api/admin/mux-items')[0].body, { sourceType: 'youtube_video', sourceUrl: 'https://youtu.be/abcdefghijk', label: 'My show clip', durationSeconds: 213.5 });
  assert(text(status(harness)).includes(environment.warning));
  assert(status(harness).props.className.includes('text-amber-900'));
  assert.equal(input(harness, 'Video URL or ID').props.value, '');
  assert.equal(environment.posts('/api/admin/set-current').length, makeCurrent ? 1 : 0);
  if (makeCurrent) {
    const request = environment.posts('/api/admin/set-current')[0].body;
    assert.equal(request.sourceType, 'youtube_video');
    assert.equal(request.youtubePlaylistId, null);
    assert.equal(request.sourceUrl, video.source_url);
    assert.equal(request.playbackId, video.playback_id);
  }
  harness.unmount(); console.log(`PASS ${makeCurrent ? 'Add & Make Current' : 'Add to Library'} preserves unverified-caption warning and video source contract`);
}
{
  const { harness, environment } = create(); await settle(harness);
  environment.addError = true;
  change(harness, 'Video URL or ID', 'abcdefghijk'); await submit(harness);
  assert.equal(input(harness, 'Video URL or ID').props.value, 'abcdefghijk');
  assert(text(status(harness)).includes('Exact duration is required'));
  assert.equal(environment.posts('/api/admin/set-current').length, 0);
  environment.addError = false; environment.currentError = true;
  await submit(harness, true);
  assert(text(status(harness)).includes('Could not make the video current'));
  assert(text(status(harness)).includes(environment.warning));
  harness.unmount(); console.log('PASS failed add retains draft; failed Make Current retains caption warning');
}
{
  const { harness, environment } = create(); await settle(harness);
  environment.warning = '';
  change(harness, 'Video URL or ID', 'abcdefghijk'); await submit(harness);
  assert.deepEqual(environment.posts('/api/admin/mux-items')[0].body, { sourceType: 'youtube_video', sourceUrl: 'abcdefghijk' });
  assert(status(harness).props.className.includes('text-green-800'));
  harness.unmount(); console.log('PASS metadata-backed add can omit optional label and duration');
}
{
  const { harness, environment } = mount('components/admin/QueueManager.tsx'); await settle(harness);
  const eligible = nodes(harness.output).filter((node) => node.type === 'button' && ['Add to Queue', 'Needs Duration'].includes(text(node)));
  assert.equal(eligible.length, 3, 'Mux, individual YouTube and missing-duration VOD are visible; playlist/live excluded');
  assert.equal(eligible.filter((node) => !node.props.disabled).length, 2);
  assert(find(harness.output, 'button', 'Needs Duration').props.disabled);
  assert(text(harness.output).includes('YouTube Video'));
  assert(text(harness.output).includes('YouTube Playlist'));
  await eligible[1].props.onClick(); await settle(harness);
  assert.deepEqual(environment.posts('/api/admin/queue')[0].body, { muxItemId: video.id });
  const before = environment.requests.filter((request) => request.url === '/api/admin/mux-items').length;
  for (const callback of environment.intervals.values()) callback(); await settle(harness);
  assert.equal(environment.requests.filter((request) => request.url === '/api/admin/mux-items').length, before + 1);
  harness.unmount(); assert.equal(environment.intervals.size, 0);
  console.log('PASS mixed Mux/YouTube queue, duration guard, playlist exclusion, refreshed library and timer cleanup');
}

{
  const environment = new Environment();
  environment.items = [
    { id: 'numeric-string-mux', label: 'Decimal Mux', playback_id: 'numeric-mux', kind: 'vod', duration_seconds: '123.5' },
    { ...video, duration_seconds: '20.5' },
    ...[null, '', ' ', '0', '-2', 'Infinity', 'NaN', '0x10', {}, true].map((duration, index) => ({ id: `bad-${index}`, label: `Invalid ${index}`, playback_id: `bad-${index}`, kind: 'vod', duration_seconds: duration })),
  ];
  const { harness } = mount('components/admin/QueueManager.tsx', {}, environment); await settle(harness);
  const available = nodes(harness.output).filter((node) => node.type === 'button' && text(node) === 'Add to Queue');
  assert.equal(available.length, 2, 'Positive decimal strings from PostgreSQL stay queueable for both sources');
  assert(available.every((node) => !node.props.disabled));
  assert.equal(nodes(harness.output).filter((node) => node.type === 'button' && text(node) === 'Needs Duration').length, 10);
  assert(text(harness.output).includes('2m 3.5s'));
  assert(text(harness.output).includes('0m 20.5s'));
  await available[1].props.onClick(); await settle(harness);
  assert.deepEqual(environment.posts('/api/admin/queue')[0].body, { muxItemId: video.id });
  harness.unmount(); console.log('PASS PostgreSQL decimal-string durations are rendered/queued; blanks, non-finite and invalid coercions stay disabled');
}

{
  const environment = new Environment();
  environment.items = [{ ...video, duration_seconds: '146.583333' }, { id: 'minute-rollover', label: 'Roll over label only', playback_id: 'minute-rollover', kind: 'vod', duration_seconds: '59.9999' }];
  const queue = mount('components/admin/QueueManager.tsx', {}, environment); await settle(queue.harness);
  const library = mount('components/admin/StreamControl.tsx', { showLibraryControls: true, showPlaybackControls: false }, environment); await settle(library.harness);
  for (const harness of [queue.harness, library.harness]) {
    assert(text(harness.output).includes('2m 26.583s'));
    assert(text(harness.output).includes('1m 0s'));
    assert(!text(harness.output).includes('26.583333'));
  }
  assert.equal(environment.items[0].duration_seconds, '146.583333', 'Display rounding never changes stored clock precision');
  const luminance = (hex: string) => {
    const channels = hex.match(/\w\w/g)!.map((part) => parseInt(part, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  // Tailwind's actual default 50 backgrounds and dark text classes used above.
  for (const [foreground, background] of [['166534', 'f0fdf4'], ['78350f', 'fffbeb'], ['991b1b', 'fef2f2']]) {
    assert((luminance(background) + 0.05) / (luminance(foreground) + 0.05) >= 4.5);
  }
  change(library.harness, 'Video URL or ID', 'abcdefghijk');
  environment.addError = true; await submit(library.harness);
  assert(status(library.harness).props.className.includes('text-red-800'));
  queue.harness.unmount(); library.harness.unmount();
  console.log('PASS rounded duration labels retain clock precision; success, warning and error palettes exceed 4.5:1 contrast');
}

console.log('All 11 isolated YouTube admin UI scenarios passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
