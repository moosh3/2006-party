import assert from 'node:assert/strict';
import { SceneMusicPlayer, loopMusicPosition, type SceneMusicStatus } from '../lib/scene-music';

class FakeAudio {
  currentTime = 0;
  duration = 168;
  paused = true;
  loop = false;
  volume = 1;
  plays = 0;
  pauses = 0;
  loads = 0;
  rejection: Error | null = null;
  pendingResolve: (() => void) | null = null;
  defer = false;
  play() {
    this.plays++;
    if (this.rejection) return Promise.reject(this.rejection);
    this.paused = false;
    if (this.defer) return new Promise<void>(resolve => { this.pendingResolve = resolve; });
    return Promise.resolve();
  }
  pause() { this.paused = true; this.pauses++; }
  load() { this.loads++; }
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const active = { position: 180, playing: true, enabled: true, volume: 0.25 };

async function main() {
  assert.equal(loopMusicPosition(180, 168), 12);
  assert.equal(loopMusicPosition(336, 168), 0);
  assert.equal(loopMusicPosition(NaN, 168), 0);
  const audio = new FakeAudio();
  const statuses: SceneMusicStatus[] = [];
  const player = new SceneMusicPlayer(audio, state => statuses.push(state));
  player.update({ ...active, enabled: false });
  assert.equal(audio.plays, 0, 'The demo stays silent until enabled');
  player.update(active, true); await tick();
  assert.equal(audio.currentTime, 12, 'Late join follows the cue position modulo the song');
  assert.equal(audio.volume, 0.25); assert.equal(audio.loop, true);
  assert.equal(audio.plays, 1); assert.equal(statuses.at(-1), 'playing');
  audio.currentTime = 12.2;
  player.update({ ...active, position: 180.3 });
  assert.equal(audio.plays, 1, 'Snapshots/profile updates do not restart music');
  assert.equal(audio.currentTime, 12.2, 'Ordinary clock jitter does not repeatedly seek');
  player.update({ ...active, position: 201, playing: false });
  assert.equal(audio.paused, true); assert.equal(statuses.at(-1), 'paused');
  player.update({ ...active, position: 201 }); await tick();
  assert.equal(audio.currentTime, 33); assert.equal(audio.paused, false);
  player.update({ ...active, enabled: false });
  assert.equal(audio.paused, true); assert.equal(statuses.at(-1), 'muted');
  player.destroy(); player.update(active);
  assert.equal(audio.paused, true, 'Leaving the cue stops the music');

  const resultsAudio = new FakeAudio();
  resultsAudio.duration = 20.317460;
  const resultsPlayer = new SceneMusicPlayer(resultsAudio, () => {});
  resultsPlayer.update({ ...active, position: 0, enabled: false });
  assert.equal(resultsAudio.plays, 0, 'Switching to the results demo also starts silent');
  resultsPlayer.update({ ...active, position: 0 }, true); await tick();
  for (const position of [10, 20, 30, 40, 50]) {
    // The media element advances naturally while the score cards change every 10 seconds.
    resultsAudio.currentTime = position % resultsAudio.duration;
    resultsPlayer.update({ ...active, position }); await tick();
    assert.equal(resultsAudio.plays, 1, 'Changing result cards must not restart the song');
  }
  resultsPlayer.update({ ...active, position: 45, playing: false });
  assert.ok(Math.abs(resultsAudio.currentTime - 4.36508) < 0.00001, 'Seek/pause wraps the short results loop');
  resultsPlayer.destroy();
  assert.equal(resultsAudio.paused, true, 'Results music stops when the cue ends');
  assert.equal(audio.paused, true, 'The previous Rules track remains stopped');

  const blockedAudio = new FakeAudio();
  const blockedStates: SceneMusicStatus[] = [];
  blockedAudio.rejection = Object.assign(new Error('gesture required'), { name: 'NotAllowedError' });
  const blocked = new SceneMusicPlayer(blockedAudio, state => blockedStates.push(state));
  blocked.update(active); await tick();
  assert.equal(blockedStates.at(-1), 'blocked');
  blocked.update(active); blocked.update(active);
  assert.equal(blockedAudio.plays, 1, 'Blocked autoplay does not retry on every clock tick');
  blockedAudio.rejection = null; blocked.update(active, true); await tick();
  assert.equal(blockedAudio.plays, 2); assert.equal(blockedStates.at(-1), 'playing');
  blocked.fail(); assert.equal(blockedAudio.paused, true); assert.equal(blockedStates.at(-1), 'error');
  blocked.update(active, true); await tick(); assert.equal(blockedAudio.loads, 1, 'Retry reloads failed media');
  blocked.destroy();

  for (const exit of ['pause', 'unmount']) {
    const delayedAudio = new FakeAudio(); delayedAudio.defer = true;
    const delayed = new SceneMusicPlayer(delayedAudio, () => {});
    delayed.update(active);
    if (exit === 'pause') delayed.update({ ...active, playing: false }); else delayed.destroy();
    delayedAudio.paused = false; delayedAudio.pendingResolve!(); await tick();
    assert.equal(delayedAudio.paused, true, `A late play promise cannot restart after ${exit}`);
    delayed.destroy();
  }
  console.log('PASS scene music: silent demo, full-track looping, late join, continuous profiles, pause/resume/mute, autoplay retry, loading failure and async cleanup.');
}
void main();
