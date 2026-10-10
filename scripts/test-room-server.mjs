import assert from 'node:assert/strict';
import http from 'node:http';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRoomServer, validateShow } from '../tools/room-player/server.mjs';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), '2006-room-server-test-'));
const media = path.join(temporary, 'media');
const otherMedia = path.join(temporary, 'other-media');
const stateDir = path.join(temporary, 'state');
const staticDirectory = path.join(temporary, 'static');
const starterPath = path.join(temporary, 'starter-show.json');
let server;
let port;
let passed = 0;
const defaultSound = { id: 'life-is-a-highway', label: 'LIFE IS A HIGHWAY', file: '', startSeconds: 0, durationSeconds: 3, volume: 1 };

const starter = {
  version: 1, title: '2006 — room rehearsal', mediaDirectory: '', captions: true,
  hold: { file: '' }, cues: [
    { id: 'intro', label: 'Opening clip', kind: 'video', file: '', notes: 'Stand by.', endAction: 'hold' },
    { id: 'scene', label: 'Live scene', kind: 'live', file: '', notes: 'Wait for the performers.', endAction: 'hold' },
  ],
};

async function start() {
  server = await createRoomServer({ stateDir, staticDirectory, starterPath });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
}

async function stop() {
  if (!server?.listening) return;
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
}

function request(url, { method = 'GET', headers = {}, data } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('end', () => {
        const bytes = Buffer.concat(chunks);
        let json;
        if (response.headers['content-type']?.includes('application/json') && bytes.length) json = JSON.parse(bytes.toString('utf8'));
        resolve({ status: response.statusCode, headers: response.headers, bytes, text: bytes.toString('utf8'), json });
      });
      response.once('error', reject);
    });
    outgoing.once('error', reject);
    outgoing.end(data);
  });
}

const write = (url, body, headers = {}) => request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Room-Player': '1', ...headers }, data: JSON.stringify(body),
});

async function test(label, action) {
  await action();
  passed += 1;
  console.log(`✓ ${label}`);
}

try {
  await Promise.all([media, otherMedia, staticDirectory].map((directory) => fs.mkdir(directory)));
  await fs.mkdir(path.join(media, 'clips'));
  await Promise.all([
    fs.writeFile(starterPath, JSON.stringify(starter)),
    fs.writeFile(path.join(staticDirectory, 'index.html'), '<!doctype html><title>Local room controls</title>'),
    fs.writeFile(path.join(staticDirectory, 'output.html'), '<!doctype html><title>Audience output</title>'),
    fs.writeFile(path.join(staticDirectory, 'app.mjs'), 'export const localOnly = true;'),
    fs.writeFile(path.join(staticDirectory, 'secret.env'), 'must-not-be-served'),
    fs.writeFile(path.join(media, 'clips', 'Opening clip.mp4'), '0123456789abcdef'),
    fs.writeFile(path.join(media, 'clips', 'Opening clip.vtt'), 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n'),
    fs.writeFile(path.join(media, 'logo.png'), 'test-image'),
    fs.writeFile(path.join(media, 'logo.gif'), 'test-gif'),
    fs.writeFile(path.join(media, 'silent.webm'), 'test-webm'),
    fs.writeFile(path.join(media, 'empty.mp4'), ''),
    ...['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].map((extension) => fs.writeFile(path.join(media, `sound.${extension}`), '0123456789abcdef')),
    fs.writeFile(path.join(media, '.env'), 'secret-never-serve'),
    fs.writeFile(path.join(otherMedia, 'outside.mp4'), 'outside-selected-folder'),
  ]);
  await fs.symlink(path.join(otherMedia, 'outside.mp4'), path.join(media, 'linked.mp4'));
  await fs.symlink(path.join(otherMedia, 'outside.mp4'), path.join(media, 'linked-sound.mp3'));
  await fs.symlink(otherMedia, path.join(media, 'linked-folder'));
  await start();

  await test('starter rundown is available without a saved file', async () => {
    const result = await request('/api/show');
    assert.equal(result.status, 200);
    assert.deepEqual(result.json, { ...starter, sounds: [defaultSound] });
    assert.deepEqual(starter.sounds, undefined, 'normalization must not mutate the input manifest');
    assert.equal((await request('/api/library')).json.files.length, 0);
  });

  await test('static output has local-only security headers', async () => {
    const result = await request('/');
    assert.equal(result.status, 200);
    assert.match(result.text, /Local room controls/u);
    assert.match(result.headers['content-security-policy'], /connect-src 'self'/u);
    assert.match(result.headers['content-security-policy'], /frame-ancestors 'none'/u);
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['access-control-allow-origin'], undefined);
    assert.match((await request('/app.mjs')).headers['content-type'], /^text\/javascript/u);
    const head = await request('/output.html', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.bytes.length, 0);
  });

  await test('only allowlisted static files are served', async () => {
    for (const url of ['/secret.env', '/server.mjs', '/starter-show.json', '/%2e%2e/package.json', '/api/unknown']) {
      assert.equal((await request(url)).status, 404, url);
    }
  });

  await test('host-header attacks and cross-origin writes are rejected', async () => {
    assert.equal((await request('/api/show', { headers: { Host: `evil.example:${port}` } })).status, 403);
    assert.equal((await request('/api/show', { headers: { Host: '127.0.0.1:80' } })).status, 403);
    assert.equal((await request('/api/show', { headers: { Host: `localhost:${port}` } })).status, 200);
    assert.equal((await write('/api/show', starter, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await write('/api/show', starter, { Origin: 'null' })).status, 403);
    assert.equal((await write('/api/show', starter, { Origin: `http://127.0.0.1:${port}` })).status, 200);
    const missingHeader = await request('/api/show', { method: 'POST', headers: { 'Content-Type': 'application/json' }, data: JSON.stringify(starter) });
    assert.equal(missingHeader.status, 403);
    assert.equal((await request('/api/show', { method: 'OPTIONS' })).status, 405);
  });

  await test('media mount persists and scans only supported regular files', async () => {
    const result = await write('/api/library', { directory: media });
    assert.equal(result.status, 200);
    assert.equal(result.json.directory, await fs.realpath(media));
    const files = result.json.files;
    assert(files.some((file) => file.path === 'clips/Opening clip.mp4' && file.kind === 'video' && file.size === 16));
    assert(files.some((file) => file.path === 'clips/Opening clip.vtt' && file.kind === 'captions'));
    assert(files.some((file) => file.path === 'logo.png' && file.kind === 'image'));
    for (const extension of ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']) {
      assert(files.some((file) => file.path === `sound.${extension}` && file.kind === 'audio' && file.size === 16));
    }
    assert(!files.some((file) => file.path.includes('linked') || file.path === '.env'));
    assert(result.json.warnings.some((warning) => /Symbolic links/u.test(warning)));
    assert.equal((await request('/api/show')).json.mediaDirectory, await fs.realpath(media));
    assert.equal(JSON.parse(await fs.readFile(path.join(stateDir, 'show.json'), 'utf8')).mediaDirectory, await fs.realpath(media));
  });

  await test('rundown round trip preserves labels, live waits and multiline notes', async () => {
    const show = structuredClone(starter);
    show.mediaDirectory = await fs.realpath(media);
    show.title = 'Tonight’s basement show';
    show.hold.file = 'logo.gif';
    show.cues[0].file = 'clips/Opening clip.mp4';
    show.cues[0].notes = 'Lights down.\nThen GO.';
    show.cues[0].captionFile = 'clips/Opening clip.vtt';
    show.sounds = [{ ...defaultSound, file: 'sound.mp3', startSeconds: 1.25, durationSeconds: 2.5, volume: 0.75 }];
    const result = await write('/api/show', show);
    assert.equal(result.status, 200);
    assert.deepEqual(result.json, show);
    assert.deepEqual((await request('/api/show')).json, show);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(stateDir, 'show.json'), 'utf8')), show);
    assert.equal((await fs.readdir(stateDir)).filter((name) => name.endsWith('.tmp')).length, 0);
  });

  await test('invalid rundown schemas never overwrite the saved show', async () => {
    const before = (await request('/api/show')).json;
    const bad = [
      { ...before, version: 2 }, { ...before, title: '' }, { ...before, captions: 'yes' },
      { ...before, title: 'x'.repeat(121) }, { ...before, mediaDirectory: 'relative' },
      { ...before, cues: [...before.cues, before.cues[0]] },
      { ...before, cues: [{ ...before.cues[0], kind: 'youtube' }] },
      { ...before, cues: [{ ...before.cues[0], endAction: 'random' }] },
      { ...before, cues: [{ ...before.cues[0], id: 'bad id' }] },
      { ...before, cues: [{ ...before.cues[0], notes: 'x'.repeat(2001) }] },
      { ...before, cues: [{ ...before.cues[0], file: 'logo.png' }] },
      { ...before, cues: [{ ...before.cues[0], captionFile: 'logo.png' }] },
      { ...before, cues: [{ ...before.cues[1], captionFile: 'clips/Opening clip.vtt' }] },
      { ...before, cues: [{ ...before.cues[1], file: 'clips/Opening clip.mp4' }] },
      { ...before, hold: { file: 'captions.vtt' } }, { ...before, unknown: true },
      { ...before, cues: Array.from({ length: 301 }, (_, index) => ({ ...before.cues[1], id: `cue-${index}` })) },
    ];
    for (const body of bad) {
      const result = await write('/api/show', body);
      assert.equal(result.status, 400, JSON.stringify(body).slice(0, 100));
      assert.equal(typeof result.json.error, 'string');
    }
    assert.deepEqual((await request('/api/show')).json, before);
  });

  await test('sound pads accept local audio/video snippets and preserve optional empty pads', async () => {
    const before = (await request('/api/show')).json;
    const sounds = [
      { ...defaultSound, file: 'sound.mp3', startSeconds: 12.5, durationSeconds: 3, volume: 0.8 },
      { ...defaultSound, id: 'movie-audio', label: 'Audio from a local video', file: 'clips/Opening clip.mp4', startSeconds: 0, durationSeconds: 0.1, volume: 0 },
      { ...defaultSound, id: 'unconfigured', label: 'Empty pad', file: '', startSeconds: 0, durationSeconds: 30, volume: 1 },
    ];
    const result = await write('/api/show', { ...before, sounds });
    assert.equal(result.status, 200);
    assert.deepEqual(result.json.sounds, sounds);
    assert.deepEqual((await request('/api/show')).json.sounds, sounds);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(stateDir, 'show.json'), 'utf8')).sounds, sounds);
    const removed = await write('/api/show', { ...before, sounds: [] });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.json.sounds, [], 'an explicitly empty soundboard must stay empty');
    const full = Array.from({ length: 24 }, (_, index) => ({ ...defaultSound, id: `pad-${index}` }));
    assert.equal((await write('/api/show', { ...before, sounds: full })).status, 200);
    assert.equal((await write('/api/show', before)).status, 200);
  });

  await test('invalid sound schemas and unsafe sources cannot overwrite saved pads', async () => {
    const before = (await request('/api/show')).json;
    const invalid = [
      null, {}, 'bad', [defaultSound, defaultSound], [null], [{ ...defaultSound, id: 'bad id' }],
      [{ ...defaultSound, label: '' }], [{ ...defaultSound, label: 'x'.repeat(181) }],
      [{ ...defaultSound, file: '../sound.mp3' }], [{ ...defaultSound, file: '/absolute.mp3' }],
      [{ ...defaultSound, file: 'https://example.com/sound.mp3' }], [{ ...defaultSound, file: 'clips\\sound.mp3' }],
      [{ ...defaultSound, file: 'logo.png' }], [{ ...defaultSound, file: 'clips/Opening clip.vtt' }],
      [{ ...defaultSound, startSeconds: -1 }], [{ ...defaultSound, startSeconds: '0' }],
      [{ ...defaultSound, startSeconds: null }], [{ ...defaultSound, durationSeconds: 0.099 }],
      [{ ...defaultSound, durationSeconds: 30.001 }], [{ ...defaultSound, durationSeconds: '3' }],
      [{ ...defaultSound, volume: -0.01 }], [{ ...defaultSound, volume: 1.01 }],
      [{ ...defaultSound, volume: true }], [{ ...defaultSound, unexpected: 'field' }],
      Array.from({ length: 25 }, (_, index) => ({ ...defaultSound, id: `pad-${index}` })),
    ];
    for (const sounds of invalid) {
      const result = await write('/api/show', { ...before, sounds });
      assert.equal(result.status, 400, JSON.stringify(sounds).slice(0, 100));
      assert.equal(typeof result.json.error, 'string');
    }
    for (const field of ['startSeconds', 'durationSeconds', 'volume']) {
      for (const value of [NaN, Infinity, -Infinity]) {
        assert.throws(() => validateShow({ ...before, sounds: [{ ...defaultSound, [field]: value }] }), /Sound/u);
      }
    }
    assert.deepEqual((await request('/api/show')).json, before);
  });

  await test('audio stays on the soundboard and cannot replace video cues or holding screens', async () => {
    const before = (await request('/api/show')).json;
    for (const extension of ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac']) {
      assert.equal((await write('/api/show', { ...before, hold: { file: `sound.${extension}` } })).status, 400);
      assert.equal((await write('/api/show', { ...before, cues: [{ ...before.cues[0], file: `sound.${extension}` }] })).status, 400);
      assert.equal((await write('/api/show', { ...before, sounds: [{ ...defaultSound, file: `sound.${extension}` }] })).status, 200);
    }
    assert.equal((await write('/api/show', before)).status, 200);
  });

  await test('unsafe filenames are rejected in manifests and media requests', async () => {
    const before = (await request('/api/show')).json;
    for (const filename of ['../outside.mp4', '/absolute.mp4', 'clips/../outside.mp4', 'clips//Opening clip.mp4', 'clips\\video.mp4', './logo.png', 'file:///tmp/movie.mp4', ' bad.mp4']) {
      const invalid = { ...before, cues: [{ ...before.cues[0], file: filename }] };
      assert.equal((await write('/api/show', invalid)).status, 400, filename);
    }
    for (const url of ['/media/%2e%2e/outside.mp4', '/media/clips/%2e%2e/%2e%2e/outside.mp4', '/media/%2Ftmp%2Fmovie.mp4', '/media/clips%5Cvideo.mp4', '/media/%00.mp4', '/media/%ZZ.mp4']) {
      assert.equal((await request(url)).status, 400, url);
    }
    assert.equal((await request('/media/.env')).status, 404);
    assert.equal((await request('/media/no-such.mp4')).status, 404);
  });

  await test('symlink files and directories cannot escape the media mount', async () => {
    assert.equal((await request('/media/linked.mp4')).status, 403);
    assert.equal((await request('/media/linked-folder/outside.mp4')).status, 403);
    assert.equal((await request('/media/linked-sound.mp3')).status, 403);
    assert.equal((await request('/media/%2e%2e/sound.mp3')).status, 400);
  });

  await test('full local media responses support GET and HEAD', async () => {
    const result = await request('/media/clips/Opening%20clip.mp4');
    assert.equal(result.status, 200);
    assert.equal(result.text, '0123456789abcdef');
    assert.equal(result.headers['content-type'], 'video/mp4');
    assert.equal(result.headers['content-length'], '16');
    assert.equal(result.headers['accept-ranges'], 'bytes');
    assert.equal(result.headers['cache-control'], 'no-cache');
    const head = await request('/media/clips/Opening%20clip.mp4', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-length'], '16');
    assert.equal(head.bytes.length, 0);
    assert.match((await request('/media/clips/Opening%20clip.vtt')).headers['content-type'], /^text\/vtt/u);
    assert.equal((await request('/media/logo.gif')).headers['content-type'], 'image/gif');
  });

  await test('byte ranges include bounded, open-ended, suffix and oversized endings', async () => {
    for (const [range, body, contentRange] of [
      ['bytes=2-5', '2345', 'bytes 2-5/16'], ['bytes=12-', 'cdef', 'bytes 12-15/16'],
      ['bytes=-4', 'cdef', 'bytes 12-15/16'], ['bytes=-100', '0123456789abcdef', 'bytes 0-15/16'],
      ['bytes=14-999', 'ef', 'bytes 14-15/16'],
    ]) {
      const result = await request('/media/clips/Opening%20clip.mp4', { headers: { Range: range } });
      assert.equal(result.status, 206, range);
      assert.equal(result.text, body);
      assert.equal(result.headers['content-range'], contentRange);
      assert.equal(Number(result.headers['content-length']), body.length);
    }
    const head = await request('/media/clips/Opening%20clip.mp4', { method: 'HEAD', headers: { Range: 'bytes=2-5' } });
    assert.equal(head.status, 206);
    assert.equal(head.headers['content-length'], '4');
    assert.equal(head.bytes.length, 0);
  });

  await test('supported local audio formats have correct MIME and byte-range responses', async () => {
    for (const [extension, mime] of [
      ['mp3', 'audio/mpeg'], ['wav', 'audio/wav'], ['m4a', 'audio/mp4'],
      ['aac', 'audio/aac'], ['ogg', 'audio/ogg'], ['flac', 'audio/flac'],
    ]) {
      const full = await request(`/media/sound.${extension}`);
      assert.equal(full.status, 200);
      assert.equal(full.headers['content-type'], mime);
      assert.equal(full.text, '0123456789abcdef');
      const ranged = await request(`/media/sound.${extension}`, { headers: { Range: 'bytes=-4' } });
      assert.equal(ranged.status, 206);
      assert.equal(ranged.headers['content-type'], mime);
      assert.equal(ranged.headers['content-range'], 'bytes 12-15/16');
      assert.equal(ranged.text, 'cdef');
      const head = await request(`/media/sound.${extension}`, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.bytes.length, 0);
    }
  });

  await test('invalid or multiple ranges return 416 with the correct file length', async () => {
    for (const range of ['bytes=16-', 'bytes=9-1', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'words=0-1', 'bytes=999999999999999999999-', 'garbage']) {
      const result = await request('/media/clips/Opening%20clip.mp4', { headers: { Range: range } });
      assert.equal(result.status, 416, range);
      assert.equal(result.headers['content-range'], 'bytes */16');
      assert.equal(typeof result.json.error, 'string');
    }
    assert.equal((await request('/media/empty.mp4')).status, 200);
    assert.equal((await request('/media/empty.mp4', { headers: { Range: 'bytes=0-' } })).status, 416);
  });

  await test('unavailable and relative media folders cannot be mounted', async () => {
    for (const directory of ['relative-folder', path.join(temporary, 'missing'), path.join(media, 'logo.png')]) {
      assert.equal((await write('/api/library', { directory })).status, 400, directory);
    }
    assert.equal((await write('/api/library', { directory: media, unknown: 'no' })).status, 400);
    assert.equal((await request('/api/show')).json.mediaDirectory, await fs.realpath(media));
  });

  await test('recursive library traversal stops at a bounded folder depth', async () => {
    let nested = media;
    for (let depth = 0; depth < 10; depth += 1) {
      nested = path.join(nested, `depth-${depth}`);
      await fs.mkdir(nested);
    }
    await fs.writeFile(path.join(nested, 'too-deep.mp4'), 'test');
    const library = (await request('/api/library')).json;
    assert(!library.files.some((file) => file.path.endsWith('too-deep.mp4')));
    assert(library.warnings.some((warning) => /Deeply nested/u.test(warning)));
  });

  await test('malformed JSON, content types and oversized bodies fail safely', async () => {
    const headers = { 'Content-Type': 'application/json', 'X-Room-Player': '1' };
    assert.equal((await request('/api/show', { method: 'POST', headers, data: '{bad' })).status, 400);
    assert.equal((await request('/api/show', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Room-Player': '1' }, data: '{}' })).status, 415);
    assert.equal((await request('/api/show', { method: 'POST', headers, data: JSON.stringify({ title: 'x'.repeat(520 * 1024) }) })).status, 413);
    assert.equal((await request('/api/show', { method: 'DELETE' })).status, 405);
  });

  await test('queued writes persist complete JSON and preserve a chosen media folder', async () => {
    const before = (await request('/api/show')).json;
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => write('/api/show', { ...before, title: `Saved title ${index}` })));
    assert(results.every((result) => result.status === 200));
    const saved = JSON.parse(await fs.readFile(path.join(stateDir, 'show.json'), 'utf8'));
    assert.deepEqual(saved, (await request('/api/show')).json);
    assert.equal(saved.mediaDirectory, await fs.realpath(media));
    assert.equal((await fs.readdir(stateDir)).filter((name) => name.endsWith('.tmp')).length, 0);
  });

  await test('restart restores the saved independent rundown', async () => {
    const before = (await request('/api/show')).json;
    await stop();
    await start();
    assert.deepEqual((await request('/api/show')).json, before);
    assert.equal((await request('/media/clips/Opening%20clip.mp4')).status, 200);
  });

  await test('older saved manifests gain an unconfigured sound pad without losing their cues', async () => {
    await stop();
    const legacy = JSON.parse(await fs.readFile(path.join(stateDir, 'show.json'), 'utf8'));
    delete legacy.sounds;
    await fs.writeFile(path.join(stateDir, 'show.json'), JSON.stringify(legacy));
    await start();
    assert.deepEqual((await request('/api/show')).json, { ...legacy, sounds: [defaultSound] });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(stateDir, 'show.json'), 'utf8')), legacy,
      'opening a legacy show must not silently overwrite its existing file');
    const saved = await write('/api/show', legacy);
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json.sounds, [defaultSound]);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(stateDir, 'show.json'), 'utf8')).sounds, [defaultSound]);
  });

  await test('a disconnected media drive leaves controls usable with a clear warning', async () => {
    await stop();
    const saved = JSON.parse(await fs.readFile(path.join(stateDir, 'show.json'), 'utf8'));
    saved.mediaDirectory = path.join(temporary, 'unplugged-drive');
    await fs.writeFile(path.join(stateDir, 'show.json'), JSON.stringify(saved));
    await start();
    assert.equal((await request('/')).status, 200);
    const library = (await request('/api/library')).json;
    assert.deepEqual(library.files, []);
    assert.match(library.warnings[0], /unavailable/u);
    assert.equal((await request('/media/logo.png')).status, 404);
    assert.equal((await write('/api/library', { directory: media })).status, 200);
  });

  console.log(`\n${passed} offline room-server checks passed. No online services used.`);
} finally {
  await stop();
  // Only remove this test's exact, freshly created temporary directory.
  await fs.rm(temporary, { recursive: true, force: true });
}
