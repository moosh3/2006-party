import http from 'node:http';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const TOOL_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const STATIC_FILES = new Set(['index.html', 'output.html', 'app.mjs', 'output.mjs', 'state.mjs', 'room.css']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']);
const DEFAULT_SOUND = { id: 'life-is-a-highway', label: 'LIFE IS A HIGHWAY', file: '', startSeconds: 0, durationSeconds: 3, volume: 1 };
const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.mp4': 'video/mp4', '.m4v': 'video/mp4',
  '.mov': 'video/quicktime', '.webm': 'video/webm', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.vtt': 'text/vtt; charset=utf-8',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
};
const BODY_LIMIT = 512 * 1024;
const LIBRARY_ENTRY_LIMIT = 8000;
const LIBRARY_FILE_LIMIT = 4000;
const LIBRARY_DEPTH_LIMIT = 8;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function ownKeysOnly(object, keys, label) {
  if (!object || typeof object !== 'object' || Array.isArray(object)
      || Object.keys(object).some((key) => !keys.includes(key))) {
    throw new HttpError(400, `${label} has an invalid format.`);
  }
}

function stringValue(value, max, label, { empty = true, multiline = false } = {}) {
  const forbidden = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  if (typeof value !== 'string' || value.length > max || forbidden.test(value)
      || (!empty && !value.trim())) throw new HttpError(400, `${label} is invalid.`);
  return value;
}

function safeRelativeFile(value, label, { empty = true } = {}) {
  stringValue(value, 2048, label, { empty });
  if (!value && empty) return '';
  if (!value || value.includes('\\') || value.includes(':') || path.posix.isAbsolute(value)
      || value.split('/').some((segment) => !segment || segment === '.' || segment === '..'
        || segment.trim() !== segment)) throw new HttpError(400, `${label} must be a safe relative filename.`);
  return value;
}

function fileKind(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (extension === '.vtt') return 'captions';
  return null;
}

export function validateShow(value) {
  ownKeysOnly(value, ['version', 'title', 'mediaDirectory', 'cues', 'hold', 'captions', 'sounds'], 'Rundown');
  if (value.version !== 1) throw new HttpError(400, 'Rundown version must be 1.');
  stringValue(value.title, 120, 'Show title', { empty: false });
  stringValue(value.mediaDirectory, 4096, 'Media directory');
  if (value.mediaDirectory && !path.isAbsolute(value.mediaDirectory)) {
    throw new HttpError(400, 'Choose an absolute media directory.');
  }
  if (!Array.isArray(value.cues) || value.cues.length > 300) throw new HttpError(400, 'Rundown must have at most 300 cues.');
  if (typeof value.captions !== 'boolean') throw new HttpError(400, 'Captions must be on or off.');
  ownKeysOnly(value.hold, ['file'], 'Holding screen');
  safeRelativeFile(value.hold.file, 'Holding-screen file');
  if (value.hold.file && !['video', 'image'].includes(fileKind(value.hold.file))) {
    throw new HttpError(400, 'Holding screen must be a supported video or image.');
  }
  const ids = new Set();
  for (const cue of value.cues) {
    ownKeysOnly(cue, ['id', 'label', 'kind', 'file', 'notes', 'endAction', 'captionFile'], 'Cue');
    if (typeof cue.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/u.test(cue.id) || ids.has(cue.id)) {
      throw new HttpError(400, 'Each cue needs a unique, simple ID.');
    }
    ids.add(cue.id);
    stringValue(cue.label, 180, 'Cue label', { empty: false });
    stringValue(cue.notes, 2000, 'Cue notes', { multiline: true });
    if (!['video', 'image', 'live'].includes(cue.kind)) throw new HttpError(400, 'Cue kind is invalid.');
    if (!['hold', 'next'].includes(cue.endAction)) throw new HttpError(400, 'Cue end action is invalid.');
    safeRelativeFile(cue.file, 'Cue file');
    if (cue.kind === 'live' ? cue.file !== '' : cue.file && fileKind(cue.file) !== cue.kind) {
      throw new HttpError(400, 'Cue file does not match its kind.');
    }
    if (cue.captionFile !== undefined) {
      safeRelativeFile(cue.captionFile, 'Caption file');
      if (cue.captionFile && (cue.kind !== 'video' || fileKind(cue.captionFile) !== 'captions')) {
        throw new HttpError(400, 'Caption files must be local VTT files on video cues.');
      }
    }
  }
  const sounds = value.sounds === undefined ? [{ ...DEFAULT_SOUND }] : value.sounds;
  if (!Array.isArray(sounds) || sounds.length > 24) throw new HttpError(400, 'Soundboard must have at most 24 pads.');
  const soundIds = new Set();
  for (const sound of sounds) {
    ownKeysOnly(sound, ['id', 'label', 'file', 'startSeconds', 'durationSeconds', 'volume'], 'Sound pad');
    if (typeof sound.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/u.test(sound.id) || soundIds.has(sound.id)) {
      throw new HttpError(400, 'Each sound pad needs a unique, simple ID.');
    }
    soundIds.add(sound.id);
    stringValue(sound.label, 180, 'Sound label', { empty: false });
    safeRelativeFile(sound.file, 'Sound file');
    if (sound.file && !['audio', 'video'].includes(fileKind(sound.file))) {
      throw new HttpError(400, 'Sound pads must use supported local audio or video files.');
    }
    if (typeof sound.startSeconds !== 'number' || !Number.isFinite(sound.startSeconds) || sound.startSeconds < 0) {
      throw new HttpError(400, 'Sound start must be a finite number of seconds at or above zero.');
    }
    if (typeof sound.durationSeconds !== 'number' || !Number.isFinite(sound.durationSeconds)
        || sound.durationSeconds < 0.1 || sound.durationSeconds > 30) {
      throw new HttpError(400, 'Sound duration must be between 0.1 and 30 seconds.');
    }
    if (typeof sound.volume !== 'number' || !Number.isFinite(sound.volume) || sound.volume < 0 || sound.volume > 1) {
      throw new HttpError(400, 'Sound volume must be between zero and one.');
    }
  }
  // Rebuild from JSON data, excluding inherited properties and retaining no caller-owned objects.
  return JSON.parse(JSON.stringify({ ...value, sounds }));
}

async function canonicalMediaDirectory(directory) {
  if (!directory) return '';
  if (!path.isAbsolute(directory)) throw new HttpError(400, 'Choose an absolute media directory.');
  try {
    const real = await fs.realpath(directory);
    if (!(await fs.stat(real)).isDirectory()) throw new Error('not a directory');
    return real;
  } catch {
    throw new HttpError(400, 'That media folder is unavailable. Choose an existing local folder.');
  }
}

async function persistShow(stateDirectory, show) {
  await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const temporary = path.join(stateDirectory, `show-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(show, null, 2)}\n`);
      await handle.sync();
    } finally { await handle.close(); }
    await fs.rename(temporary, path.join(stateDirectory, 'show.json'));
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

async function scanLibrary(directory) {
  if (!directory) return { directory: '', files: [], warnings: ['Choose a local media folder first.'] };
  const files = [];
  const warnings = new Set();
  let entries = 0;
  let capped = false;
  async function visit(current, prefix, depth) {
    if (capped) return;
    let handle;
    try { handle = await fs.opendir(current); }
    catch { warnings.add('Some media folders could not be read.'); return; }
    for await (const entry of handle) {
      entries += 1;
      if (entries > LIBRARY_ENTRY_LIMIT || files.length >= LIBRARY_FILE_LIMIT) {
        warnings.add('Library scan limit reached. Use a smaller show-media folder.');
        capped = true;
        break;
      }
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) { warnings.add('Symbolic links are excluded from the media library.'); continue; }
      try { safeRelativeFile(relative, 'Media filename', { empty: false }); }
      catch { warnings.add('Some filenames are unsupported; rename them before use.'); continue; }
      if (entry.isDirectory()) {
        if (depth >= LIBRARY_DEPTH_LIMIT) warnings.add('Deeply nested media folders were skipped.');
        else await visit(path.join(current, entry.name), relative, depth + 1);
      } else if (entry.isFile()) {
        const kind = fileKind(relative);
        if (!kind) continue;
        try {
          const stat = await fs.lstat(path.join(current, entry.name));
          if (stat.isFile()) files.push({ path: relative, kind, size: stat.size });
        } catch { warnings.add('Some media files could not be read.'); }
      }
    }
  }
  await visit(directory, '', 0);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { directory, files, warnings: [...warnings] };
}

function setHeaders(response) {
  response.setHeader('Content-Security-Policy', CSP);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  response.end(body);
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers['content-type'] || '')) {
    throw new HttpError(415, 'Send JSON data.');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > BODY_LIMIT) throw new HttpError(413, 'Rundown is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'JSON data is invalid.'); }
}

function guardLocalRequest(request, server) {
  const port = server.address()?.port;
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowedHosts.has(request.headers.host?.toLowerCase())) throw new HttpError(403, 'Use this player on localhost only.');
  if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(request.socket.remoteAddress)) {
    throw new HttpError(403, 'Local connections only.');
  }
  if (request.method === 'POST') {
    if (request.headers['x-room-player'] !== '1') throw new HttpError(403, 'Local player request header is required.');
    const origin = request.headers.origin;
    if (origin !== undefined && !new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]).has(origin)) {
      throw new HttpError(403, 'Cross-origin changes are not allowed.');
    }
  }
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) throw new HttpError(416, 'Requested media range is unavailable.');
  const first = match[1] === '' ? null : Number(match[1]);
  const last = match[2] === '' ? null : Number(match[2]);
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) {
    throw new HttpError(416, 'Requested media range is unavailable.');
  }
  if (first === null) {
    if (!last || last < 0) throw new HttpError(416, 'Requested media range is unavailable.');
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== null && last < first)) throw new HttpError(416, 'Requested media range is unavailable.');
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}

async function openMedia(root, relative) {
  if (!root) throw new HttpError(404, 'Choose a media folder first.');
  safeRelativeFile(relative, 'Media filename', { empty: false });
  if (!fileKind(relative)) throw new HttpError(404, 'Media file is not supported.');
  let candidate = root;
  try {
    for (const segment of relative.split('/')) {
      candidate = path.join(candidate, segment);
      if ((await fs.lstat(candidate)).isSymbolicLink()) throw new HttpError(403, 'Symbolic links cannot be served.');
    }
    const resolved = await fs.realpath(candidate);
    const withinRoot = path.relative(root, resolved);
    if (!withinRoot || withinRoot.startsWith(`..${path.sep}`) || withinRoot === '..' || path.isAbsolute(withinRoot)) {
      throw new HttpError(403, 'Media file is outside the selected folder.');
    }
    const before = await fs.lstat(resolved);
    const handle = await fs.open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new HttpError(404, 'Media file was not found.');
      // Also check after opening: reject a file/folder swapped while the request was resolving.
      if (stat.dev !== before.dev || stat.ino !== before.ino || await fs.realpath(candidate) !== resolved) {
        throw new HttpError(403, 'Media changed while opening. Try again.');
      }
      let current = root;
      for (const segment of relative.split('/')) {
        current = path.join(current, segment);
        if ((await fs.lstat(current)).isSymbolicLink()) throw new HttpError(403, 'Symbolic links cannot be served.');
      }
      return { handle, stat };
    } catch (error) {
      await handle.close();
      throw error;
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(404, 'Media file was not found.');
  }
}

async function serveFile(request, response, handle, stat, filename, media = false) {
  let range;
  try { range = media ? parseRange(request.headers.range, stat.size) : null; }
  catch (error) {
    await handle.close();
    response.setHeader('Content-Range', `bytes */${stat.size}`);
    throw error;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? stat.size - 1;
  response.setHeader('Content-Type', MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream');
  response.setHeader('Content-Length', Math.max(0, end - start + 1));
  if (media) {
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Cache-Control', 'no-cache');
  }
  if (range) response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  response.writeHead(range ? 206 : 200);
  if (request.method === 'HEAD' || stat.size === 0) { await handle.close(); response.end(); return; }
  const stream = handle.createReadStream({ start, end });
  stream.once('error', () => response.destroy());
  response.once('close', () => stream.destroy());
  stream.pipe(response);
}

/** Creates an unbound, dependency-free server. Call listen(port, '127.0.0.1') to start it. */
export async function createRoomServer(options = {}) {
  const staticDirectory = path.resolve(options.staticDirectory || TOOL_DIRECTORY);
  const stateDirectory = path.resolve(options.stateDir || path.join(TOOL_DIRECTORY, '..', '..', '.room-player'));
  let initial;
  try { initial = JSON.parse(await fs.readFile(path.join(stateDirectory, 'show.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Saved room rundown could not be read. Keep a backup before repairing show.json.');
    initial = JSON.parse(await fs.readFile(options.starterPath || path.join(TOOL_DIRECTORY, 'starter-show.json'), 'utf8'));
  }
  let show = validateShow(initial);
  if (options.mediaDirectory !== undefined) show.mediaDirectory = options.mediaDirectory;
  // A disconnected drive must not prevent opening controls to choose a replacement folder.
  let mountedDirectory = '';
  let unavailableDirectory = false;
  if (show.mediaDirectory) {
    try { mountedDirectory = await canonicalMediaDirectory(show.mediaDirectory); show.mediaDirectory = mountedDirectory; }
    catch { unavailableDirectory = true; }
  }
  let writes = Promise.resolve();
  const mutate = (action) => {
    const pending = writes.then(action);
    writes = pending.catch(() => {});
    return pending;
  };
  const server = http.createServer(async (request, response) => {
    setHeaders(response);
    try {
      guardLocalRequest(request, server);
      const rawPath = (request.url || '/').split('?')[0];
      if (rawPath === '/api/show' && request.method === 'GET') { json(response, 200, show); return; }
      if (rawPath === '/api/show' && request.method === 'POST') {
        const next = validateShow(await readJson(request));
        const saved = await mutate(async () => {
          const mounted = await canonicalMediaDirectory(next.mediaDirectory);
          next.mediaDirectory = mounted;
          await persistShow(stateDirectory, next);
          show = next;
          mountedDirectory = mounted;
          unavailableDirectory = false;
          return show;
        });
        json(response, 200, saved);
        return;
      }
      if (rawPath === '/api/library' && request.method === 'POST') {
        const body = await readJson(request);
        ownKeysOnly(body, ['directory'], 'Media folder');
        stringValue(body.directory, 4096, 'Media directory', { empty: false });
        const mounted = await canonicalMediaDirectory(body.directory);
        await mutate(async () => {
          const next = { ...show, mediaDirectory: mounted };
          await persistShow(stateDirectory, next);
          show = next;
          mountedDirectory = mounted;
          unavailableDirectory = false;
        });
        json(response, 200, await scanLibrary(mounted));
        return;
      }
      if (rawPath === '/api/library' && request.method === 'GET') {
        if (unavailableDirectory) {
          json(response, 200, { directory: show.mediaDirectory, files: [], warnings: ['The saved media folder is unavailable. Reconnect the drive or choose another folder.'] });
        } else json(response, 200, await scanLibrary(mountedDirectory));
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'Method is not allowed.');
      if (rawPath.startsWith('/media/')) {
        let relative;
        try { relative = decodeURIComponent(rawPath.slice('/media/'.length)); }
        catch { throw new HttpError(400, 'Media filename is invalid.'); }
        const { handle, stat } = await openMedia(mountedDirectory, relative);
        await serveFile(request, response, handle, stat, relative, true);
        return;
      }
      const filename = rawPath === '/' ? 'index.html' : rawPath.slice(1);
      if (!STATIC_FILES.has(filename)) throw new HttpError(404, 'Page was not found.');
      let handle;
      try { handle = await fs.open(path.join(staticDirectory, filename), 'r'); }
      catch { throw new HttpError(404, 'Page was not found.'); }
      const stat = await handle.stat();
      await serveFile(request, response, handle, stat, filename);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      json(response, error instanceof HttpError ? error.status : 500,
        { error: error instanceof HttpError ? error.message : 'The local player could not complete that request.' });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}

function parseArguments(arguments_) {
  const result = { port: 2007 };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (!['--port', '--state-dir', '--media'].includes(argument) || !arguments_[index + 1]) {
      throw new Error('Use --port, --state-dir, or --media followed by a value.');
    }
    const value = arguments_[++index];
    if (argument === '--port') {
      result.port = Number(value);
      if (!Number.isInteger(result.port) || result.port < 1 || result.port > 65535) throw new Error('Port must be between 1 and 65535.');
    } else if (argument === '--state-dir') result.stateDir = path.resolve(value);
    else {
      if (!path.isAbsolute(value)) throw new Error('--media must be an absolute local folder path.');
      result.mediaDirectory = value;
    }
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log('Offline room player\nnode tools/room-player/server.mjs [--port 2007] [--media /absolute/folder] [--state-dir /absolute/folder]');
    } else {
      const server = await createRoomServer(options);
      server.once('error', (error) => {
        console.error(error.code === 'EADDRINUSE' ? 'That port is already in use. Choose another with --port.' : 'The local room player could not start.');
        process.exitCode = 1;
      });
      server.listen(options.port, '127.0.0.1', () => {
        console.log(`Offline room controls: http://127.0.0.1:${options.port}\nAudience output: http://127.0.0.1:${options.port}/output.html\nIndependent of the online show. No internet or cloud credentials used.\nPress Control-C to stop.`);
      });
      const stop = () => {
        server.close(() => { process.exitCode = 0; });
        server.closeAllConnections();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    }
  } catch (error) {
    console.error(error instanceof HttpError ? error.message : `Cannot start the offline room player: ${error.message}`);
    process.exitCode = 1;
  }
}
