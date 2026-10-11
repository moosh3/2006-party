/** Browser audio lifecycle regression checks; no network or production state. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aimSoundsEnabled, playAimSound, setAimSoundsEnabled, subscribeAimSounds, unlockAimSounds } from '../lib/aim-sounds';

async function main() {
  const windowMock = new EventTarget();
  const documentMock = Object.assign(new EventTarget(), { hidden: false });
  const storage = new Map<string, string>([['2006-aim-sounds', 'off']]);
  let clock = 100000, fetches = 0, contexts = 0, starts = 0, stops = 0, failStart = false;
  let releaseResume = () => {};
  let delayedResume = false;
  const originalNow = Date.now;
  Date.now = () => clock;
  class AudioMock {
    state = 'suspended';
    destination = {};
    constructor() { contexts++; }
    async resume() {
      if (delayedResume) await new Promise<void>(resolve => { releaseResume = resolve; });
      this.state = 'running';
    }
    async decodeAudioData() { return {}; }
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
    createBufferSource() {
      return { buffer: null, onended: null, connect() {}, disconnect() {},
        start() { if (failStart) throw new Error('Audio device unavailable'); starts++; },
        stop() { stops++; },
      };
    }
  }
  Object.assign(globalThis, {
    window: windowMock, document: documentMock, AudioContext: AudioMock,
    localStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) },
    fetch: async () => { fetches++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) }; },
  });
  let changes = 0;
  const unsubscribe = subscribeAimSounds(() => changes++);
  assert.equal(aimSoundsEnabled(), false);
  unlockAimSounds(); await playAimSound('welcome');
  assert.equal(contexts, 0); assert.equal(fetches, 0); assert.equal(starts, 0);

  delayedResume = true;
  setAimSoundsEnabled(true);
  const pending = playAimSound('welcome');
  assert.equal(starts, 0);
  releaseResume(); await pending;
  assert.equal(starts, 1, 'waits for gesture-initiated resume');
  assert.equal(fetches, 3, 'preloads each small clip once');
  await playAimSound('mail'); assert.equal(starts, 1, 'no notification chorus after welcome');
  clock += 12001;
  await playAimSound('mail'); assert.equal(starts, 2); assert.equal(stops, 1, 'stops preceding effect');
  await Promise.all([playAimSound('mail'), playAimSound('mail')]); assert.equal(starts, 2);

  documentMock.hidden = true;
  documentMock.dispatchEvent(new Event('visibilitychange'));
  assert.equal(stops, 2);
  await playAimSound('goodbye'); assert.equal(starts, 2, 'hidden pages are silent');
  documentMock.hidden = false;
  const mutedPending = playAimSound('goodbye');
  setAimSoundsEnabled(false); await mutedPending;
  assert.equal(starts, 2, 'mute invalidates pending effects');
  assert.equal(storage.get('2006-aim-sounds'), 'off');

  setAimSoundsEnabled(true);
  const stale = playAimSound('goodbye'); clock += 2000;
  releaseResume(); await stale;
  assert.equal(starts, 2, 'slow loading does not play a stale interaction');
  delayedResume = false;
  unlockAimSounds(); await playAimSound('goodbye');
  assert.equal(starts, 3);
  assert.equal(fetches, 3, 'decoded clips are reused');
  failStart = true;
  await assert.doesNotReject(playAimSound('welcome'), 'audio device errors never break app actions');
  storage.set('2006-aim-sounds', 'off');
  windowMock.dispatchEvent(Object.assign(new Event('storage'), { key: '2006-aim-sounds' }));
  assert.equal(aimSoundsEnabled(), false, 'mute syncs across tabs');
  assert.equal(changes, 4);
  unsubscribe(); Date.now = originalNow;

  for (const sound of ['welcome', 'mail', 'goodbye']) {
    const bytes = readFileSync(`public/2006/sounds/${sound}.mp3`);
    assert.ok(bytes.byteLength > 1000 && bytes.byteLength < 20000, `${sound} stays a small local asset`);
  }
  console.log('AIM sound lifecycle checks passed: gesture resume, persistence, mute races, hidden tabs, throttle, overlap, stale requests, failure recovery and assets.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
