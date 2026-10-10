// The room player has its own clock and rundown. It never reads or advances the
// online program. All functions below are pure apart from creating command IDs.

const GO_COOLDOWN_MS = 500;
const MEDIA_KINDS = new Set(['video', 'image']);
const RUNNING_STATUSES = new Set(['loading', 'playing', 'paused', 'live']);

function freshToken(state) {
  return { revision: state.revision + 1, runId: globalThis.crypto.randomUUID() };
}

function cueById(cues, id) {
  return cues.find((cue) => cue.id === id);
}

function followingCueId(cues, id) {
  const index = cues.findIndex((cue) => cue.id === id);
  return index >= 0 ? (cues[index + 1]?.id ?? null) : null;
}

function validOutputId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function playableCue(cue) {
  if (!cue || !['video', 'image', 'live'].includes(cue.kind)) return false;
  if (cue.kind === 'live') return true;
  return typeof cue.file === 'string' && cue.file.trim().length > 0 && !cue.file.includes('\0');
}

function commandFor(state, action, cue) {
  if (!validOutputId(state.outputId)) return undefined;
  const command = {
    type: 'command',
    targetOutputId: state.outputId,
    revision: state.revision,
    runId: state.runId,
    action,
  };
  if (cue) command.cue = { ...cue };
  return command;
}

function reject(state, message) {
  // Rejecting a next cue must not misrepresent an already-running output.
  return {
    state: {
      ...state,
      status: RUNNING_STATUSES.has(state.status) ? state.status : 'error',
      error: message,
    },
  };
}

function start(state, cue, outputId, now, action, advanceOnStart) {
  const nextState = {
    ...state,
    ...freshToken(state),
    activeCueId: cue.id,
    activeStarted: false,
    advanceOnStart,
    outputId,
    status: 'loading',
    error: null,
    lastGoAt: now,
  };
  return { state: nextState, command: commandFor(nextState, action, cue) };
}

export function createInitialState(cues = []) {
  return {
    activeCueId: null,
    nextCueId: cues[0]?.id ?? null,
    activeStarted: false,
    advanceOnStart: false,
    runId: globalThis.crypto.randomUUID(),
    revision: 0,
    status: 'holding',
    error: null,
    outputId: null,
    lastGoAt: -GO_COOLDOWN_MS,
  };
}

export function selectCue(state, id) {
  return { state: { ...state, nextCueId: id ?? null, error: null } };
}

export function setOutput(state, outputId) {
  const selected = validOutputId(outputId) ? outputId : null;
  if (state.outputId === selected) return { state };
  const nextState = {
    ...state,
    ...freshToken(state),
    outputId: selected,
    status: 'holding',
    advanceOnStart: false,
    error: null,
  };
  // Stop the abandoned output. The operator separately configures the new
  // output and confirms that it is ready before allowing GO.
  const command = commandFor({ ...nextState, outputId: state.outputId }, 'hold');
  return command ? { state: nextState, command } : { state: nextState };
}

export function beginCue(state, cues, { now = Date.now(), outputId } = {}) {
  if (state.status === 'loading' || now - state.lastGoAt < GO_COOLDOWN_MS) return { state };
  const selectedOutput = outputId ?? state.outputId;
  if (!validOutputId(selectedOutput)) return reject(state, 'Choose and connect an audience output before GO.');
  const cue = cueById(cues, state.nextCueId);
  if (!cue) return reject(state, 'Choose a cue before GO.');
  if (!playableCue(cue)) return reject(state, 'This cue needs a valid local media file before GO.');
  return start(state, cue, selectedOutput, now, 'play', true);
}

export function hold(state) {
  const nextState = {
    ...state,
    ...freshToken(state),
    status: 'holding',
    advanceOnStart: false,
    error: null,
  };
  const command = commandFor(nextState, 'hold');
  return command ? { state: nextState, command } : { state: nextState };
}

export function blackout(state) {
  const nextState = {
    ...state,
    ...freshToken(state),
    status: 'black',
    advanceOnStart: false,
    error: null,
  };
  const command = commandFor(nextState, 'black');
  return command ? { state: nextState, command } : { state: nextState };
}

export function pause(state) {
  if (state.status !== 'playing') return { state };
  const nextState = { ...state, ...freshToken(state), status: 'paused', error: null };
  return { state: nextState, command: commandFor(nextState, 'pause') };
}

export function resume(state) {
  if (state.status !== 'paused') return { state };
  const nextState = { ...state, ...freshToken(state), status: 'playing', error: null };
  return { state: nextState, command: commandFor(nextState, 'resume') };
}

export function restart(state, cues, { now = Date.now() } = {}) {
  if (!validOutputId(state.outputId)) return reject(state, 'Choose and connect an audience output before restarting.');
  const cue = cueById(cues, state.activeCueId);
  if (!cue) return reject(state, 'There is no active cue to restart.');
  if (!playableCue(cue)) return reject(state, 'This cue needs a valid local media file before restarting.');
  // A failed/unacknowledged start has not consumed its cue yet. A successful
  // replay of an already-started cue must instead preserve the queued next cue.
  const advanceOnStart = !state.activeStarted && state.nextCueId === cue.id;
  return start(state, cue, state.outputId, now, 'restart', advanceOnStart);
}

export function reset(state, cues) {
  const nextState = {
    ...createInitialState(cues),
    ...freshToken(state),
    outputId: state.outputId,
  };
  const command = commandFor(nextState, 'hold');
  return command ? { state: nextState, command } : { state: nextState };
}

export function updateRundown(state, cues) {
  const activeRemoved = state.activeCueId !== null && !cueById(cues, state.activeCueId);
  let nextCueId = state.nextCueId;
  if (nextCueId !== null && !cueById(cues, nextCueId)) {
    nextCueId = state.activeCueId ? followingCueId(cues, state.activeCueId) : (cues[0]?.id ?? null);
  } else if (nextCueId === null) {
    nextCueId = state.activeCueId ? followingCueId(cues, state.activeCueId) : (cues[0]?.id ?? null);
  }
  if (!activeRemoved) return { state: { ...state, nextCueId } };
  const result = hold(state);
  return {
    ...result,
    state: {
      ...result.state,
      activeCueId: null,
      activeStarted: false,
      nextCueId: cueById(cues, nextCueId) ? nextCueId : (cues[0]?.id ?? null),
    },
  };
}

export function handleOutputEvent(state, cues, event) {
  if (!event || event.outputId !== state.outputId || event.revision !== state.revision || event.runId !== state.runId) {
    return { state };
  }
  const activeCue = cueById(cues, state.activeCueId);
  if (event.type === 'started') {
    if (state.status !== 'loading' || !activeCue) return { state };
    return {
      state: {
        ...state,
        status: activeCue.kind === 'live' ? 'live' : 'playing',
        activeStarted: true,
        advanceOnStart: false,
        nextCueId: state.advanceOnStart && state.nextCueId === state.activeCueId
          ? followingCueId(cues, state.activeCueId)
          : state.nextCueId,
        error: null,
      },
    };
  }
  if (event.type === 'error') {
    const message = typeof event.error === 'string' && event.error.trim()
      ? event.error
      : 'The audience output could not play this cue.';
    if (state.status === 'error') return { state: { ...state, error: message } };
    const fallback = hold(state);
    return {
      ...fallback,
      state: {
        ...fallback.state,
        status: 'error',
        error: message,
        nextCueId: !state.activeStarted && activeCue ? state.activeCueId : state.nextCueId,
      },
    };
  }
  if (event.type === 'ended') {
    if (state.status !== 'playing' || !activeCue) return { state };
    const nextCue = cueById(cues, state.nextCueId);
    if (activeCue.endAction === 'next' && nextCue && MEDIA_KINDS.has(nextCue.kind) && playableCue(nextCue)) {
      return start(state, nextCue, state.outputId, event.now ?? Date.now(), 'play', true);
    }
    return hold(state);
  }
  return { state };
}

export { GO_COOLDOWN_MS };
