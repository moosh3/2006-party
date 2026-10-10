import { createInitialState, selectCue, beginCue, handleOutputEvent, hold, blackout, pause, resume, restart, reset, setOutput, updateRundown } from './state.mjs';

const $ = (id) => document.getElementById(id);
const channel = new BroadcastChannel('2006-room-player');
const outputs = new Map();
let show, state, library = { directory: '', files: [], warnings: [] };
let selectedId = null;
let busy = false;
let preflightRunning = false;
let controller = false;
let noticeTimer;
let soundRevision = 0;
let soundState = { revision:0, runId:null, soundId:null, status:'idle' };
const readiness = new Map();

function notice(message, error = false) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message;
  $('notice').hidden = false;
  $('notice').classList.toggle('is-error', error);
  if (!error) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 7000);
}

async function api(path, data) {
  const response = await fetch(path, data === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Room-Player': '1' }, body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The local player could not complete that action.');
  return result;
}

function mediaUrl(file) { return '/media/' + file.split('/').map(encodeURIComponent).join('/'); }
function getCue(id) { return show?.cues.find((cue) => cue.id === id); }
function time(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function selectedOutput() { return outputs.get(state?.outputId); }
function outputReady() {
  const output = selectedOutput();
  return output?.armed && performance.now() - output.seenAt < 3500;
}
function isEditingSafe() { return Boolean(show && state) && controller && !busy && !preflightRunning && !['loading', 'playing', 'paused'].includes(state.status) && !['loading','playing'].includes(soundState.status); }
function getSounds() { return show?.sounds || []; }
function soundFile(sound) { return library.files.find((file) => file.path === sound.file && ['audio','video'].includes(file.kind)); }
function soundIssue(sound) {
  if (!sound.file) return 'Choose a local file first.';
  if (!soundFile(sound)) return 'Sound file is missing from the selected folder.';
  const result = readiness.get(sound.file);
  if (result?.error) return result.error;
  if (result?.duration && sound.startSeconds + sound.durationSeconds > result.duration + 0.05) return 'The selected sound extends past the end of its file.';
  return '';
}
function playSound(sound) {
  if (!controller || busy || preflightRunning || !outputReady() || !sound || soundIssue(sound)) return;
  soundRevision += 1;
  soundState = { revision:soundRevision, runId:crypto.randomUUID(), soundId:sound.id, status:'loading' };
  channel.postMessage({ type:'sound-command', targetOutputId:state.outputId, soundRevision, soundRunId:soundState.runId, action:'play', sound:{...sound} });
  renderPlayout();
}
function stopSound(allowStale = false) {
  if (!controller || !state?.outputId || !selectedOutput() || (allowStale !== true && performance.now() - selectedOutput().seenAt >= 3500)) return;
  soundRevision += 1;
  soundState = { revision:soundRevision, runId:crypto.randomUUID(), soundId:null, status:'stopped' };
  channel.postMessage({ type:'sound-command', targetOutputId:state.outputId, soundRevision, soundRunId:soundState.runId, action:'stop' });
  renderPlayout();
}
function renderSoundControls() {
  const ready = outputReady();
  for (const button of $('sound-pads').querySelectorAll('button')) {
    const sound = getSounds().find((item) => item.id === button.dataset.soundId);
    const issue = sound && soundIssue(sound);
    button.disabled = !controller || busy || preflightRunning || !ready || !sound || Boolean(issue);
    button.classList.toggle('is-playing', sound?.id === soundState.soundId && ['loading','playing'].includes(soundState.status));
    button.querySelector('span').textContent = issue || `${sound.durationSeconds}s · from ${sound.startSeconds}s · ${Math.round(sound.volume * 100)}% volume`;
  }
  const playing = ['loading','playing'].includes(soundState.status);
  const selected = getSounds().find((sound) => sound.id === soundState.soundId);
  $('stop-sound').disabled = !controller || !ready || !playing;
  $('sound-status').textContent = !ready ? 'Enable sound in the audience window before playing a sound.' : soundState.status === 'error' ? `Sound failed: ${soundState.error || 'Check the file and try again.'}` : playing ? `${soundState.status === 'loading' ? 'Starting' : 'Playing'}: ${selected?.label || 'sound'}. Press again to restart.` : soundState.status === 'ended' ? 'Sound finished. Ready to play again.' : soundState.status === 'stopped' ? 'Sound stopped.' : getSounds().some((sound) => sound.file) ? 'Ready. Sound plays through the audience window’s speakers.' : 'No clip installed. Choose your local source under Set up first sound.';
  const editable = isEditingSafe() && getSounds().length > 0;
  for (const id of ['sound-file','sound-start','sound-duration','sound-volume']) $(id).disabled = !editable;
  $('sound-form').querySelector('button').disabled = !editable;
}
function renderSoundboard() {
  const fragment = document.createDocumentFragment();
  getSounds().forEach((sound, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'sound-pad'; button.dataset.soundId = sound.id;
    button.append(document.createTextNode(`${index === 0 ? '1 · ' : ''}${sound.label}`), document.createElement('span'));
    button.addEventListener('click', () => playSound(sound)); fragment.append(button);
  });
  $('sound-pads').replaceChildren(fragment);
  const first = getSounds()[0];
  populateSelect($('sound-file'), library.files.filter((file) => ['audio','video'].includes(file.kind)), first?.file, 'Choose a file — no sound installed');
  $('sound-start').value = first?.startSeconds ?? 0;
  $('sound-duration').value = first?.durationSeconds ?? 3;
  $('sound-volume').value = Math.round((first?.volume ?? 1) * 100);
  renderSoundControls();
}
function withSettings(command) {
  if (!command) return;
  const result = { ...command, hold: show.hold, captions: show.captions };
  if (result.cue?.file) {
    const matching = result.cue.captionFile || result.cue.file.replace(/\.[^.]+$/, '.vtt');
    const track = library.files.find((file) => file.path === matching && file.kind === 'captions')
      || library.files.find((file) => file.path.toLowerCase() === matching.toLowerCase() && file.kind === 'captions');
    result.cue = { ...result.cue, captionFile:track?.path || '' };
  }
  return result;
}
function configureOutput(refreshHold = false) {
  if (!state?.outputId) return;
  channel.postMessage(withSettings({ type: 'command', targetOutputId: state.outputId, revision: state.revision, runId: state.runId, action: 'configure', ...(refreshHold ? {refreshHold:true} : {}) }));
}
function apply(result) {
  state = result.state;
  if (result.command) channel.postMessage(withSettings(result.command));
  renderPlayout();
  renderRundown();
}

function renderPlayout() {
  if (!show || !state) return;
  const current = getCue(state.activeCueId);
  const next = getCue(state.nextCueId);
  const output = selectedOutput();
  const fresh = output && performance.now() - output.seenAt < 3500;
  $('output-status').textContent = !fresh ? 'Audience window not connected' : !output.armed ? 'Audience window connected — enable sound there' : output.fullscreen ? 'Audience output ready · fullscreen' : 'Audience output ready · enter fullscreen there';
  $('output-status').parentElement.classList.toggle('is-ready', Boolean(outputReady()));
  $('output-time').textContent = fresh && ['playing','paused'].includes(output.statusstate) && output.duration > 0 ? `${time(output.currentTime)} / ${time(output.duration)}` : '—';
  const holding = ['holding', 'ended', 'error'].includes(state.status);
  $('now-label').textContent = state.status === 'black' ? 'Blackout' : holding ? 'Holding screen' : current?.label || 'Holding screen';
  $('now-notes').textContent = state.error || (holding && current ? `Last cue: ${current.label}` : current?.notes || 'Live scenes wait for your GO.');
  const labels = { holding:'Holding · wait for GO', ended:'Video finished · wait for GO', black:'Blackout', loading:'Starting cue…', playing:current?.kind === 'image' ? 'Image · wait for GO' : 'Playing', paused:'Paused', live:'Live scene · wait for GO', error:'Playback failed · holding screen' };
  $('playback-status').textContent = labels[state.status] || state.status;
  $('next-label').textContent = next?.label || 'End of rundown';
  $('next-notes').textContent = next?.notes || '';
  $('go-label').textContent = next?.label || 'No next cue';
  const missing = next && next.kind !== 'live' && !library.files.some((file) => file.path === next.file && file.kind === next.kind);
  const failed = next?.file && readiness.get(next.file)?.error;
  $('go').disabled = !controller || busy || preflightRunning || !outputReady() || !next || state.status === 'loading' || Boolean(missing || failed);
  $('go-help').textContent = !outputReady() ? 'Open the audience window and enable sound there before GO.' : missing ? 'Choose a valid local file for the next cue before GO.' : failed ? `File check failed: ${failed}` : 'Space = GO · H = Hold · B = Blackout. Keys are ignored while typing.';
  $('pause').textContent = state.status === 'paused' ? 'Resume' : 'Pause';
  $('pause').disabled = !outputReady() || !['playing','paused'].includes(state.status) || current?.kind !== 'video';
  $('restart').disabled = busy || !outputReady() || !current || state.status === 'loading';
  $('close-output').disabled = !fresh;
  const safe = isEditingSafe();
  for (const id of ['add-cue','directory','hold-file','captions','import-show','move-up','move-down','delete-cue','confirm-delete','cue-label','cue-kind','cue-file','cue-notes','cue-end']) $(id).disabled = !safe;
  $('directory-form').querySelector('button').disabled = !safe;
  $('cue-form').querySelector('button[type="submit"]').disabled = !safe || !selectedId;
  $('cue-file').disabled = !safe || $('cue-kind').value === 'live';
  $('cue-end').disabled = !safe || $('cue-kind').value !== 'video';
  $('preflight').disabled = busy || preflightRunning || !safe;
  $('preflight').textContent = preflightRunning ? 'Checking files…' : 'Check show files';
  renderSoundControls();
}

function renderRundown() {
  if (!show) return;
  const fragment = document.createDocumentFragment();
  show.cues.forEach((cue, index) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.toggle('is-next', cue.id === state.nextCueId);
    button.classList.toggle('is-current', cue.id === state.activeCueId);
    button.setAttribute('aria-pressed', String(cue.id === selectedId));
    const number = document.createElement('span'); number.className = 'cue-number'; number.textContent = String(index + 1).padStart(2, '0');
    const text = document.createElement('span');
    const title = document.createElement('span'); title.className = 'cue-title'; title.textContent = cue.label;
    const detail = document.createElement('span'); detail.className = 'cue-detail';
    detail.textContent = [cue.id === state.nextCueId ? 'NEXT' : cue.id === state.activeCueId ? 'CURRENT' : '', cue.kind === 'live' ? 'Live / hold' : cue.file || 'File not assigned', cue.kind === 'video' && cue.endAction === 'next' ? 'Auto-follow' : ''].filter(Boolean).join(' · ');
    text.append(title, detail); button.append(number, text);
    button.addEventListener('click', () => {
      if (state.status === 'loading') return notice('Wait for the current cue to start before changing the next cue.', true);
      selectedId = cue.id;
      apply(selectCue(state, cue.id)); renderEditor();
    });
    li.append(button); fragment.append(li);
  });
  $('cue-list').replaceChildren(fragment);
  $('cue-count').textContent = `${show.cues.length} cues`;
}

function populateSelect(element, files, value, placeholder) {
  const choices = [{ path: '', label: placeholder }, ...files];
  if (value && !files.some((file) => file.path === value)) choices.push({ path:value, label:`Missing: ${value}` });
  element.replaceChildren(...choices.map((file) => {
    const option = document.createElement('option'); option.value = file.path; option.textContent = file.label || file.path; return option;
  }));
  element.value = value || '';
}
function renderLibrary() {
  $('directory').value = show.mediaDirectory || '';
  $('library-status').textContent = library.directory ? `${library.files.filter((file) => file.kind !== 'captions').length} media files found. ${library.warnings?.join(' ') || ''}` : 'No media folder selected.';
  populateSelect($('hold-file'), library.files.filter((file) => ['video','image'].includes(file.kind)), show.hold.file, 'Built-in 2006 screen');
  $('captions').checked = show.captions;
  renderSoundboard();
}
function renderEditor() {
  const cue = getCue(selectedId);
  $('delete-confirm').hidden = true;
  $('cue-label').value = cue?.label || '';
  $('cue-kind').value = cue?.kind || 'live';
  $('cue-notes').value = cue?.notes || '';
  $('cue-end').value = cue?.endAction || 'hold';
  renderFileChoice(cue?.file || '');
  renderPlayout();
}
function renderFileChoice(file = '') {
  const kind = $('cue-kind').value;
  populateSelect($('cue-file'), library.files.filter((item) => item.kind === kind), file, kind === 'live' ? 'No file — holding screen' : 'Choose a file');
  $('cue-file').disabled = kind === 'live' || !isEditingSafe();
  $('cue-end').disabled = kind !== 'video' || !isEditingSafe();
}
async function saveShow(nextShow) {
  busy = true; renderPlayout();
  try {
    show = await api('/api/show', nextShow);
    apply(updateRundown(state, show.cues));
    configureOutput();
    return true;
  } catch (error) { notice(error.message, true); return false; }
  finally { busy = false; renderPlayout(); }
}

function go() {
  if ($('go').disabled) return;
  const result = beginCue(state, show.cues, { outputId:state.outputId, now:performance.now() });
  apply(result);
  if (state.error) notice(state.error, true);
}
$('go').addEventListener('click', go);
$('stop-sound').addEventListener('click', stopSound);
$('hold').addEventListener('click', () => { if (state) apply(hold(state)); });
$('black').addEventListener('click', () => { if (state) apply(blackout(state)); });
$('pause').addEventListener('click', () => apply(state.status === 'paused' ? resume(state) : pause(state)));
$('restart').addEventListener('click', () => { if (!$('restart').disabled) apply(restart(state, show.cues, { now:performance.now() })); });
$('open-output').addEventListener('click', () => {
  if (state && !outputReady()) apply(hold(state));
  const output = window.open('/output.html', '2006-room-output', 'popup,width=1280,height=720');
  if (!output) notice('Your browser blocked the audience window. Allow popups, or open /output.html in another window.', true);
  else notice('Move the audience window to the mirrored displays, then enable sound & fullscreen there.');
});
$('close-output').addEventListener('click', () => {
  if (!state?.outputId) return;
  apply(hold(state));
  channel.postMessage({ type:'command', targetOutputId:state.outputId, revision:state.revision + 1, runId:crypto.randomUUID(), action:'close' });
});
document.addEventListener('keydown', (event) => {
  if (!state || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,textarea,select,button,summary,[contenteditable]')) return;
  if (event.code === 'Space') { event.preventDefault(); go(); }
  else if (event.key === '1') { event.preventDefault(); playSound(getSounds()[0]); }
  else if (event.key.toLowerCase() === 'h') apply(hold(state));
  else if (event.key.toLowerCase() === 'b') apply(blackout(state));
});

channel.addEventListener('message', (event) => {
  const message = event.data;
  if (!state || !message || typeof message.outputId !== 'string') return;
  if (['hello','status','armed'].includes(message.type)) {
    const previous = outputs.get(message.outputId);
    outputs.set(message.outputId, { ...previous, ...message, seenAt:performance.now() });
    if (message.outputId === state.outputId || !state.outputId) {
      if (Number.isSafeInteger(message.soundState?.revision)) soundRevision = Math.max(soundRevision, message.soundState.revision);
      if (message.soundState?.revision >= soundState.revision) soundState = { ...message.soundState };
    }
    if (message.setupWarning && previous?.setupWarning !== message.setupWarning) notice(message.setupWarning, true);
    if (!state.outputId || (state.outputId !== message.outputId && !outputReady() && !['loading','playing','paused'].includes(state.status))) {
      // A fresh operator page must take a newer token than an existing output.
      // It deliberately returns to hold rather than guessing where the show is.
      if (Number.isSafeInteger(message.revision)) state = { ...state, revision:Math.max(state.revision, message.revision) };
      if (Number.isSafeInteger(message.soundState?.revision)) soundRevision = Math.max(soundRevision, message.soundState.revision);
      apply(setOutput(state, message.outputId)); configureOutput(); apply(hold(state)); stopSound();
    } else if (!previous) configureOutput();
    if (message.type === 'armed' && message.outputId === state.outputId) configureOutput();
    renderPlayout();
  } else if (message.outputId === state.outputId && ['sound-started','sound-ended','sound-error'].includes(message.type)) {
    if (message.soundRevision !== soundState.revision || message.soundRunId !== soundState.runId) return;
    soundState = { ...soundState, status:message.type === 'sound-started' ? 'playing' : message.type === 'sound-ended' ? 'ended' : 'error', error:message.error || '' };
    renderPlayout();
  } else if (message.outputId === state.outputId && ['started','ended','error'].includes(message.type)) {
    apply(handleOutputEvent(state, show.cues, { ...message, now:performance.now() }));
    if (message.type === 'error' && state.error) notice(state.error, true);
  } else if (message.type === 'hold-error' && message.outputId === state.outputId) {
    notice(`Holding-screen file could not play; using the built-in screen. ${message.error || ''}`, true);
  } else if (message.type === 'caption-error' && message.outputId === state.outputId) {
    notice(message.error || 'The local caption file could not be loaded.', true);
  } else if (message.type === 'closed') {
    if (message.outputId === state.outputId) soundState = { ...soundState, status:'stopped', error:'' };
    outputs.delete(message.outputId); renderPlayout();
  }
});
setInterval(() => {
  if (!state) return;
  if (!outputReady() && ['loading','playing'].includes(soundState.status)) stopSound(true);
  renderPlayout(); channel.postMessage({ type:'operator-alive' });
}, 1000);

$('directory-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!isEditingSafe()) return;
  busy = true; renderPlayout();
  try {
    library = await api('/api/library', { directory:$('directory').value.trim() });
    show = await api('/api/show'); readiness.clear(); renderLibrary(); renderEditor(); configureOutput(true);
    notice('Local folder loaded. Assign the room files to your cues, then check the show.');
  } catch (error) { notice(error.message, true); }
  finally { busy = false; renderPlayout(); }
});
$('hold-file').addEventListener('change', async () => {
  if (!isEditingSafe()) return;
  await saveShow({ ...show, hold:{file:$('hold-file').value} }); renderLibrary();
  if (['holding','live','ended','error'].includes(state.status)) apply(hold(state));
});
$('captions').addEventListener('change', async () => { await saveShow({ ...show, captions:$('captions').checked }); renderLibrary(); });
$('sound-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!isEditingSafe() || !getSounds().length) return;
  const first = getSounds()[0];
  const sound = { ...first, file:$('sound-file').value, startSeconds:Number($('sound-start').value), durationSeconds:Number($('sound-duration').value), volume:Number($('sound-volume').value) / 100 };
  if (![sound.startSeconds,sound.durationSeconds,sound.volume].every(Number.isFinite) || sound.startSeconds < 0 || sound.durationSeconds < 0.1 || sound.durationSeconds > 30 || sound.volume < 0 || sound.volume > 1) return notice('Use a non-negative start time, a 0.1–30 second duration and volume from 0 to 100%.', true);
  if (sound.file && !soundFile(sound)) return notice('Choose a local audio or video file from the loaded folder.', true);
  if (await saveShow({ ...show, sounds:[sound,...getSounds().slice(1)] })) { renderSoundboard(); notice(sound.file ? 'Sound saved locally. Check show files, then preview it before the performance.' : 'Sound cleared. The pad is disabled until you choose a file.'); }
});
$('cue-kind').addEventListener('change', () => renderFileChoice());
$('cue-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!isEditingSafe() || !selectedId) return;
  const kind = $('cue-kind').value;
  const updated = { ...getCue(selectedId), label:$('cue-label').value.trim(), kind, file:kind === 'live' ? '' : $('cue-file').value, notes:$('cue-notes').value.trim(), endAction:kind === 'video' ? $('cue-end').value : 'hold' };
  if (kind !== 'video') delete updated.captionFile;
  if (kind !== 'live' && !updated.file) return notice('Choose a local file for this cue, or select Live scene.', true);
  if (await saveShow({ ...show, cues:show.cues.map((cue) => cue.id === selectedId ? updated : cue) })) { renderEditor(); notice('Cue saved locally.'); }
});
$('add-cue').addEventListener('click', async () => {
  if (!isEditingSafe()) return;
  const cue = { id:crypto.randomUUID(), label:'New cue', kind:'live', file:'', notes:'', endAction:'hold' };
  if (await saveShow({ ...show, cues:[...show.cues, cue] })) { selectedId = cue.id; apply(selectCue(state, cue.id)); renderEditor(); $('cue-label').focus(); $('cue-label').select(); }
});
async function moveCue(direction) {
  if (!isEditingSafe()) return;
  const index = show.cues.findIndex((cue) => cue.id === selectedId), target = index + direction;
  if (index < 0 || target < 0 || target >= show.cues.length) return;
  const cues = [...show.cues]; [cues[index],cues[target]] = [cues[target],cues[index]];
  if (await saveShow({ ...show, cues })) renderEditor();
}
$('move-up').addEventListener('click', () => moveCue(-1));
$('move-down').addEventListener('click', () => moveCue(1));
$('delete-cue').addEventListener('click', () => { if (isEditingSafe() && selectedId) $('delete-confirm').hidden = false; });
$('cancel-delete').addEventListener('click', () => { $('delete-confirm').hidden = true; });
$('confirm-delete').addEventListener('click', async () => {
  if (!isEditingSafe()) return;
  if (await saveShow({ ...show, cues:show.cues.filter((cue) => cue.id !== selectedId) })) { selectedId = state.nextCueId || show.cues[0]?.id || null; renderEditor(); }
});
$('export-show').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(show,null,2)], {type:'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = '2006-room-rundown.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('import-show').addEventListener('change', async () => {
  const file = $('import-show').files[0]; if (!file || !isEditingSafe()) return;
  if (file.size > 1024 * 1024) return notice('Rundown file must be smaller than 1 MB.', true);
  try {
    const incoming = JSON.parse(await file.text());
    if (await saveShow(incoming)) {
      apply(reset(state, show.cues)); selectedId = show.cues[0]?.id || null;
      library = await api('/api/library'); readiness.clear(); renderLibrary(); renderEditor(); notice('Rundown imported. Confirm its local media folder before the show.');
    }
  } catch (error) { notice(`Could not import rundown: ${error.message}`, true); }
  finally { $('import-show').value = ''; }
});

function probe(file) {
  return new Promise((resolve) => {
    const isMedia = ['video','audio'].includes(file.kind);
    const element = document.createElement(isMedia ? file.kind : 'img');
    let finished = false;
    const finish = (error = '') => {
      if (finished) return; finished = true; clearTimeout(timer);
      const duration = isMedia ? element.duration : null;
      element.onload = element.onerror = element.onloadeddata = null;
      if (isMedia) { element.removeAttribute('src'); element.load(); }
      resolve({ error, duration });
    };
    const timer = setTimeout(() => finish('Timed out reading this file.'), 8000);
    element.onerror = () => finish('Missing file or unsupported format.');
    if (isMedia) { element.muted = true; element.preload = 'auto'; element.onloadeddata = () => finish(Number.isFinite(element.duration) && element.duration > 0 ? '' : 'Invalid media duration.'); }
    else element.onload = () => finish();
    element.src = mediaUrl(file.path);
  });
}
$('preflight').addEventListener('click', async () => {
  if (preflightRunning || !isEditingSafe()) return;
  preflightRunning = true; renderPlayout(); $('preflight-results').replaceChildren();
  try {
    library = await api('/api/library');
    const media = new Map();
    for (const cue of show.cues) if (cue.kind !== 'live') media.set(cue.file, {path:cue.file,kind:cue.kind});
    if (show.hold.file) media.set(show.hold.file, {path:show.hold.file,kind:/\.(mp4|m4v|mov|webm)$/i.test(show.hold.file) ? 'video' : 'image'});
    for (const sound of getSounds()) if (sound.file) media.set(sound.file, {path:sound.file,kind:soundFile(sound)?.kind || 'audio'});
    let failures = 0;
    for (const file of media.values()) {
      const present = library.files.some((item) => item.path === file.path && item.kind === file.kind);
      const result = present ? await probe(file) : {error:'File not found in the selected folder.'};
      readiness.set(file.path, result);
      if (result.error) failures++;
      const line = document.createElement('div'); line.className = 'preflight-item'; line.classList.toggle('is-good', !result.error);
      line.textContent = `${result.error ? 'FAIL' : 'OK'} · ${file.path || 'Unassigned cue'}${result.duration ? ` · ${time(result.duration)}` : ''}${result.error ? ` · ${result.error}` : ''}`;
      $('preflight-results').append(line);
    }
    for (const sound of getSounds()) {
      const issue = sound.file ? soundIssue(sound) : '';
      if (issue) failures++;
      const line = document.createElement('div'); line.className = 'preflight-item'; line.classList.toggle('is-good', Boolean(sound.file) && !issue);
      line.textContent = `${!sound.file ? 'NOT SET UP' : issue ? 'FAIL' : 'OK'} · Sound: ${sound.label} · ${!sound.file ? 'Optional pad disabled; no clip installed.' : issue || `${sound.startSeconds}s–${sound.startSeconds + sound.durationSeconds}s`}`;
      $('preflight-results').append(line);
    }
    notice(failures ? `${failures} file check(s) failed. Fix them before the show.` : `${media.size} local file(s) checked. Test picture, sound and display routing in the audience window before doors.`, failures > 0);
    renderLibrary();
  } catch (error) { notice(error.message,true); }
  finally { preflightRunning = false; renderPlayout(); }
});

async function start() {
  try {
    show = await api('/api/show');
    state = createInitialState(show.cues); selectedId = show.cues[0]?.id || null;
    try { library = await api('/api/library'); } catch (error) { notice(`Media folder needs attention: ${error.message}`, true); }
    renderLibrary(); renderRundown(); renderEditor(); channel.postMessage({ type:'operator-alive' });
  } catch (error) { notice(`Local player could not start: ${error.message}`, true); }
}
// One controller per browser origin prevents two operator tabs from issuing
// conflicting GO commands. The lock releases automatically on reload/close.
if (!navigator.locks) {
  document.querySelector('main').inert = true;
  $('open-output').disabled = true;
  notice('This browser cannot safely lock the operator controls. Open the local player in a current Chrome or Safari browser.', true);
} else {
  navigator.locks.request('2006-room-operator', { ifAvailable:true }, async (lock) => {
    if (!lock) {
      document.querySelector('main').inert = true;
      $('open-output').disabled = true;
      notice('Another operator page is already controlling this room player. Use that page, or close it and reload this one.', true);
      return;
    }
    controller = true;
    await start();
    await new Promise(() => {});
  }).catch((error) => notice(`Could not acquire operator controls: ${error.message}`, true));
}
