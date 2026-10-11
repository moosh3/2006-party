/** Optional audience UI effects; completely separate from program media volume. */
export type AimSound = 'welcome' | 'mail' | 'goodbye';
const KEY = '2006-aim-sounds';
const CHANGE = '2006-aim-sounds-change';
let context: AudioContext | null = null;
let resume: Promise<void> | null = null;
let enabled = true;
let initialized = false;
let generation = 0;
let active: AudioBufferSourceNode | null = null;
let lastPlayed = -Infinity;
const buffers = new Map<AimSound, Promise<AudioBuffer | null>>();

export function aimSoundsEnabled() {
  if (typeof window === 'undefined') return true;
  if (!initialized) {
    try { enabled = localStorage.getItem(KEY) !== 'off'; } catch { /* In-memory preference still works. */ }
    initialized = true;
    window.addEventListener('storage', event => {
      if (event.key === KEY || event.key === null) {
        try { enabled = localStorage.getItem(KEY) !== 'off'; } catch { return; }
        stopAimSound(); window.dispatchEvent(new Event(CHANGE));
      }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopAimSound(); });
  }
  return enabled;
}
export function subscribeAimSounds(callback: () => void) {
  window.addEventListener(CHANGE, callback);
  return () => window.removeEventListener(CHANGE, callback);
}
function stopAimSound() {
  generation++;
  try { active?.stop(); } catch { /* It may have finished. */ }
  active = null;
}
export function setAimSoundsEnabled(value: boolean) {
  aimSoundsEnabled(); enabled = value;
  try { localStorage.setItem(KEY, value ? 'on' : 'off'); } catch { /* Optional storage. */ }
  if (!value) stopAimSound();
  else unlockAimSounds();
  window.dispatchEvent(new Event(CHANGE));
}
function load(sound: AimSound): Promise<AudioBuffer | null> {
  if (!context) return Promise.resolve(null);
  const currentContext = context;
  if (!buffers.has(sound)) {
    buffers.set(sound, fetch(`/2006/sounds/${sound}.mp3`).then(async response => {
      if (!response.ok) throw new Error('Sound unavailable');
      return currentContext.decodeAudioData(await response.arrayBuffer());
    }).catch(() => { buffers.delete(sound); return null; }));
  }
  return buffers.get(sound)!;
}
/** Call directly from a click/submit so browsers can unlock audio before async work. */
export function unlockAimSounds() {
  if (!aimSoundsEnabled() || typeof window === 'undefined') return;
  try {
    context ??= new AudioContext();
    resume = context.resume().catch(() => {});
    for (const sound of ['welcome', 'mail', 'goodbye'] as const) void load(sound);
  } catch { /* Audio restrictions never block signing in or chatting. */ }
}
export async function playAimSound(sound: AimSound) {
  if (!aimSoundsEnabled() || !context || document.hidden) return;
  const requestedAt = Date.now();
  if (sound === 'mail' && requestedAt - lastPlayed < 12000) return;
  const version = generation;
  try {
    // Resume is requested synchronously by the original user gesture.
    await resume;
    const buffer = await load(sound);
    if (!buffer || !enabled || generation !== version || document.hidden || context.state !== 'running' || Date.now() - requestedAt > 1500) return;
    if (sound === 'mail' && Date.now() - lastPlayed < 12000) return;
    stopAimSound();
    const source = context.createBufferSource();
    const volume = context.createGain();
    volume.gain.value = sound === 'mail' ? 0.12 : 0.22;
    source.buffer = buffer;
    source.connect(volume);
    volume.connect(context.destination);
    source.onended = () => {
      source.disconnect();
      volume.disconnect();
      if (active === source) active = null;
    };
    active = source;
    source.start();
    lastPlayed = Date.now();
  } catch { /* Optional effects must never interrupt the audience experience. */ }
}
