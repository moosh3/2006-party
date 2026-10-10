// This output intentionally has no connection to the online show or its queue.
// The local operator addresses one explicit output ID to avoid duplicate audio.
const outputId = crypto.randomUUID();
const channel = new BroadcastChannel('2006-room-player');
const cueVideo = document.getElementById('cue-video');
const cueImage = document.getElementById('cue-image');
const holdVideo = document.getElementById('hold-video');
const holdImage = document.getElementById('hold-image');
const holdLayer = document.getElementById('hold-layer');
const cueLayer = document.getElementById('cue-layer');
const blackLayer = document.getElementById('black-layer');
const fallback = document.getElementById('holding-fallback');
const setup = document.getElementById('output-setup');
const armButton = document.getElementById('arm-output');
const setupMessage = document.getElementById('setup-message');
const soundAudio = document.getElementById('sound-audio');

let revision = -1;
let runId = null;
let statusstate = 'idle';
let armed = false;
let disposed = false;
let captions = true;
let hold = null;
let currentCue = null;
let lastCue = null;
let cueToken = 0;
let holdToken = 0;
let cueAbort = null;
let holdAbort = null;
let cueHasEnded = false;
let shouldPlayCue = false;
let lastStartedKey = '';
let holdKey = null;
let setupWarning = '';
let soundRevision = -1;
let soundRunId = null;
let soundId = null;
let soundStatus = 'idle';
let soundError = '';
let soundToken = 0;
let soundAbort = null;
let soundTrimTimer = null;
let activeSound = null;
let soundLastTime = 0;

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|ogv)$/i;
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
const SOUND_VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm)$/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const COMMAND_ACTIONS = new Set(['play', 'hold', 'black', 'pause', 'resume', 'restart', 'captions', 'configure', 'close']);

function snapshot() {
  const finite = (value) => Number.isFinite(value) ? value : 0;
  return {
    outputId,
    revision,
    runId,
    armed,
    statusstate,
    currentTime: currentCue?.kind === 'video' ? finite(cueVideo.currentTime) : 0,
    duration: currentCue?.kind === 'video' ? finite(cueVideo.duration) : 0,
    fullscreen: Boolean(document.fullscreenElement),
    visibility: document.visibilityState,
    setupWarning,
    soundState: {
      revision: soundRevision,
      runId: soundRunId,
      soundId,
      status: soundStatus,
      error: soundError,
      currentTime: finite(activeSound ? soundAudio.currentTime : soundLastTime),
    },
  };
}

function send(type, values = {}) {
  if (!disposed) channel.postMessage({ type, ...snapshot(), ...values });
}

function started() {
  const key = `${revision}:${runId}`;
  if (key === lastStartedKey) return;
  lastStartedKey = key;
  send('started');
}

function setState(next) {
  statusstate = next;
  send('status');
}

function showLayer(layer) {
  for (const candidate of [holdLayer, cueLayer, blackLayer]) {
    candidate.hidden = candidate !== layer;
    candidate.classList.toggle('is-visible', candidate === layer);
  }
}

function mediaUrl(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.includes('\0')) {
    throw new Error('Choose a file from the local media folder.');
  }
  const segments = file.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..') || /^[a-z][a-z\d+.-]*:/i.test(file)) {
    throw new Error('Media must stay inside the local media folder.');
  }
  return new URL(`/media/${segments.map(encodeURIComponent).join('/')}`, location.origin).href;
}

function clearMedia(media) {
  media.pause();
  media.removeAttribute('src');
  media.load();
}

function stopCue() {
  cueToken += 1;
  shouldPlayCue = false;
  cueAbort?.abort();
  cueAbort = null;
  currentCue = null;
  cueHasEnded = false;
  clearMedia(cueVideo);
  cueVideo.replaceChildren();
  cueVideo.hidden = true;
  cueImage.removeAttribute('src');
  cueImage.hidden = true;
}

function stopHold() {
  holdToken += 1;
  holdAbort?.abort();
  holdAbort = null;
  holdVideo.pause();
  holdVideo.hidden = true;
  holdImage.hidden = true;
}

function waitUntilReady(media, signal, mediaName = 'video') {
  if (media.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      media.removeEventListener('loadeddata', ready);
      media.removeEventListener('canplay', ready);
      media.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
      error ? reject(error) : resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error(`The browser could not read this local ${mediaName}. Check the file and codec.`));
    const aborted = () => finish(new DOMException('Superseded cue', 'AbortError'));
    const timer = setTimeout(() => finish(new Error(`The local ${mediaName} did not load. Check that the file is available.`)), 12000);
    media.addEventListener('loadeddata', ready);
    media.addEventListener('canplay', ready);
    media.addEventListener('error', failed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

function loadImage(image, url, signal) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      image.removeEventListener('load', ready);
      image.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
      error ? reject(error) : resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error('The browser could not read this local image.'));
    const aborted = () => finish(new DOMException('Superseded cue', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('The local image did not load. Check that the file is available.')), 12000);
    image.addEventListener('load', ready);
    image.addEventListener('error', failed);
    signal.addEventListener('abort', aborted, { once: true });
    image.src = url;
    if (signal.aborted) aborted();
    else if (image.complete && image.naturalWidth > 0) ready();
  });
}

function playWithDeadline(media, signal, mediaName = 'video') {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      error ? reject(error) : resolve();
    };
    const aborted = () => finish(new DOMException('Superseded cue', 'AbortError'));
    const timer = setTimeout(() => finish(new Error(`Playback did not start. Check browser sound permission and the local ${mediaName} file.`)), 12000);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    try { Promise.resolve(media.play()).then(() => finish(), finish); }
    catch (error) { finish(error); }
  });
}

function stopSound(nextStatus = 'stopped', report = true) {
  soundToken += 1;
  if (activeSound && Number.isFinite(soundAudio.currentTime)) soundLastTime = soundAudio.currentTime;
  activeSound = null;
  soundAbort?.abort();
  soundAbort = null;
  clearTimeout(soundTrimTimer);
  soundTrimTimer = null;
  soundAudio.muted = true;
  clearMedia(soundAudio);
  soundStatus = nextStatus;
  soundError = '';
  if (report) send('status');
}

function soundEvent(type, values = {}) {
  send(type, { soundRevision, soundRunId, soundId, ...values });
}

function soundFailed(error, token) {
  if (disposed || token !== soundToken || error?.name === 'AbortError') return;
  stopSound('error', false);
  soundError = error?.message || 'The local sound could not be played.';
  soundEvent('sound-error', { error: soundError });
}

function finishSound(token) {
  if (disposed || token !== soundToken || soundStatus !== 'playing' || !activeSound) return;
  stopSound('ended', false);
  soundEvent('sound-ended');
}

function seekSoundStart(start, signal) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      soundAudio.removeEventListener('seeked', ready);
      soundAudio.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
      error ? reject(error) : resolve();
    };
    const ready = () => {
      if (soundAudio.seeking) return;
      if (!Number.isFinite(soundAudio.currentTime) || Math.abs(soundAudio.currentTime - start) > 0.04) {
        finish(new Error('The browser could not seek to this sound’s start time.'));
      } else finish();
    };
    const failed = () => finish(new Error('The local sound could not be decoded while seeking.'));
    const aborted = () => finish(new DOMException('Superseded sound', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Seeking the sound timed out. Check its start time and local file.')), 5000);
    soundAudio.addEventListener('seeked', ready);
    soundAudio.addEventListener('error', failed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    try {
      soundAudio.currentTime = start;
      if (!soundAudio.seeking) ready();
    } catch {
      finish(new Error('The browser could not seek to this sound’s start time.'));
    }
  });
}

async function playSound(sound) {
  stopSound('loading', false);
  soundId = typeof sound?.id === 'string' ? sound.id : null;
  soundLastTime = 0;
  const token = soundToken;
  const abort = new AbortController();
  soundAbort = abort;
  send('status');
  try {
    if (!armed) throw new Error('Enable sound & fullscreen in the room output before playing a sound.');
    if (!sound || typeof sound.id !== 'string' || !sound.id || typeof sound.label !== 'string' || !sound.label) {
      throw new Error('The selected sound is incomplete.');
    }
    if (!Number.isFinite(sound.startSeconds) || sound.startSeconds < 0) throw new Error('Sound start time must be zero or greater.');
    if (!Number.isFinite(sound.durationSeconds) || sound.durationSeconds < 0.1 || sound.durationSeconds > 30) {
      throw new Error('Sound duration must be between 0.1 and 30 seconds.');
    }
    if (!Number.isFinite(sound.volume) || sound.volume < 0 || sound.volume > 1) throw new Error('Sound volume must be between 0 and 1.');
    const url = mediaUrl(sound.file);
    if (!AUDIO_EXTENSIONS.test(sound.file) && !SOUND_VIDEO_EXTENSIONS.test(sound.file)) {
      throw new Error('Choose a local audio or video file for the sound.');
    }
    activeSound = { ...sound, endSeconds: sound.startSeconds + sound.durationSeconds };
    soundAudio.muted = true;
    soundAudio.loop = false;
    soundAudio.volume = sound.volume;
    soundAudio.src = url;
    soundAudio.load();
    await waitUntilReady(soundAudio, abort.signal, 'sound');
    if (disposed || token !== soundToken) return;
    if (!Number.isFinite(soundAudio.duration) || soundAudio.duration <= 0 || activeSound.endSeconds > soundAudio.duration) {
      throw new Error('The sound’s start time and duration must fit inside the local file.');
    }
    await seekSoundStart(sound.startSeconds, abort.signal);
    if (disposed || token !== soundToken) return;
    // Do not make any audio audible until the requested trim has been validated.
    soundAudio.muted = false;
    await playWithDeadline(soundAudio, abort.signal, 'sound');
    if (disposed || token !== soundToken) return;
    soundStatus = 'playing';
    const remaining = Math.max(0, activeSound.endSeconds - soundAudio.currentTime);
    soundTrimTimer = setTimeout(() => finishSound(token), Math.min(sound.durationSeconds, remaining) * 1000);
    soundEvent('sound-started');
    if (soundAudio.ended || soundAudio.currentTime >= activeSound.endSeconds) finishSound(token);
  } catch (error) {
    soundFailed(error, token);
  }
}

function handleSoundCommand(command) {
  if (command.targetOutputId !== outputId || !['play', 'stop'].includes(command.action)) return;
  if (!Number.isSafeInteger(command.soundRevision) || command.soundRevision < 0 || command.soundRevision <= soundRevision) return;
  if (typeof command.soundRunId !== 'string' || !UUID_PATTERN.test(command.soundRunId)) return;
  soundRevision = command.soundRevision;
  soundRunId = command.soundRunId;
  if (command.action === 'stop') stopSound();
  else void playSound(command.sound);
}

function soundTimeUpdated() {
  if (activeSound && soundStatus === 'playing' && soundAudio.currentTime >= activeSound.endSeconds) finishSound(soundToken);
}

function soundEnded() {
  if (soundAudio.ended) finishSound(soundToken);
}

function soundDecodeError() {
  if (activeSound && soundAudio.error) soundFailed(new Error('Playback stopped because the local sound could not be decoded.'), soundToken);
}

function updateCaptionMode() {
  for (const track of cueVideo.textTracks) track.mode = captions ? 'showing' : 'disabled';
}

function installCaptions(cue) {
  if (!cue.captionFile) return;
  const track = document.createElement('track');
  track.kind = 'captions';
  track.label = 'Captions';
  track.srclang = 'en';
  track.default = captions;
  track.src = mediaUrl(cue.captionFile);
  track.addEventListener('load', updateCaptionMode);
  track.addEventListener('error', () => {
    if (currentCue === cue) send('caption-error', { error: 'The local caption file could not be loaded.' });
  });
  cueVideo.append(track);
  updateCaptionMode();
}

async function showHolding(nextState = 'holding') {
  showLayer(holdLayer);
  setState(nextState);
  const nextFile = typeof hold?.file === 'string' ? hold.file : null;
  // Returning to an already-running loop must not restart it unnecessarily.
  if (holdKey === nextFile && nextFile && (holdVideo.hidden === false || holdImage.hidden === false)) {
    if (!holdVideo.hidden && holdVideo.paused && armed) {
      try { await holdVideo.play(); } catch { holdVideo.hidden = true; fallback.hidden = false; }
    }
    return;
  }
  stopHold();
  holdKey = nextFile;
  fallback.hidden = false;
  if (!nextFile) return;
  const token = holdToken;
  const abort = new AbortController();
  holdAbort = abort;
  try {
    const url = mediaUrl(nextFile);
    if (VIDEO_EXTENSIONS.test(nextFile)) {
      holdVideo.muted = true;
      holdVideo.loop = true;
      holdVideo.src = url;
      holdVideo.load();
      await waitUntilReady(holdVideo, abort.signal);
      if (disposed || token !== holdToken) return;
      await playWithDeadline(holdVideo, abort.signal);
      if (disposed || token !== holdToken) return;
      holdVideo.hidden = false;
    } else if (IMAGE_EXTENSIONS.test(nextFile)) {
      await loadImage(holdImage, url, abort.signal);
      if (disposed || token !== holdToken) return;
      holdImage.hidden = false;
    } else {
      throw new Error('Use a local video, GIF, or image for the holding screen.');
    }
    fallback.hidden = true;
  } catch (error) {
    if (disposed || token !== holdToken || error.name === 'AbortError') return;
    holdVideo.pause();
    holdVideo.hidden = true;
    holdImage.hidden = true;
    fallback.hidden = false;
    send('hold-error', { error: error.message || 'The holding screen could not be played.' });
  }
}

function cueFailed(error, token) {
  if (disposed || token !== cueToken || error.name === 'AbortError') return;
  const event = { outputId, runId, revision, error: error.message || 'The cue could not be played.' };
  stopCue();
  void showHolding();
  send('error', event);
}

async function playCue(cue) {
  stopCue();
  shouldPlayCue = true;
  const token = cueToken;
  const abort = new AbortController();
  cueAbort = abort;
  currentCue = cue;
  lastCue = cue;
  if (!armed) {
    cueFailed(new Error('Enable sound & fullscreen in the room output before pressing GO.'), token);
    return;
  }
  if (cue.kind === 'live') {
    void showHolding('live');
    started();
    return;
  }
  void showHolding('loading');
  try {
    const url = mediaUrl(cue.file);
    if (cue.kind === 'image') {
      await loadImage(cueImage, url, abort.signal);
      if (disposed || token !== cueToken) return;
      stopHold();
      cueImage.hidden = false;
      showLayer(cueLayer);
      setState('playing');
      started();
      return;
    }
    if (cue.kind !== 'video') throw new Error('Unknown cue type.');
    cueVideo.muted = false;
    cueVideo.loop = false;
    cueVideo.src = url;
    installCaptions(cue);
    cueVideo.load();
    await waitUntilReady(cueVideo, abort.signal);
    if (disposed || token !== cueToken) return;
    if (shouldPlayCue) await playWithDeadline(cueVideo, abort.signal);
    if (disposed || token !== cueToken) return;
    if (!shouldPlayCue) cueVideo.pause();
    stopHold();
    cueVideo.hidden = false;
    showLayer(cueLayer);
    updateCaptionMode();
    setState(shouldPlayCue ? 'playing' : 'paused');
    if (shouldPlayCue) started();
  } catch (error) {
    cueFailed(error, token);
  }
}

function cueEnded() {
  if (!currentCue || currentCue.kind !== 'video' || !cueVideo.ended || cueHasEnded) return;
  cueHasEnded = true;
  const event = { outputId, runId, revision };
  // The audience always gets a holding screen even if the operator has closed.
  stopCue();
  void showHolding();
  send('ended', event);
}

function handlePlaybackError() {
  if (!currentCue || currentCue.kind !== 'video' || !cueVideo.error) return;
  cueFailed(new Error('Playback stopped because the local video could not be decoded.'), cueToken);
}

function handleHoldError() {
  if (holdLayer.hidden || !holdVideo.error) return;
  stopHold();
  fallback.hidden = false;
  send('hold-error', { error: 'The holding video could not be decoded. The default holding screen is being shown.' });
}

async function resumeCue() {
  if (!currentCue || currentCue.kind !== 'video' || statusstate !== 'paused') return;
  shouldPlayCue = true;
  const token = cueToken;
  try {
    await playWithDeadline(cueVideo, cueAbort.signal);
    if (disposed || token !== cueToken) return;
    if (!shouldPlayCue) { cueVideo.pause(); return; }
    setState('playing');
    started();
  } catch (error) {
    cueFailed(error, token);
  }
}

function handleCommand(event) {
  const command = event.data;
  if (command?.type === 'sound-command') { handleSoundCommand(command); return; }
  if (!command || command.type !== 'command' || command.targetOutputId !== outputId || !COMMAND_ACTIONS.has(command.action)) return;
  if (!Number.isSafeInteger(command.revision) || command.revision < 0 || command.revision < revision) return;
  const settingsOnly = command.action === 'configure' || command.action === 'captions';
  if (!settingsOnly && command.revision === revision) return;
  if (settingsOnly) {
    if (Object.hasOwn(command, 'hold')) hold = command.hold;
    if (typeof command.captions === 'boolean') captions = command.captions;
    updateCaptionMode();
    if (command.action === 'configure' && command.refreshHold === true) {
      // A newly mounted folder may contain different bytes at the same URL.
      // Invalidate only holding media; an active cue or sound stays untouched.
      holdKey = null;
      stopHold();
      if (armed && !holdLayer.hidden) void showHolding(statusstate);
    }
    send('status');
    return;
  }
  revision = command.revision;
  runId = typeof command.runId === 'string' ? command.runId : null;
  if (Object.hasOwn(command, 'hold')) hold = command.hold;
  if (typeof command.captions === 'boolean') captions = command.captions;
  switch (command.action) {
    case 'play':
      if (!command.cue || typeof command.cue.id !== 'string' || typeof command.cue.label !== 'string') {
        cueFailed(new Error('The selected cue is incomplete.'), cueToken);
      } else void playCue(command.cue);
      break;
    case 'hold':
      stopCue();
      void showHolding();
      break;
    case 'black':
      stopCue();
      stopHold();
      stopSound();
      showLayer(blackLayer);
      setState('black');
      break;
    case 'pause':
      if (currentCue?.kind === 'video') {
        shouldPlayCue = false;
        cueVideo.pause();
        setState('paused');
      } else send('status');
      break;
    case 'resume':
      void resumeCue();
      break;
    case 'restart':
      if (command.cue || currentCue || lastCue) void playCue(command.cue || currentCue || lastCue);
      else send('status');
      break;
    case 'close':
      // A blocked window.close() must still leave a silent, black audience view.
      stopCue();
      stopHold();
      stopSound();
      showLayer(blackLayer);
      setState('black');
      dispose();
      try { window.close(); } catch { /* This browser may require manual closing. */ }
      break;
  }
}

function armOutput() {
  const wasArmed = armed;
  armed = true;
  setup.hidden = true;
  cueVideo.muted = false;
  // Fullscreen must be requested synchronously inside this real user gesture.
  try {
    if (document.documentElement.requestFullscreen) {
      const fullscreen = document.documentElement.requestFullscreen();
      fullscreen?.catch(() => {
        setupWarning = 'Fullscreen was blocked. Use this browser’s fullscreen control on the audience display.';
        setup.hidden = false;
        armButton.textContent = 'Try fullscreen again';
        setupMessage.textContent = setupWarning;
        send('status');
      });
    } else setupWarning = 'This browser does not support fullscreen for this window.';
  } catch {
    setupWarning = 'Fullscreen was blocked. Use this browser’s fullscreen control on the audience display.';
  }
  if (!wasArmed) void showHolding();
  send('armed');
}

function reportDisplayState(event) {
  if (event.type === 'fullscreenchange' && armed) {
    setup.hidden = Boolean(document.fullscreenElement);
    armButton.textContent = 'Return to fullscreen';
    setupMessage.textContent = 'Fullscreen ended. Playback keeps its position; click to return to the audience view.';
  }
  send('status');
}

function dispose() {
  if (disposed) return;
  stopSound('stopped', false);
  send('closed');
  disposed = true;
  clearInterval(heartbeat);
  cueAbort?.abort();
  holdAbort?.abort();
  cueVideo.pause();
  holdVideo.pause();
  channel.removeEventListener('message', handleCommand);
  channel.close();
  armButton.removeEventListener('click', armOutput);
  cueVideo.removeEventListener('ended', cueEnded);
  cueVideo.removeEventListener('error', handlePlaybackError);
  holdVideo.removeEventListener('error', handleHoldError);
  soundAudio.removeEventListener('timeupdate', soundTimeUpdated);
  soundAudio.removeEventListener('ended', soundEnded);
  soundAudio.removeEventListener('error', soundDecodeError);
  document.removeEventListener('fullscreenchange', reportDisplayState);
  document.removeEventListener('visibilitychange', reportDisplayState);
}

channel.addEventListener('message', handleCommand);
armButton.addEventListener('click', armOutput);
cueVideo.addEventListener('ended', cueEnded);
cueVideo.addEventListener('error', handlePlaybackError);
holdVideo.addEventListener('error', handleHoldError);
soundAudio.addEventListener('timeupdate', soundTimeUpdated);
soundAudio.addEventListener('ended', soundEnded);
soundAudio.addEventListener('error', soundDecodeError);
document.addEventListener('fullscreenchange', reportDisplayState);
document.addEventListener('visibilitychange', reportDisplayState);
window.addEventListener('pagehide', dispose, { once: true });
const heartbeat = setInterval(() => send('hello'), 1000);
send('hello');
