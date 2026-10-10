import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../tools/room-player/output.mjs', import.meta.url), 'utf8');
let checks = 0;

function check(label, run) {
  return Promise.resolve().then(run).then(() => {
    checks += 1;
    process.stdout.write(`PASS ${label}\n`);
  });
}

async function flush() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function fixture() {
  const messages = [];
  const timers = new Map();
  let timerId = 0;
  class Element extends EventTarget {
    constructor(id = '') {
      super();
      this.id = id;
      this.hidden = false;
      this.textContent = '';
      this.attributes = new Map();
      this.children = [];
      this.classList = { toggle() {} };
    }
    removeAttribute(name) {
      this.attributes.delete(name);
      if (name === 'src') this._src = '';
    }
    append(child) {
      this.children.push(child);
      if (this.textTracks) this.textTracks.push({ mode: child.default ? 'showing' : 'disabled' });
    }
    replaceChildren() {
      this.children = [];
      if (this.textTracks) this.textTracks = [];
    }
  }
  class Media extends Element {
    constructor(id) {
      super(id);
      this._src = '';
      this._currentTime = 0;
      this.readyState = 0;
      this.duration = 60;
      this.paused = true;
      this.ended = false;
      this.error = null;
      this.textTracks = [];
      this.muted = false;
      this.loop = false;
      this.playCalls = 0;
      this.loadCalls = 0;
      this.autoReady = true;
      this.nextPlay = null;
      this.nextLoadError = false;
      this.autoSeek = true;
      this.ignoreSeek = false;
      this.holdSeek = false;
      this.throwNextSeek = false;
      this.seeking = false;
      this.playLog = [];
    }
    get src() { return this._src; }
    set src(value) { this._src = value; }
    get currentTime() { return this._currentTime; }
    set currentTime(value) {
      if (this.throwNextSeek) { this.throwNextSeek = false; throw new Error('Invalid seek'); }
      if (this.ignoreSeek) return;
      this._currentTime = value;
      if (!this.autoSeek) { this.seeking = false; return; }
      this.seeking = true;
      if (this.holdSeek) return;
      const expected = this._src;
      queueMicrotask(() => {
        if (this._src !== expected) return;
        this.seeking = false;
        this.dispatchEvent(new Event('seeked'));
      });
    }
    load() {
      this.loadCalls += 1;
      this.readyState = 0;
      this._currentTime = 0;
      this.seeking = false;
      this.ended = false;
      this.error = null;
      if (!this._src || !this.autoReady) return;
      const expected = this._src;
      const failed = this.nextLoadError;
      this.nextLoadError = false;
      queueMicrotask(() => {
        if (this._src !== expected) return;
        if (failed) {
          this.error = { code: 4 };
          this.dispatchEvent(new Event('error'));
        } else {
          this.readyState = 2;
          this.dispatchEvent(new Event('loadeddata'));
        }
      });
    }
    play() {
      this.playCalls += 1;
      this.playLog.push({ currentTime: this.currentTime, muted: this.muted, volume: this.volume });
      const next = this.nextPlay;
      this.nextPlay = null;
      if (next) return next;
      this.paused = false;
      return Promise.resolve();
    }
    pause() { this.paused = true; }
  }
  class Image extends Element {
    constructor(id) {
      super(id);
      this._src = '';
      this.complete = false;
      this.naturalWidth = 0;
      this.autoReady = true;
      this.nextLoadError = false;
    }
    get src() { return this._src; }
    set src(value) {
      this._src = value;
      this.complete = false;
      this.naturalWidth = 0;
      if (!this.autoReady) return;
      const failed = this.nextLoadError;
      this.nextLoadError = false;
      queueMicrotask(() => {
        if (this._src !== value) return;
        this.complete = true;
        this.naturalWidth = failed ? 0 : 800;
        this.dispatchEvent(new Event(failed ? 'error' : 'load'));
      });
    }
  }
  const ids = ['cue-video', 'cue-image', 'hold-video', 'hold-image', 'hold-layer', 'cue-layer', 'black-layer', 'holding-fallback', 'output-setup', 'arm-output', 'setup-message', 'sound-audio'];
  const elements = Object.fromEntries(ids.map((id) => [id, id.endsWith('video') || id.endsWith('audio') ? new Media(id) : id.endsWith('image') ? new Image(id) : new Element(id)]));
  for (const id of ['cue-video', 'cue-image', 'hold-video', 'hold-image', 'hold-layer', 'cue-layer']) elements[id].hidden = true;
  const document = new EventTarget();
  Object.assign(document, {
    visibilityState: 'visible',
    fullscreenElement: null,
    getElementById: (id) => elements[id],
    createElement: () => new Element(),
    fullscreenCalls: 0,
  });
  document.documentElement = {
    requestFullscreen() {
      document.fullscreenCalls += 1;
      document.fullscreenElement = document.documentElement;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    },
  };
  const window = new EventTarget();
  window.closeCalls = 0;
  window.close = () => { window.closeCalls += 1; };
  let channel;
  class Channel extends EventTarget {
    constructor(name) { super(); this.name = name; this.closed = false; channel = this; }
    postMessage(value) { messages.push(value); }
    close() { this.closed = true; }
  }
  const context = vm.createContext({
    document,
    window,
    location: { origin: 'http://127.0.0.1:2006' },
    crypto: { randomUUID: () => 'output-one' },
    BroadcastChannel: Channel,
    URL,
    AbortController,
    DOMException,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay, interval: false }); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn) => { const id = ++timerId; timers.set(id, { fn, interval: true }); return id; },
    clearInterval: (id) => timers.delete(id),
  });
  vm.runInContext(source, context, { filename: 'output.mjs' });
  return {
    elements,
    document,
    window,
    channel,
    messages,
    state: () => vm.runInContext('snapshot()', context),
    command(action, revision = 1, values = {}) {
      const event = new Event('message');
      event.data = { type: 'command', targetOutputId: 'output-one', action, revision, runId: `run-${revision}`, ...values };
      channel.dispatchEvent(event);
    },
    soundCommand(action, revision = 1, values = {}) {
      const event = new Event('message');
      event.data = {
        type: 'sound-command',
        targetOutputId: 'output-one',
        action,
        soundRevision: revision,
        soundRunId: `00000000-0000-4000-8000-${String(revision).padStart(12, '0')}`,
        ...values,
      };
      channel.dispatchEvent(event);
    },
    arm() { elements['arm-output'].dispatchEvent(new Event('click')); },
    expire(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.interval || (delay !== undefined && timer.delay !== delay)) continue;
        timers.delete(id);
        timer.fn();
      }
    },
    timeouts() { return [...timers.values()].filter((timer) => !timer.interval); },
    events(type) { return messages.filter((message) => message.type === type); },
  };
}

const videoCue = (file = 'A video #1.mp4') => ({ id: 'cue-one', label: 'Local video', kind: 'video', file });
const soundCue = (changes = {}) => ({ id: 'sound-one', label: 'Local sound', file: 'sound.mp3', startSeconds: 5, durationSeconds: 2, volume: 0.6, ...changes });

await check('initial output advertises itself without autoplay', () => {
  const room = fixture();
  assert.equal(room.events('hello').length, 1);
  assert.equal(room.state().armed, false);
  assert.equal(room.state().statusstate, 'idle');
  assert.equal(room.elements['cue-video'].playCalls, 0);
});

await check('commands target exactly one output', () => {
  const room = fixture();
  room.command('play', 1, { targetOutputId: 'some-other-output', cue: videoCue() });
  assert.equal(room.state().revision, -1);
  assert.equal(room.events('error').length, 0);
});

await check('unarmed play returns a readable operator error and holding screen', async () => {
  const room = fixture();
  room.command('play', 1, { cue: videoCue() });
  await flush();
  assert.equal(room.elements['cue-video'].playCalls, 0);
  assert.equal(room.state().statusstate, 'holding');
  assert.equal(room.events('error')[0].runId, 'run-1');
  assert.equal(room.events('error')[0].revision, 1);
});

await check('arming requests fullscreen and removes audience controls', async () => {
  const room = fixture();
  room.arm();
  await flush();
  assert.equal(room.document.fullscreenCalls, 1);
  assert.equal(room.state().armed, true);
  assert.equal(room.elements['output-setup'].hidden, true);
  assert.equal(room.elements['holding-fallback'].hidden, false);
});

await check('local video starts with safely encoded filenames and default captions', async () => {
  const room = fixture();
  room.arm();
  room.command('play', 1, { cue: { ...videoCue(), captionFile: 'A video #1.vtt' } });
  await flush();
  assert.equal(room.state().statusstate, 'playing');
  assert.equal(room.elements['cue-video'].src, 'http://127.0.0.1:2006/media/A%20video%20%231.mp4');
  assert.equal(room.elements['cue-video'].textTracks[0].mode, 'showing');
  assert.equal(room.events('started').length, 1);
  assert.equal(room.events('started')[0].outputId, 'output-one');
  assert.equal(room.events('started')[0].runId, 'run-1');
  assert.equal(room.events('started')[0].revision, 1);
});

await check('duplicate and stale cue commands cannot restart playback', async () => {
  const room = fixture();
  room.arm();
  room.command('play', 2, { cue: videoCue() });
  await flush();
  const loadCalls = room.elements['cue-video'].loadCalls;
  room.command('play', 2, { cue: videoCue() });
  room.command('black', 1);
  await flush();
  assert.equal(room.elements['cue-video'].loadCalls, loadCalls);
  assert.equal(room.elements['cue-video'].playCalls, 1);
  assert.equal(room.state().statusstate, 'playing');
});

await check('video end locally holds without an operator and reports only once', async () => {
  const room = fixture();
  room.arm();
  room.command('play', 1, { cue: videoCue() });
  await flush();
  room.elements['cue-video'].ended = true;
  room.elements['cue-video'].dispatchEvent(new Event('ended'));
  room.elements['cue-video'].dispatchEvent(new Event('ended'));
  await flush();
  assert.equal(room.state().statusstate, 'holding');
  assert.equal(room.elements['hold-layer'].hidden, false);
  assert.equal(room.elements['cue-layer'].hidden, true);
  assert.equal(room.events('ended').length, 1);
  assert.equal(room.events('ended')[0].runId, 'run-1');
  assert.equal(room.events('ended')[0].revision, 1);
});

await check('old queued ended event cannot terminate a fresh cue', async () => {
  const room = fixture();
  room.arm();
  room.command('play', 1, { cue: videoCue() });
  await flush();
  room.command('play', 2, { cue: videoCue('Second.mp4') });
  room.elements['cue-video'].dispatchEvent(new Event('ended'));
  await flush();
  assert.equal(room.state().statusstate, 'playing');
  assert.equal(room.events('ended').length, 0);
});

await check('image waits for successful load and stays until manual GO', async () => {
  const room = fixture();
  room.arm();
  room.command('play', 1, { cue: { id: 'still', label: 'Title card', kind: 'image', file: 'title.png' } });
  assert.equal(room.events('started').length, 0);
  await flush();
  assert.equal(room.state().statusstate, 'playing');
  assert.equal(room.elements['cue-image'].hidden, false);
  assert.equal(room.events('ended').length, 0);
});

await check('live cue shows hold and does not invent a duration', async () => {
  const room = fixture();
  room.arm();
  room.command('play', 1, { cue: { id: 'live', label: 'Live scene', kind: 'live', file: null } });
  await flush();
  assert.equal(room.state().statusstate, 'live');
  assert.equal(room.events('started').length, 1);
  assert.equal(room.elements['cue-video'].playCalls, 0);
  assert.equal(room.state().duration, 0);
});

for (const file of ['https://example.com/video.mp4', '../video.mp4', '/video.mp4', 'folder\\video.mp4']) {
  await check(`reject nonlocal or unsafe path: ${file}`, async () => {
    const room = fixture();
    room.arm();
    room.command('play', 1, { cue: videoCue(file) });
    await flush();
    assert.equal(room.events('error').length, 1);
    assert.equal(room.elements['cue-video'].playCalls, 0);
    assert.equal(room.elements['output-setup'].hidden, true);
    assert.equal(room.state().statusstate, 'holding');
  });
}

await check('holding video loops muted and does not emit cue-ended events', async () => {
  const room = fixture();
  room.command('configure', 0, { hold: { file: 'hold.mp4' } });
  room.arm();
  await flush();
  assert.equal(room.elements['hold-video'].loop, true);
  assert.equal(room.elements['hold-video'].muted, true);
  assert.equal(room.elements['hold-video'].hidden, false);
  room.elements['hold-video'].dispatchEvent(new Event('ended'));
  assert.equal(room.events('ended').length, 0);
});

await check('broken holding video safely uses the default card without a cue error', async () => {
  const room = fixture();
  room.command('configure', 0, { hold: { file: 'broken.mp4' } });
  room.elements['hold-video'].nextLoadError = true;
  room.arm();
  await flush();
  assert.equal(room.elements['holding-fallback'].hidden, false);
  assert.equal(room.elements['hold-video'].hidden, true);
  assert.equal(room.events('hold-error').length, 1);
  assert.equal(room.events('error').length, 0);
});

await check('settings update captions without resetting the current cue', async () => {
  const room = fixture();
  room.arm();
  room.command('play', 1, { cue: { ...videoCue(), captionFile: 'video.vtt' } });
  await flush();
  const calls = room.elements['cue-video'].loadCalls;
  room.command('configure', 1, { captions: false, hold: { file: 'new-hold.gif' } });
  await flush();
  assert.equal(room.elements['cue-video'].loadCalls, calls);
  assert.equal(room.elements['cue-video'].textTracks[0].mode, 'disabled');
  assert.equal(room.state().runId, 'run-1');
  assert.equal(room.state().statusstate, 'playing');
});

await check('pause and resume adopt fresh command IDs for subsequent events', async () => {
  const room = fixture();
  room.arm();
  room.command('play', 1, { cue: videoCue() });
  await flush();
  room.command('pause', 2);
  assert.equal(room.state().statusstate, 'paused');
  assert.equal(room.elements['cue-video'].paused, true);
  room.command('resume', 3);
  await flush();
  assert.equal(room.state().statusstate, 'playing');
  room.elements['cue-video'].ended = true;
  room.elements['cue-video'].dispatchEvent(new Event('ended'));
  assert.equal(room.events('ended')[0].runId, 'run-3');
  assert.equal(room.events('ended')[0].revision, 3);
});

await check('pause during loading cannot be undone by delayed readiness', async () => {
  const room = fixture();
  room.arm();
  room.elements['cue-video'].autoReady = false;
  room.command('play', 1, { cue: videoCue() });
  room.command('pause', 2);
  room.elements['cue-video'].readyState = 2;
  room.elements['cue-video'].dispatchEvent(new Event('loadeddata'));
  await flush();
  assert.equal(room.state().statusstate, 'paused');
  assert.equal(room.elements['cue-video'].playCalls, 0);
  room.command('resume', 3);
  await flush();
  assert.equal(room.state().statusstate, 'playing');
});

await check('late old play promise cannot restore a blacked-out cue', async () => {
  const room = fixture();
  room.arm();
  let resolvePlay;
  room.elements['cue-video'].nextPlay = new Promise((resolve) => { resolvePlay = resolve; });
  room.command('play', 1, { cue: videoCue() });
  await flush();
  room.command('black', 2);
  resolvePlay();
  await flush();
  assert.equal(room.state().statusstate, 'black');
  assert.equal(room.elements['black-layer'].hidden, false);
  assert.equal(room.elements['cue-layer'].hidden, true);
  assert.equal(room.events('started').length, 0);
});

await check('blocked sound playback reports an error and never silently advances', async () => {
  const room = fixture();
  room.arm();
  room.elements['cue-video'].nextPlay = Promise.reject(new DOMException('Sound permission is required', 'NotAllowedError'));
  room.command('play', 1, { cue: videoCue() });
  await flush();
  assert.equal(room.state().statusstate, 'holding');
  assert.equal(room.events('error').length, 1);
  assert.match(room.events('error')[0].error, /permission/);
  assert.equal(room.events('started').length, 0);
  assert.equal(room.events('ended').length, 0);
});

await check('stalled play promise has a bounded operator-visible failure', async () => {
  const room = fixture();
  room.arm();
  room.elements['cue-video'].nextPlay = new Promise(() => {});
  room.command('play', 1, { cue: videoCue() });
  await flush();
  room.expire();
  await flush();
  assert.equal(room.state().statusstate, 'holding');
  assert.match(room.events('error')[0].error, /did not start/);
});

await check('failed image returns to hold without flashing an audience error', async () => {
  const room = fixture();
  room.arm();
  room.elements['cue-image'].nextLoadError = true;
  room.command('play', 1, { cue: { id: 'bad', label: 'Bad card', kind: 'image', file: 'bad.png' } });
  await flush();
  assert.equal(room.state().statusstate, 'holding');
  assert.equal(room.events('error').length, 1);
  assert.equal(room.elements['output-setup'].hidden, true);
});

await check('stalled image loading times out instead of hanging the cue', async () => {
  const room = fixture();
  room.arm();
  room.elements['cue-image'].autoReady = false;
  room.command('play', 1, { cue: { id: 'bad', label: 'Missing card', kind: 'image', file: 'missing.png' } });
  room.expire();
  await flush();
  assert.equal(room.state().statusstate, 'holding');
  assert.match(room.events('error')[0].error, /did not load/);
});

await check('decode failure during playback safely returns to hold', async () => {
  const room = fixture();
  room.arm();
  room.command('play', 1, { cue: videoCue() });
  await flush();
  room.elements['cue-video'].error = { code: 3 };
  room.elements['cue-video'].dispatchEvent(new Event('error'));
  await flush();
  assert.equal(room.state().statusstate, 'holding');
  assert.equal(room.events('error').length, 1);
  assert.equal(room.elements['cue-video'].paused, true);
});

await check('leaving fullscreen exposes setup and returning does not restart video', async () => {
  const room = fixture();
  room.arm();
  room.command('play', 1, { cue: videoCue() });
  await flush();
  const calls = room.elements['cue-video'].loadCalls;
  room.document.fullscreenElement = null;
  room.document.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(room.elements['output-setup'].hidden, false);
  assert.equal(room.elements['arm-output'].textContent, 'Return to fullscreen');
  room.arm();
  await flush();
  assert.equal(room.elements['output-setup'].hidden, true);
  assert.equal(room.state().statusstate, 'playing');
  assert.equal(room.elements['cue-video'].loadCalls, calls);
});

await check('output close disposes callbacks and ignores delayed playback', async () => {
  const room = fixture();
  room.arm();
  let resolvePlay;
  room.elements['cue-video'].nextPlay = new Promise((resolve) => { resolvePlay = resolve; });
  room.command('play', 1, { cue: videoCue() });
  await flush();
  room.window.dispatchEvent(new Event('pagehide'));
  const messages = room.messages.length;
  resolvePlay();
  await flush();
  room.command('play', 2, { cue: videoCue() });
  assert.equal(room.messages.length, messages);
  assert.equal(room.channel.closed, true);
  assert.equal(room.events('closed').length, 1);
});

await check('explicit close requires a targeted fresh command and leaves a silent black view', async () => {
  const room = fixture();
  room.arm();
  room.command('play', 2, { cue: videoCue() });
  await flush();
  room.command('close', 3, { targetOutputId: 'some-other-output' });
  room.command('close', 2);
  assert.equal(room.window.closeCalls, 0);
  assert.equal(room.state().statusstate, 'playing');
  room.command('close', 3);
  assert.equal(room.window.closeCalls, 1);
  assert.equal(room.state().statusstate, 'black');
  assert.equal(room.elements['cue-video'].paused, true);
  assert.equal(room.elements['hold-video'].paused, true);
  assert.equal(room.elements['black-layer'].hidden, false);
  assert.equal(room.channel.closed, true);
  assert.equal(room.events('closed').length, 1);
  assert.equal(room.events('closed')[0].revision, 3);
  const messages = room.messages.length;
  room.command('play', 4, { cue: videoCue() });
  assert.equal(room.messages.length, messages);
});

await check('initial sound state is idle and independent of the cue clock', () => {
  const room = fixture();
  assert.equal(room.state().soundState.status, 'idle');
  assert.equal(room.state().soundState.revision, -1);
  assert.equal(room.state().soundState.runId, null);
  assert.equal(room.elements['sound-audio'].playCalls, 0);
});

await check('unarmed sound reports its own error without changing the cue', async () => {
  const room = fixture();
  room.soundCommand('play', 1, { sound: soundCue() });
  await flush();
  assert.equal(room.state().statusstate, 'idle');
  assert.equal(room.state().revision, -1);
  assert.equal(room.state().soundState.status, 'error');
  assert.equal(room.events('sound-error').length, 1);
  assert.equal(room.events('error').length, 0);
  assert.equal(room.elements['sound-audio'].playCalls, 0);
});

await check('sound validates and seeks before audible play with independent tokens', async () => {
  const room = fixture();
  room.arm();
  room.soundCommand('play', 4, { sound: soundCue({ file: 'Sound #1.m4a' }) });
  await flush();
  const audio = room.elements['sound-audio'];
  assert.equal(audio.src, 'http://127.0.0.1:2006/media/Sound%20%231.m4a');
  assert.equal(audio.currentTime, 5);
  assert.equal(audio.playLog[0].currentTime, 5);
  assert.equal(audio.playLog[0].muted, false);
  assert.equal(audio.playLog[0].volume, 0.6);
  assert.equal(room.state().soundState.status, 'playing');
  assert.equal(room.state().soundState.revision, 4);
  assert.equal(room.state().revision, -1);
  assert.equal(room.events('sound-started')[0].soundRevision, 4);
  assert.equal(room.events('sound-started')[0].soundId, 'sound-one');
  assert.equal(room.events('sound-started')[0].soundRunId, '00000000-0000-4000-8000-000000000004');
});

await check('sound trim timer stops at the requested duration and reports only once', async () => {
  const room = fixture();
  room.arm();
  room.soundCommand('play', 1, { sound: soundCue() });
  await flush();
  const trim = room.timeouts().find((timer) => timer.delay === 2000);
  assert.ok(trim);
  trim.fn();
  trim.fn();
  room.elements['sound-audio'].ended = true;
  room.elements['sound-audio'].dispatchEvent(new Event('ended'));
  assert.equal(room.elements['sound-audio'].paused, true);
  assert.equal(room.elements['sound-audio'].muted, true);
  assert.equal(room.state().soundState.status, 'ended');
  assert.equal(room.events('sound-ended').length, 1);
});

await check('sound timeupdate independently cuts off the requested excerpt', async () => {
  const room = fixture();
  room.arm();
  room.soundCommand('play', 1, { sound: soundCue() });
  await flush();
  room.elements['sound-audio'].currentTime = 7;
  room.elements['sound-audio'].dispatchEvent(new Event('timeupdate'));
  assert.equal(room.state().soundState.status, 'ended');
  assert.equal(room.state().soundState.currentTime, 7);
  assert.equal(room.events('sound-ended').length, 1);
});

await check('local video files can supply an audio-only sound excerpt', async () => {
  const room = fixture();
  room.arm();
  room.soundCommand('play', 1, { sound: soundCue({ file: 'clip.mp4', startSeconds: 0 }) });
  await flush();
  assert.equal(room.state().soundState.status, 'playing');
  assert.equal(room.elements['sound-audio'].playCalls, 1);
  assert.equal(room.elements['cue-video'].playCalls, 0);
});

await check('sound commands reject wrong outputs, stale revisions, and invalid run IDs', async () => {
  const room = fixture();
  room.arm();
  room.soundCommand('play', 2, { sound: soundCue() });
  await flush();
  const calls = room.elements['sound-audio'].playCalls;
  room.soundCommand('stop', 3, { targetOutputId: 'other-output' });
  room.soundCommand('stop', 2);
  room.soundCommand('stop', 1);
  room.soundCommand('stop', 3, { soundRunId: 'not-a-uuid' });
  room.soundCommand('stop', Infinity);
  assert.equal(room.state().soundState.status, 'playing');
  assert.equal(room.state().soundState.revision, 2);
  assert.equal(room.elements['sound-audio'].playCalls, calls);
});

for (const [label, changes] of [
  ['negative start', { startSeconds: -1 }],
  ['nonfinite start', { startSeconds: Infinity }],
  ['string start', { startSeconds: '5' }],
  ['zero duration', { durationSeconds: 0 }],
  ['too-short duration', { durationSeconds: 0.09 }],
  ['too-long duration', { durationSeconds: 30.1 }],
  ['nonfinite duration', { durationSeconds: NaN }],
  ['negative volume', { volume: -0.1 }],
  ['too-loud volume', { volume: 1.1 }],
  ['nonfinite volume', { volume: Infinity }],
  ['remote file', { file: 'https://example.com/sound.mp3' }],
  ['parent traversal', { file: '../sound.mp3' }],
  ['nonmedia file', { file: 'notes.txt' }],
  ['unsupported audio extension', { file: 'sound.opus' }],
  ['unsupported video extension', { file: 'sound.ogv' }],
]) {
  await check(`sound safely rejects ${label} before playing`, async () => {
    const room = fixture();
    room.arm();
    room.soundCommand('play', 1, { sound: soundCue(changes) });
    await flush();
    assert.equal(room.state().soundState.status, 'error');
    assert.equal(room.events('sound-error').length, 1);
    assert.equal(room.elements['sound-audio'].playCalls, 0);
    assert.equal(room.state().statusstate, 'holding');
  });
}

await check('sound permits the 0.1 and 30 second duration boundaries', async () => {
  for (const durationSeconds of [0.1, 30]) {
    const room = fixture();
    room.arm();
    room.soundCommand('play', 1, { sound: soundCue({ startSeconds: 0, durationSeconds, volume: 0 }) });
    await flush();
    assert.equal(room.state().soundState.status, 'playing');
    assert.equal(room.elements['sound-audio'].volume, 0);
  }
});

await check('sound trim must fit within a finite local-file duration', async () => {
  for (const duration of [6, Infinity, NaN, 0]) {
    const room = fixture();
    room.arm();
    room.elements['sound-audio'].duration = duration;
    room.soundCommand('play', 1, { sound: soundCue() });
    await flush();
    assert.equal(room.state().soundState.status, 'error');
    assert.equal(room.elements['sound-audio'].playCalls, 0);
    assert.match(room.events('sound-error')[0].error, /fit inside/);
  }
});

await check('a failed sound seek never becomes audible', async () => {
  for (const property of ['throwNextSeek', 'ignoreSeek']) {
    const room = fixture();
    room.arm();
    room.elements['sound-audio'][property] = true;
    room.soundCommand('play', 1, { sound: soundCue() });
    await flush();
    assert.equal(room.state().soundState.status, 'error');
    assert.equal(room.elements['sound-audio'].playCalls, 0);
    assert.equal(room.elements['sound-audio'].muted, true);
    assert.match(room.events('sound-error')[0].error, /seek/);
  }
});

await check('a stuck sound seek fails within its deadline', async () => {
  const room = fixture();
  room.arm();
  room.elements['sound-audio'].holdSeek = true;
  room.soundCommand('play', 1, { sound: soundCue() });
  await flush();
  room.expire(5000);
  await flush();
  assert.equal(room.state().soundState.status, 'error');
  assert.match(room.events('sound-error')[0].error, /Seeking the sound timed out/);
  assert.equal(room.elements['sound-audio'].playCalls, 0);
});

await check('retrigger replaces only the sound and ignores old trim callbacks', async () => {
  const room = fixture();
  room.arm();
  room.soundCommand('play', 1, { sound: soundCue() });
  await flush();
  const oldTrim = room.timeouts().find((timer) => timer.delay === 2000);
  room.soundCommand('play', 2, { sound: soundCue({ id: 'sound-two', file: 'next.wav', startSeconds: 1, durationSeconds: 1 }) });
  await flush();
  oldTrim.fn();
  room.elements['sound-audio'].dispatchEvent(new Event('ended'));
  assert.equal(room.state().soundState.status, 'playing');
  assert.equal(room.state().soundState.soundId, 'sound-two');
  assert.equal(room.state().soundState.revision, 2);
  assert.equal(room.elements['sound-audio'].src, 'http://127.0.0.1:2006/media/next.wav');
  assert.equal(room.events('sound-ended').length, 0);
  assert.equal(room.elements['cue-video'].playCalls, 0);
});

await check('Stop aborts a sound still loading and ignores delayed readiness', async () => {
  const room = fixture();
  room.arm();
  room.elements['sound-audio'].autoReady = false;
  room.soundCommand('play', 1, { sound: soundCue() });
  room.soundCommand('stop', 2);
  room.elements['sound-audio'].readyState = 2;
  room.elements['sound-audio'].dispatchEvent(new Event('loadeddata'));
  await flush();
  assert.equal(room.state().soundState.status, 'stopped');
  assert.equal(room.state().soundState.revision, 2);
  assert.equal(room.elements['sound-audio'].playCalls, 0);
  assert.equal(room.events('sound-started').length, 0);
  assert.equal(room.events('sound-error').length, 0);
});

await check('Stop aborts a pending sound play promise without resurrection', async () => {
  const room = fixture();
  room.arm();
  let resolvePlay;
  room.elements['sound-audio'].nextPlay = new Promise((resolve) => { resolvePlay = resolve; });
  room.soundCommand('play', 1, { sound: soundCue() });
  await flush();
  room.soundCommand('stop', 2);
  resolvePlay();
  await flush();
  assert.equal(room.state().soundState.status, 'stopped');
  assert.equal(room.elements['sound-audio'].paused, true);
  assert.equal(room.elements['sound-audio'].muted, true);
  assert.equal(room.events('sound-started').length, 0);
  assert.equal(room.events('sound-error').length, 0);
});

await check('sound loading and playing deadlines do not affect an ongoing cue', async () => {
  for (const mode of ['load', 'play']) {
    const room = fixture();
    room.arm();
    room.command('play', 1, { cue: videoCue() });
    await flush();
    if (mode === 'load') room.elements['sound-audio'].autoReady = false;
    else room.elements['sound-audio'].nextPlay = new Promise(() => {});
    room.soundCommand('play', 1, { sound: soundCue() });
    await flush();
    room.expire(12000);
    await flush();
    assert.equal(room.state().soundState.status, 'error');
    assert.equal(room.events('sound-error').length, 1);
    assert.equal(room.state().statusstate, 'playing');
    assert.equal(room.state().runId, 'run-1');
    assert.equal(room.elements['cue-video'].paused, false);
  }
});

await check('sound decoding and sound permission errors leave cue playback alone', async () => {
  const room = fixture();
  room.arm();
  room.command('play', 1, { cue: videoCue() });
  await flush();
  room.elements['sound-audio'].nextPlay = Promise.reject(new DOMException('Sound is blocked', 'NotAllowedError'));
  room.soundCommand('play', 1, { sound: soundCue() });
  await flush();
  assert.equal(room.state().soundState.status, 'error');
  assert.equal(room.state().statusstate, 'playing');
  room.soundCommand('play', 2, { sound: soundCue() });
  await flush();
  room.elements['sound-audio'].error = { code: 3 };
  room.elements['sound-audio'].dispatchEvent(new Event('error'));
  assert.equal(room.state().soundState.status, 'error');
  assert.equal(room.events('sound-error').length, 2);
  assert.equal(room.elements['cue-video'].paused, false);
  assert.equal(room.events('error').length, 0);
});

await check('cue GO and HOLD never stop or replace an independent sound', async () => {
  const room = fixture();
  room.arm();
  room.soundCommand('play', 8, { sound: soundCue() });
  await flush();
  room.command('play', 1, { cue: videoCue() });
  await flush();
  room.command('hold', 2);
  await flush();
  assert.equal(room.state().soundState.status, 'playing');
  assert.equal(room.state().soundState.revision, 8);
  assert.equal(room.elements['sound-audio'].paused, false);
  assert.equal(room.elements['sound-audio'].playCalls, 1);
});

await check('blackout stops all sound including a pending sound start', async () => {
  const room = fixture();
  room.arm();
  room.soundCommand('play', 1, { sound: soundCue() });
  await flush();
  room.command('black', 1);
  assert.equal(room.state().soundState.status, 'stopped');
  assert.equal(room.elements['sound-audio'].paused, true);
  let resolvePlay;
  room.elements['sound-audio'].nextPlay = new Promise((resolve) => { resolvePlay = resolve; });
  room.soundCommand('play', 2, { sound: soundCue() });
  await flush();
  room.command('black', 2);
  resolvePlay();
  await flush();
  assert.equal(room.state().soundState.status, 'stopped');
  assert.equal(room.state().statusstate, 'black');
  assert.equal(room.events('sound-started').length, 1);
});

await check('closing the audience output stops sound and disposes sound callbacks', async () => {
  const room = fixture();
  room.arm();
  room.soundCommand('play', 1, { sound: soundCue() });
  await flush();
  const trim = room.timeouts().find((timer) => timer.delay === 2000);
  room.command('close', 1);
  const messages = room.messages.length;
  trim.fn();
  room.elements['sound-audio'].ended = true;
  room.elements['sound-audio'].dispatchEvent(new Event('ended'));
  room.soundCommand('play', 2, { sound: soundCue() });
  assert.equal(room.state().soundState.status, 'stopped');
  assert.equal(room.elements['sound-audio'].paused, true);
  assert.equal(room.messages.length, messages);
});

await check('sound errors persist in heartbeat snapshots and clear on new actions', async () => {
  const room = fixture();
  room.arm();
  room.soundCommand('play', 1, { sound: soundCue({ durationSeconds: 31 }) });
  await flush();
  assert.match(room.state().soundState.error, /duration/);
  assert.equal(room.events('sound-error')[0].soundState.error, room.state().soundState.error);
  room.soundCommand('stop', 2);
  assert.equal(room.state().soundState.error, '');
  room.soundCommand('play', 3, { sound: soundCue() });
  await flush();
  assert.equal(room.state().soundState.error, '');
  room.expire(2000);
  assert.equal(room.state().soundState.status, 'ended');
  assert.equal(room.state().soundState.error, '');
});

await check('mount refresh reloads a same-named holding file while ordinary configure preserves it', async () => {
  const room = fixture();
  room.command('configure', 0, { hold: { file: 'hold.mp4' } });
  room.arm();
  await flush();
  const initialLoads = room.elements['hold-video'].loadCalls;
  room.command('configure', 0, { hold: { file: 'hold.mp4' } });
  await flush();
  assert.equal(room.elements['hold-video'].loadCalls, initialLoads);
  room.command('configure', 0, { hold: { file: 'hold.mp4' }, refreshHold: true });
  await flush();
  assert.equal(room.elements['hold-video'].loadCalls, initialLoads + 1);
  assert.equal(room.elements['hold-video'].src, 'http://127.0.0.1:2006/media/hold.mp4');
  assert.equal(room.elements['hold-video'].hidden, false);
  assert.equal(room.state().statusstate, 'holding');
  assert.equal(room.events('hold-error').length, 0);
});

await check('mount hold refresh never resets an active cue, sound, or cue identity', async () => {
  const room = fixture();
  room.command('configure', 0, { hold: { file: 'hold.mp4' } });
  room.arm();
  await flush();
  room.command('play', 1, { cue: videoCue() });
  room.soundCommand('play', 3, { sound: soundCue() });
  await flush();
  const cueLoads = room.elements['cue-video'].loadCalls;
  const soundLoads = room.elements['sound-audio'].loadCalls;
  const holdLoads = room.elements['hold-video'].loadCalls;
  room.command('configure', 1, { hold: { file: 'hold.mp4' }, refreshHold: true });
  await flush();
  assert.equal(room.elements['cue-video'].loadCalls, cueLoads);
  assert.equal(room.elements['sound-audio'].loadCalls, soundLoads);
  assert.equal(room.elements['hold-video'].loadCalls, holdLoads);
  assert.equal(room.state().statusstate, 'playing');
  assert.equal(room.state().runId, 'run-1');
  assert.equal(room.state().revision, 1);
  assert.equal(room.state().soundState.status, 'playing');
  assert.equal(room.state().soundState.revision, 3);
  room.command('hold', 2);
  await flush();
  assert.equal(room.elements['hold-video'].loadCalls, holdLoads + 1);
  assert.equal(room.elements['hold-video'].hidden, false);
});

process.stdout.write(`\n${checks} offline room output checks passed.\n`);
