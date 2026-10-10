/** Real metadata helper + real route bodies with isolated provider/session/DB.
 * No .env loading, network, Supabase access, queue changes or live commands. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';
import * as youtube from '../lib/youtube';
import * as youtubeVideo from '../lib/youtube-video';

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO_ID = '-RgOm_WJKpE';
const VIDEO_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const TITLE = 'Alfie — isolated metadata regression';
const DURATION = 181.5; // Synthetic provider response, not this video's real duration.
const BASE = 'https://show.invalid';

type Json = Record<string, any>;
type Route = (request: Request & { nextUrl?: URL }) => Promise<Response>;
class Environment {
  session: { role: string } | null = { role: 'admin' };
  providerRequests = 0;
  inserts: Json[] = [];
  tableAccesses: string[] = [];
  rpcCalls = 0;
  providerVideo: Json | null = this.video();
  video(overrides: Json = {}): Json {
    return {
      id: VIDEO_ID,
      snippet: { title: TITLE, liveBroadcastContent: 'none' },
      contentDetails: { duration: 'PT3M1.5S', caption: 'true' },
      status: { privacyStatus: 'public', embeddable: true, uploadStatus: 'processed' },
      ...overrides,
    };
  }
  fetch: typeof fetch = async (input, init) => {
    this.providerRequests++;
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/youtube/v3/videos',
      'Only the stubbed official metadata endpoint is permitted');
    assert.equal(url.searchParams.get('id'), VIDEO_ID);
    assert.equal(url.searchParams.get('part'), 'snippet,contentDetails,status');
    assert.equal(init?.cache, 'no-store');
    assert(init?.signal, 'Provider lookup must remain bounded by a timeout');
    return new Response(JSON.stringify({ items: this.providerVideo ? [this.providerVideo] : [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  db = {
    from: (table: string) => {
      this.tableAccesses.push(table);
      assert.equal(table, 'mux_items', 'Caption validation may only insert a library item');
      return {
        insert: (value: Json) => {
          // Normalize the VM realm's object without mutating the route's value.
          const item: Json = JSON.parse(JSON.stringify(value));
          this.inserts.push(item);
          return { select: () => ({ single: async () => ({ data: { id: `isolated-${this.inserts.length}`, ...item }, error: null }) }) };
        },
      };
    },
    rpc: () => { this.rpcCalls++; throw new Error('Queue/stream RPCs are forbidden in caption-validation tests'); },
  };
}

function evaluateRoute(path: string, environment: Environment): { GET?: Route; POST?: Route } {
  const module = { exports: {} as { GET?: Route; POST?: Route } };
  const context = createContext({
    module, exports: module.exports, URL, Response,
    console: { warn() {}, error() {} },
    require: (name: string) => {
      if (name === 'next/server') return {
        NextResponse: { json: (value: unknown, init?: ResponseInit) => new Response(JSON.stringify(value), {
          ...init, headers: { 'Content-Type': 'application/json', ...Object.fromEntries(new Headers(init?.headers)) },
        }) },
      };
      if (name === '@/lib/session') return { getSession: async () => environment.session };
      if (name === '@/lib/supabase-admin') return { supabaseAdmin: environment.db };
      if (name === '@/lib/youtube') return youtube;
      if (name === '@/lib/youtube-video') return youtubeVideo;
      if (name === '@/lib/mux') return {
        hasMuxApiCredentials: () => { throw new Error('Mux credentials are out of scope'); },
        getMuxPlaybackDuration: () => { throw new Error('Mux requests are forbidden'); },
        MuxVodTypeError: class extends Error {},
      };
      throw new Error(`Unexpected route import: ${name}`);
    },
  });
  const compiled = ts.transpileModule(readFileSync(join(PROJECT, path), 'utf8'), {
    fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  new Script(compiled.outputText, { filename: path }).runInContext(context);
  return module.exports;
}

async function main() {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.YOUTUBE_API_KEY;
  const environment = new Environment();
  process.env.YOUTUBE_API_KEY = 'isolated-caption-test-key';
  globalThis.fetch = environment.fetch;
  try {
    const checkRoute = evaluateRoute('app/api/admin/youtube-video/route.ts', environment).GET;
    const addRoute = evaluateRoute('app/api/admin/mux-items/route.ts', environment).POST;
    assert(checkRoute && addRoute);
    const check = async (expected = 200) => {
      const url = new URL(`/api/admin/youtube-video?url=${encodeURIComponent(VIDEO_URL)}`, BASE);
      const request = Object.assign(new Request(url), { nextUrl: url });
      const response = await checkRoute(request);
      const result: Json = await response.json();
      assert.equal(response.status, expected, `Metadata preflight: ${JSON.stringify(result)}`);
      assert.match(response.headers.get('cache-control') || '', /no-store/);
      return result;
    };
    const add = async (expected = 201, durationSeconds = 999) => {
      const response = await addRoute(new Request(new URL('/api/admin/mux-items', BASE), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType: 'youtube_video', sourceUrl: VIDEO_URL, durationSeconds }),
      }));
      const result: Json = await response.json();
      assert.equal(response.status, expected, `Library import: ${JSON.stringify(result)}`);
      assert.match(response.headers.get('cache-control') || '', /no-store/);
      return result;
    };
    for (const session of [null, { role: 'viewer' }]) {
      environment.session = session;
      const before = environment.providerRequests;
      await check(401); await add(401);
      assert.equal(environment.providerRequests, before, 'Unauthorized requests never contact YouTube');
      assert.equal(environment.inserts.length, 0, 'Unauthorized requests never insert media');
    }
    environment.session = { role: 'admin' };
    console.log('PASS caption preflight/import remain admin-only and no-store, without provider or DB access on rejection');

    for (const caption of ['false', undefined]) {
      environment.providerVideo = environment.video({ contentDetails: {
        duration: 'PT3M1.5S', ...(caption === undefined ? {} : { caption }),
      } });
      const beforeCheck = environment.inserts.length;
      const checked = await check();
      assert.equal(checked.videoId, VIDEO_ID);
      assert.equal(checked.title, TITLE);
      assert.equal(checked.durationSeconds, DURATION);
      assert.equal(checked.metadataVerified, true);
      assert.equal(checked.captionsAvailable, null, 'An unconfirmed caption flag must not claim absence');
      assert.match(checked.warning, /auto(?:matic|-generated)/i);
      assert.match(checked.warning, /embedded|player/i);
      assert.doesNotMatch(checked.warning, /has no available captions/i);
      assert.equal(environment.inserts.length, beforeCheck, 'Check Video is strictly read-only');

      const added = await add();
      assert.equal(added.caption_status, 'unverified');
      assert.equal(added.metadata_verified, true);
      assert.equal(added.duration_source, 'youtube');
      assert.match(added.warning, /auto(?:matic|-generated)/i);
      assert.equal(added.item.label, TITLE);
      assert.equal(added.item.duration_seconds, DURATION, 'Provider duration overrides the operator estimate');
      assert.equal(added.item.playback_id, `youtube:video:${VIDEO_ID}`);
      assert.equal(added.item.source_type, 'youtube_video');
      assert.equal(added.item.source_url, VIDEO_URL);
      assert.equal(added.item.youtube_playlist_id, null);
      assert.equal(environment.inserts.length, beforeCheck + 1, 'Import inserts exactly one library item');
    }
    console.log('PASS false/omitted caption flags warn without rejecting; exact provider duration/title and canonical library identity survive');

    environment.providerVideo = environment.video();
    const confirmed = await check();
    assert.equal(confirmed.captionsAvailable, true);
    assert.equal(confirmed.warning, null);
    const confirmedImport = await add();
    assert.equal(confirmedImport.caption_status, 'available');
    assert.equal(confirmedImport.warning, null);
    console.log('PASS explicit caption:true remains a confirmed-caption success');

    const unconfirmed = { duration: 'PT3M1.5S', caption: 'false' };
    for (const [name, item, expected] of [
      ['embedding disabled', environment.video({ contentDetails: unconfirmed, status: { embeddable: false } }), /cannot be embedded/],
      ['private', environment.video({ contentDetails: unconfirmed, status: { privacyStatus: 'private' } }), /cannot be embedded/],
      ['live', environment.video({ contentDetails: unconfirmed, snippet: { liveBroadcastContent: 'live' } }), /Live or upcoming/],
      ['upcoming', environment.video({ contentDetails: unconfirmed, snippet: { liveBroadcastContent: 'upcoming' } }), /Live or upcoming/],
      ['age restricted', environment.video({ contentDetails: { ...unconfirmed, contentRating: { ytRating: 'ytAgeRestricted' } } }), /Age-restricted/],
      ['unprocessed', environment.video({ contentDetails: unconfirmed, status: { uploadStatus: 'failed' } }), /not ready/],
      ['missing duration', environment.video({ contentDetails: { caption: 'false' } }), /finite positive video duration/],
      ['zero duration', environment.video({ contentDetails: { caption: 'false', duration: 'PT0S' } }), /finite positive video duration/],
      ['unavailable', null, /unavailable or private/],
    ] as const) {
      environment.providerVideo = item;
      const before = environment.inserts.length;
      const checked = await check(400);
      const rejected = await add(400, 999);
      assert.match(checked.error, expected, name);
      assert.match(rejected.error, expected, name);
      assert.equal(environment.inserts.length, before, `${name} cannot use operator fallback`);
    }
    assert.equal(environment.rpcCalls, 0);
    assert(environment.tableAccesses.every((table) => table === 'mux_items'));
    console.log('PASS caption uncertainty never bypasses embed/privacy/live/age/readiness/duration failures or advances the show');
    console.log('All isolated caption API regressions passed. No live state or credentials used.');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = oldKey;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
