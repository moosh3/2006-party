import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as roomState from '../tools/room-player/state.mjs';

const source = (await readFile(new URL('../tools/room-player/app.mjs', import.meta.url), 'utf8'))
  .replace(/^import .* from '\.\/state\.mjs';\s*/u, '');
const html = await readFile(new URL('../tools/room-player/index.html', import.meta.url), 'utf8');
let checks = 0;

async function check(label, run) {
  await run();
  checks += 1;
  process.stdout.write(`PASS ${label}\n`);
}

async function flush() {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

const copy = (value) => JSON.parse(JSON.stringify(value));
const sound = (overrides = {}) => ({ id:'life-is-a-highway', label:'LIFE IS A HIGHWAY', file:'Highway.mp4', startSeconds:10, durationSeconds:3, volume:0.8, ...overrides });
const rundown = (sounds = [sound()]) => ({
  version:1, title:'Local rehearsal', mediaDirectory:'/room-media', captions:true,
  hold:{file:''}, sounds,
  cues:[
    { id:'video-one', label:'Room video', kind:'video', file:'Scene.mp4', notes:'', endAction:'hold' },
    { id:'live-two', label:'Live performance', kind:'live', file:'', notes:'Wait for the performers.', endAction:'hold' },
  ],
});

function fixture({ show = rundown(), files, lock = true, durations = {} } = {}) {
  const messages = [], requests = [], timers = new Map();
  let timerId = 0, now = 0, uuid = 0;
  let saved = copy(show);
  const library = { directory:'/room-media', files:files ?? [
    { path:'Scene.mp4', kind:'video', size:100 },
    { path:'Highway.mp4', kind:'video', size:100 },
    { path:'Highway.mp3', kind:'audio', size:100 },
  ], warnings:[] };

  class Target {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }
    removeEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      this.listeners.set(type, listeners.filter((item) => item !== listener));
    }
    dispatch(type, values = {}) {
      const event = { type, target:this, defaultPrevented:false, preventDefault() { this.defaultPrevented = true; }, ...values };
      const results = (this.listeners.get(type) || []).map((listener) => listener(event));
      return { event, done:Promise.all(results) };
    }
  }
  class Element extends Target {
    constructor(tagName = 'div', id = '') {
      super();
      this.tagName = tagName.toUpperCase(); this.id = id;
      this.children = []; this.attributes = new Map(); this.selectors = new Map(); this.dataset = {};
      this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.checked = false;
      this.files = []; this.parentElement = null; this.inert = false;
      const classes = new Set();
      this.classList = {
        toggle(name, on) { const enabled = on === undefined ? !classes.has(name) : Boolean(on); if (enabled) classes.add(name); else classes.delete(name); return enabled; },
        contains(name) { return classes.has(name); },
      };
    }
    append(...children) {
      for (const child of children) {
        if (child.tagName === '#FRAGMENT') this.append(...child.children);
        else { child.parentElement = this; this.children.push(child); }
      }
    }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    querySelector(selector) {
      const existing = this.querySelectorAll(selector)[0];
      if (existing) return existing;
      if (!this.selectors.has(selector)) {
        const child = new Element(selector.includes('button') ? 'button' : 'div');
        this.selectors.set(selector, child); this.append(child);
      }
      return this.selectors.get(selector);
    }
    querySelectorAll(selector) {
      const descendants = (element) => element.children.flatMap((child) => [child, ...descendants(child)]);
      const tag = selector.split('[')[0].toUpperCase();
      return descendants(this).filter((child) => child.tagName === tag);
    }
    closest() { return ['INPUT','TEXTAREA','SELECT','BUTTON','SUMMARY'].includes(this.tagName) ? this : null; }
    focus() { document.activeElement = this; }
    select() {}
    click() { return this.disabled ? { done:Promise.resolve() } : this.dispatch('click'); }
  }
  class Media extends Element {
    constructor(tag) { super(tag); this._src = ''; this.duration = 0; }
    get src() { return this._src; }
    set src(value) {
      this._src = value;
      const path = value.slice('/media/'.length).split('/').map(decodeURIComponent).join('/');
      this.duration = durations[path] ?? 120;
      queueMicrotask(() => { if (this._src === value) this.onloadeddata?.(); });
    }
    removeAttribute(name) { super.removeAttribute(name); if (name === 'src') this._src = ''; }
    load() {}
  }

  const elements = {};
  for (const match of html.matchAll(/<([\w-]+)\b[^>]*\bid="([^"]+)"/gu)) elements[match[2]] = new Element(match[1], match[2]);
  const main = new Element('main');
  elements['output-status'].parentElement = new Element();
  const document = new Target();
  document.getElementById = (id) => {
    assert.ok(elements[id], `The app referenced absent element #${id}`);
    return elements[id];
  };
  document.createElement = (tag) => ['video','audio'].includes(tag) ? new Media(tag) : new Element(tag);
  document.createTextNode = (text) => Object.assign(new Element('#text'), {textContent:text});
  document.createDocumentFragment = () => new Element('#fragment');
  document.querySelector = () => main;
  document.activeElement = main;
  let channel;
  class Channel extends Target {
    constructor(name) { super(); this.name = name; channel = this; }
    postMessage(message) { messages.push(copy(message)); }
    close() {}
  }
  const context = vm.createContext({
    ...roomState,
    document,
    window:{ open:() => ({}), addEventListener() {} },
    navigator:{ locks:{ request(_name, _options, callback) { return Promise.resolve().then(() => callback(lock ? {} : null)); } } },
    performance:{ now:() => now },
    crypto:{ randomUUID:() => `operator-${++uuid}` },
    BroadcastChannel:Channel,
    URL, Blob, AbortController, DOMException,
    setTimeout:(fn, ms) => { const id = ++timerId; timers.set(id, {fn, ms, interval:false}); return id; },
    clearTimeout:(id) => timers.delete(id),
    setInterval:(fn, ms) => { const id = ++timerId; timers.set(id, {fn, ms, interval:true}); return id; },
    clearInterval:(id) => timers.delete(id),
    fetch:async (path, options = {}) => {
      requests.push({path, ...options});
      assert.ok(['/api/show','/api/library'].includes(path), `Operator used unexpected network path ${path}`);
      if (path === '/api/show') {
        if (options.method === 'POST') saved = JSON.parse(options.body);
        return { ok:true, json:async () => copy(saved) };
      }
      return { ok:true, json:async () => copy(library) };
    },
  });
  vm.runInContext(source, context, {filename:'app.mjs'});
  return {
    elements, document, messages, requests,
    state:() => copy(vm.runInContext('state', context)),
    saved:() => copy(saved),
    pads:() => {
      const descendants = (element) => element.children.flatMap((child) => [child, ...descendants(child)]);
      return descendants(elements['sound-pads']).filter((element) => element.tagName === 'BUTTON');
    },
    soundCommands:() => messages.filter((message) => message.type === 'sound-command'),
    cueCommands:() => messages.filter((message) => message.type === 'command'),
    send(message) { channel.dispatch('message', {data:message}); },
    armed({ revision = -1, soundState, outputId = 'audience-one' } = {}) {
      channel.dispatch('message', { data:{ type:'armed', outputId, armed:true, revision, runId:'old-cue', statusstate:'holding', fullscreen:true, ...(soundState ? {soundState} : {}) } });
    },
    key(code, key, values = {}) {
      return document.dispatch('keydown', { code, key, target:main, repeat:false, ctrlKey:false, metaKey:false, altKey:false, shiftKey:false, ...values });
    },
    advance(ms) { now += ms; },
    heartbeat() { for (const timer of timers.values()) if (timer.interval) timer.fn(); },
  };
}

await check('soundboard starts disabled until an audience output is armed', async () => {
  const room = fixture(); await flush();
  assert.equal(room.pads().length, 1);
  assert.equal(room.pads()[0].disabled, true);
  room.armed(); await flush();
  assert.equal(room.pads()[0].disabled, false);
  assert.equal(room.elements['go'].disabled, false);
});

await check('a missing sound file never fires or disables the video rundown', async () => {
  const room = fixture({show:rundown([sound({file:''})])}); await flush();
  room.armed(); await flush();
  assert.equal(room.pads()[0].disabled, true);
  assert.equal(room.elements['go'].disabled, false);
  room.key('Digit1','1'); await flush();
  assert.equal(room.soundCommands().filter((message) => message.action === 'play').length, 0);
});

await check('a sound file absent from the mounted media folder cannot fire', async () => {
  const room = fixture({show:rundown([sound({file:'Gone.mp3'})])}); await flush();
  room.armed(); await flush();
  assert.equal(room.pads()[0].disabled, true);
  room.key('Digit1','1'); await flush();
  assert.equal(room.soundCommands().filter((message) => message.action === 'play').length, 0);
});

await check('a local audio-only source is selectable and can fire', async () => {
  const room = fixture({show:rundown([sound({file:'Highway.mp3'})])}); await flush();
  room.armed(); await flush();
  assert.equal(room.pads()[0].disabled,false);
  const choices = room.elements['sound-file'].children.map((element) => element.value);
  assert.ok(choices.includes('Highway.mp3'));
  room.pads()[0].click(); await flush();
  assert.equal(room.soundCommands().at(-1).sound.file,'Highway.mp3');
});

await check('sound playback and Stop leave an ongoing video command untouched', async () => {
  const room = fixture(); await flush(); room.armed(); await flush();
  room.elements['go'].click(); await flush();
  const play = room.cueCommands().findLast((message) => message.action === 'play');
  room.send({type:'started', outputId:'audience-one', revision:play.revision, runId:play.runId});
  const before = room.state(), cueCount = room.cueCommands().length;
  room.pads()[0].click(); await flush();
  const soundPlay = room.soundCommands().findLast((message) => message.action === 'play');
  assert.ok(soundPlay);
  assert.equal(soundPlay.targetOutputId, 'audience-one');
  assert.deepEqual(soundPlay.sound, sound());
  assert.deepEqual(room.state(), before);
  assert.equal(room.cueCommands().length, cueCount);
  assert.equal(room.elements['go'].disabled,false);
  room.elements['stop-sound'].click(); await flush();
  const stop = room.soundCommands().findLast((message) => message.action === 'stop');
  assert.ok(stop);
  assert.ok(stop.soundRevision > soundPlay.soundRevision);
  assert.deepEqual(room.state(), before);
  assert.equal(room.cueCommands().length, cueCount);
});

await check('sound retriggers use newer independent tokens without changing GO', async () => {
  const room = fixture(); await flush(); room.armed(); await flush();
  const before = room.state();
  room.pads()[0].click(); await flush(); room.pads()[0].click(); await flush();
  const commands = room.soundCommands().filter((message) => message.action === 'play');
  assert.equal(commands.length, 2);
  assert.ok(commands[1].soundRevision > commands[0].soundRevision);
  assert.notEqual(commands[1].soundRunId, commands[0].soundRunId);
  assert.deepEqual(room.state(), before);
});

await check('a video can auto-follow while its independent sound is still playing', async () => {
  const show = rundown();
  show.cues[0].endAction = 'next';
  show.cues[1] = {...show.cues[1], kind:'video', file:'Scene.mp4'};
  const room = fixture({show}); await flush(); room.armed(); await flush();
  room.elements['go'].click();
  const cue = room.cueCommands().findLast((message) => message.action === 'play');
  room.send({type:'started', outputId:'audience-one', revision:cue.revision, runId:cue.runId});
  room.pads()[0].click();
  const soundPlay = room.soundCommands().at(-1);
  room.send({type:'sound-started', outputId:'audience-one', soundRevision:soundPlay.soundRevision, soundRunId:soundPlay.soundRunId});
  room.advance(700);
  room.send({type:'ended', outputId:'audience-one', revision:cue.revision, runId:cue.runId});
  await flush();
  const follow = room.cueCommands().findLast((message) => message.action === 'play');
  assert.equal(follow.cue.id,'live-two');
  assert.ok(follow.revision > cue.revision);
  assert.equal(room.state().status,'loading');
  assert.match(room.elements['sound-status'].textContent,/Playing:/u);
  assert.equal(room.soundCommands().at(-1).action,'play');
});

await check('Digit 1 fires a configured pad but typing, modifiers and repeats do not', async () => {
  const room = fixture(); await flush(); room.armed(); await flush();
  room.key('Digit1','1'); await flush();
  assert.equal(room.soundCommands().filter((message) => message.action === 'play').length, 1);
  for (const target of [room.elements['sound-start'], room.elements['sound-file'], room.elements['cue-notes'], room.pads()[0]]) {
    room.key('Digit1','1',{target});
  }
  for (const values of [{repeat:true},{ctrlKey:true},{metaKey:true},{altKey:true}]) room.key('Digit1','1',values);
  await flush();
  assert.equal(room.soundCommands().filter((message) => message.action === 'play').length, 1);
});

await check('an operator reload acquires a newer independent sound revision', async () => {
  const room = fixture(); await flush();
  room.armed({revision:35,soundState:{revision:83,runId:'previous-sound',soundId:'life-is-a-highway',status:'playing',currentTime:11}});
  await flush();
  room.pads()[0].click(); await flush();
  const play = room.soundCommands().findLast((message) => message.action === 'play');
  assert.ok(play.soundRevision > 83);
  assert.ok(room.state().revision > 35);
});

await check('sound errors report the problem without ending or requeuing video', async () => {
  const room = fixture(); await flush(); room.armed(); await flush(); room.elements['go'].click();
  const cue = room.cueCommands().findLast((message) => message.action === 'play');
  room.send({type:'started', outputId:'audience-one', revision:cue.revision, runId:cue.runId});
  room.pads()[0].click(); await flush();
  const command = room.soundCommands().findLast((message) => message.action === 'play');
  const before = room.state(), cueCount = room.cueCommands().length;
  room.send({type:'sound-error', outputId:'audience-one', soundRevision:command.soundRevision, soundRunId:command.soundRunId, soundId:'life-is-a-highway', error:'Local sound could not decode.'});
  await flush();
  assert.deepEqual(room.state(), before);
  assert.equal(room.cueCommands().length, cueCount);
  assert.match(room.elements['sound-status'].textContent, /decode/iu);
});

await check('sound acknowledgements update its status without video events', async () => {
  const room = fixture(); await flush(); room.armed(); await flush();
  room.pads()[0].click();
  const command = room.soundCommands().at(-1), before = room.state();
  const token = {outputId:'audience-one', soundRevision:command.soundRevision, soundRunId:command.soundRunId};
  room.send({type:'sound-started', ...token}); await flush();
  assert.match(room.elements['sound-status'].textContent,/Playing:/u);
  assert.equal(room.elements['stop-sound'].disabled,false);
  room.send({type:'sound-ended', ...token}); await flush();
  assert.match(room.elements['sound-status'].textContent,/finished/iu);
  assert.equal(room.elements['stop-sound'].disabled,true);
  assert.deepEqual(room.state(),before);
});

await check('stale or other-output sound errors cannot overwrite a retrigger', async () => {
  const room = fixture(); await flush(); room.armed(); await flush();
  room.pads()[0].click(); const first = room.soundCommands().at(-1);
  room.pads()[0].click(); const second = room.soundCommands().at(-1);
  room.send({type:'sound-started', outputId:'audience-one', soundRevision:second.soundRevision, soundRunId:second.soundRunId});
  const status = room.elements['sound-status'].textContent;
  room.send({type:'sound-error', outputId:'audience-one', soundRevision:first.soundRevision, soundRunId:first.soundRunId, error:'Stale failure'});
  room.send({type:'sound-error', outputId:'unselected-output', soundRevision:second.soundRevision, soundRunId:second.soundRunId, error:'Other failure'});
  await flush();
  assert.equal(room.elements['sound-status'].textContent,status);
});

await check('newer sound heartbeat state is accepted and stale heartbeats are ignored', async () => {
  const room = fixture(); await flush(); room.armed(); await flush();
  room.pads()[0].click(); const command = room.soundCommands().at(-1);
  room.send({type:'status', outputId:'audience-one', armed:true, soundState:{revision:command.soundRevision, runId:command.soundRunId, soundId:'life-is-a-highway', status:'playing', currentTime:11}});
  const playing = room.elements['sound-status'].textContent;
  assert.match(playing,/Playing:/u);
  room.send({type:'status', outputId:'audience-one', armed:true, soundState:{revision:command.soundRevision - 1, runId:'stale', soundId:null, status:'error', error:'Old failure'}});
  await flush();
  assert.equal(room.elements['sound-status'].textContent,playing);
});

await check('Blackout still emits its ordinary main-output command', async () => {
  const room = fixture(); await flush(); room.armed(); await flush();
  room.pads()[0].click(); room.elements['black'].click(); await flush();
  assert.equal(room.cueCommands().at(-1).action, 'black');
  assert.equal(room.state().status, 'black');
});

await check('sound trim and volume save locally with authenticated JSON writes', async () => {
  const room = fixture(); await flush();
  room.elements['sound-file'].value = 'Highway.mp3';
  room.elements['sound-start'].value = '44.5';
  room.elements['sound-duration'].value = '3.2';
  room.elements['sound-volume'].value = '65';
  await room.elements['sound-form'].dispatch('submit').done; await flush();
  const saved = room.saved().sounds[0];
  assert.equal(saved.file,'Highway.mp3'); assert.equal(saved.startSeconds,44.5);
  assert.equal(saved.durationSeconds,3.2); assert.equal(saved.volume,0.65);
  const request = room.requests.findLast((request) => request.path === '/api/show' && request.method === 'POST');
  assert.equal(request.headers['X-Room-Player'],'1');
  assert.equal(request.headers['Content-Type'],'application/json');
});

await check('sound setup remains locked while a video is playing', async () => {
  const room = fixture(); await flush(); room.armed(); await flush(); room.elements['go'].click();
  const cue = room.cueCommands().findLast((message) => message.action === 'play');
  room.send({type:'started', outputId:'audience-one', revision:cue.revision, runId:cue.runId});
  await flush();
  for (const id of ['sound-file','sound-start','sound-duration','sound-volume']) assert.equal(room.elements[id].disabled,true);
  const saved = room.saved();
  room.elements['sound-start'].value = '80';
  await room.elements['sound-form'].dispatch('submit').done; await flush();
  assert.deepEqual(room.saved(),saved);
  assert.equal(room.pads()[0].disabled,false);
});

await check('sound setup is also locked during an independent sound and unlocks after Stop', async () => {
  const room = fixture(); await flush(); room.armed(); await flush();
  room.pads()[0].click(); await flush();
  for (const id of ['sound-file','sound-start','sound-duration','sound-volume','directory','add-cue']) assert.equal(room.elements[id].disabled,true);
  room.elements['stop-sound'].click(); await flush();
  for (const id of ['sound-file','sound-start','sound-duration','sound-volume','directory','add-cue']) assert.equal(room.elements[id].disabled,false);
});

await check('preflight blocks an out-of-bounds sound without blocking a valid video', async () => {
  const room = fixture({show:rundown([sound({startSeconds:119,durationSeconds:3})]), durations:{'Scene.mp4':30,'Highway.mp4':120}});
  await flush(); room.armed(); await flush();
  await room.elements['preflight'].click().done; await flush();
  assert.equal(room.pads()[0].disabled,true);
  assert.equal(room.elements['go'].disabled,false);
  assert.match(room.elements['preflight-results'].children.at(-1).textContent,/past the end/iu);
});

await check('an optional unconfigured pad does not fail show-file preflight', async () => {
  const room = fixture({show:rundown([sound({file:''})])}); await flush();
  await room.elements['preflight'].click().done; await flush();
  assert.match(room.elements['preflight-results'].children.at(-1).textContent,/NOT SET UP/u);
  assert.equal(room.elements['notice'].classList.contains('is-error'),false);
});

await check('invalid sound duration or volume is rejected before writing settings', async () => {
  const room = fixture(); await flush();
  const before = room.saved();
  for (const [id,value] of [['sound-duration','0'],['sound-duration','31'],['sound-volume','101']]) {
    room.elements['sound-duration'].value = '3'; room.elements['sound-volume'].value = '100';
    room.elements[id].value = value;
    await room.elements['sound-form'].dispatch('submit').done; await flush();
    assert.deepEqual(room.saved(),before);
  }
  assert.equal(room.requests.filter((request) => request.method === 'POST').length,0);
});

await check('a disconnected audience output disables sound shortcuts and GO', async () => {
  const room = fixture(); await flush(); room.armed(); await flush();
  room.advance(4000); room.heartbeat(); await flush();
  assert.equal(room.pads()[0].disabled,true); assert.equal(room.elements['go'].disabled,true);
  const count = room.soundCommands().length;
  room.key('Digit1','1'); await flush();
  assert.equal(room.soundCommands().length,count);
});

await check('closing the selected audience output unlocks setup without claiming readiness', async () => {
  const room = fixture(); await flush(); room.armed(); await flush();
  room.pads()[0].click(); await flush();
  assert.equal(room.elements['directory'].disabled,true);
  room.send({type:'closed', outputId:'audience-one'}); await flush();
  for (const id of ['sound-file','sound-start','sound-duration','sound-volume','directory','add-cue']) assert.equal(room.elements[id].disabled,false);
  assert.equal(room.elements['go'].disabled,true);
  assert.equal(room.elements['stop-sound'].disabled,true);
  assert.equal(room.pads()[0].disabled,true);
  assert.match(room.elements['output-status'].textContent,/not connected/iu);
});

await check('closing an unrelated output does not clear the selected sound state', async () => {
  const room = fixture(); await flush(); room.armed(); await flush();
  room.pads()[0].click();
  const command = room.soundCommands().at(-1);
  room.send({type:'sound-started', outputId:'audience-one', soundRevision:command.soundRevision, soundRunId:command.soundRunId});
  const playing = room.elements['sound-status'].textContent;
  room.send({type:'closed', outputId:'other-output'}); await flush();
  assert.equal(room.elements['sound-status'].textContent,playing);
  assert.equal(room.elements['directory'].disabled,true);
  assert.equal(room.elements['stop-sound'].disabled,false);
  assert.equal(room.pads()[0].disabled,false);
});

await check('a lost sound heartbeat sends a newer emergency Stop and unlocks setup', async () => {
  const room = fixture(); await flush(); room.armed(); await flush();
  room.pads()[0].click(); await flush();
  const play = room.soundCommands().at(-1), before = room.state();
  room.advance(4000); room.heartbeat(); await flush();
  const stop = room.soundCommands().at(-1);
  assert.equal(stop.action,'stop');
  assert.equal(stop.targetOutputId,'audience-one');
  assert.ok(stop.soundRevision > play.soundRevision);
  assert.deepEqual(room.state(),before);
  for (const id of ['sound-file','sound-start','sound-duration','sound-volume','directory','add-cue']) assert.equal(room.elements[id].disabled,false);
  assert.equal(room.elements['go'].disabled,true);
  assert.equal(room.pads()[0].disabled,true);
  const count = room.soundCommands().length;
  room.heartbeat(); await flush();
  assert.equal(room.soundCommands().length,count);
});

await check('fresh stale sound snapshots cannot resurrect a lost-heartbeat run', async () => {
  const room = fixture(); await flush(); room.armed(); await flush();
  room.pads()[0].click();
  const first = room.soundCommands().at(-1);
  room.advance(4000); room.heartbeat(); await flush();
  const stop = room.soundCommands().at(-1);
  room.send({type:'status', outputId:'audience-one', armed:true, soundState:{revision:first.soundRevision, runId:first.soundRunId, soundId:'life-is-a-highway', status:'playing', currentTime:11}});
  await flush();
  assert.match(room.elements['sound-status'].textContent,/stopped/iu);
  assert.equal(room.elements['directory'].disabled,false);
  assert.equal(room.pads()[0].disabled,false);
  room.pads()[0].click();
  const second = room.soundCommands().at(-1);
  assert.equal(second.action,'play');
  assert.ok(second.soundRevision > stop.soundRevision);
  room.send({type:'sound-started', outputId:'audience-one', soundRevision:second.soundRevision, soundRunId:second.soundRunId});
  await flush();
  assert.match(room.elements['sound-status'].textContent,/Playing:/u);
  assert.equal(room.elements['directory'].disabled,true);
});

await check('loading a media folder asks the output to refresh its holding asset', async () => {
  const room = fixture(); await flush(); room.armed(); await flush();
  room.elements['directory'].value = '/replacement-media';
  await room.elements['directory-form'].dispatch('submit').done; await flush();
  const configure = room.cueCommands().findLast((message) => message.action === 'configure');
  assert.equal(configure.refreshHold,true);
  assert.equal(configure.targetOutputId,'audience-one');
  assert.equal(room.requests.findLast((request) => request.path === '/api/library').method,'POST');
});

await check('a second operator cannot access the soundboard or send cues', async () => {
  const room = fixture({lock:false}); await flush();
  assert.equal(room.elements['open-output'].disabled,true);
  assert.equal(room.soundCommands().length,0);
  assert.equal(room.cueCommands().length,0);
  assert.match(room.elements['notice'].textContent,/another operator/iu);
});

process.stdout.write(`Room operator: ${checks} checks passed.\n`);
