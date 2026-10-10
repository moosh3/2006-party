import assert from 'node:assert/strict';
import {
  beginCue, blackout, createInitialState, handleOutputEvent, hold,
  pause, reset, restart, resume, selectCue, setOutput, updateRundown,
} from '../tools/room-player/state.mjs';

const cues = [
  { id: 'opening', label: 'Opening', kind: 'video', file: '/local/opening.mp4' },
  { id: 'welcome', label: 'Live welcome', kind: 'live' },
  { id: 'ads', label: 'Ads', kind: 'video', file: '/local/ads.mp4', endAction: 'next' },
  { id: 'logo', label: 'Logo', kind: 'image', file: '/local/logo.png' },
];
let passed = 0;
function test(label, run) {
  run();
  passed += 1;
  console.log(`✓ ${label}`);
}
function connected(rundown = cues) {
  return setOutput(createInitialState(rundown), 'audience-a').state;
}
function event(state, type, extra = {}) {
  return { type, outputId: state.outputId, runId: state.runId, revision: state.revision, ...extra };
}
function playing(rundown = cues, id = rundown[0].id, now = 1_000) {
  const start = beginCue(selectCue(connected(rundown), id).state, rundown, { now });
  return handleOutputEvent(start.state, rundown, event(start.state, 'started')).state;
}

test('initial state selects first cue but never starts anything', () => {
  const state = createInitialState(cues);
  assert.equal(state.nextCueId, 'opening');
  assert.equal(state.activeCueId, null);
  assert.equal(state.status, 'holding');
  assert.equal(state.outputId, null);
  assert.equal(createInitialState([]).nextCueId, null);
});
test('GO requires an explicitly connected audience output', () => {
  const result = beginCue(createInitialState(cues), cues, { now: 1_000 });
  assert.equal(result.command, undefined);
  assert.match(result.state.error, /audience output/);
  assert.equal(result.state.nextCueId, 'opening');
});
test('GO loads a targeted cue and advances only after started acknowledgement', () => {
  const state = connected();
  const before = { ...state };
  const result = beginCue(state, cues, { now: 1_000 });
  assert.equal(result.state.status, 'loading');
  assert.equal(result.state.nextCueId, 'opening');
  assert.equal(result.command.targetOutputId, 'audience-a');
  assert.equal(result.command.cue.file, '/local/opening.mp4');
  assert.notEqual(result.state.runId, state.runId);
  assert.deepEqual(state, before);
  const started = handleOutputEvent(result.state, cues, event(result.state, 'started'));
  assert.equal(started.state.status, 'playing');
  assert.equal(started.state.nextCueId, 'welcome');
  assert.equal(started.state.activeStarted, true);
});
test('duplicate GO is ignored while loading and inside the 500 ms cooldown', () => {
  const loading = beginCue(connected(), cues, { now: 1_000 }).state;
  assert.equal(beginCue(loading, cues, { now: 4_000 }).state, loading);
  const started = handleOutputEvent(loading, cues, event(loading, 'started')).state;
  assert.equal(beginCue(started, cues, { now: 1_499 }).state, started);
  assert.equal(beginCue(started, cues, { now: 1_500 }).state.status, 'loading');
});
test('GO rejects a missing file without consuming the next cue', () => {
  const broken = [{ id: 'broken', label: 'Missing file', kind: 'video', file: '' }];
  const result = beginCue(connected(broken), broken, { now: 1_000 });
  assert.equal(result.command, undefined);
  assert.equal(result.state.nextCueId, 'broken');
  assert.equal(result.state.activeCueId, null);
  assert.equal(result.state.status, 'error');
});
test('events from another output, revision, or run are ignored', () => {
  const state = beginCue(connected(), cues, { now: 1_000 }).state;
  for (const mismatch of [{ outputId: 'other' }, { revision: state.revision - 1 }, { runId: 'old' }]) {
    assert.equal(handleOutputEvent(state, cues, event(state, 'started', mismatch)).state, state);
    assert.equal(handleOutputEvent(state, cues, event(state, 'error', mismatch)).command, undefined);
  }
});
test('duplicate started acknowledgements cannot consume a second cue', () => {
  const state = playing();
  const duplicate = handleOutputEvent(state, cues, event(state, 'started'));
  assert.equal(duplicate.state, state);
  assert.equal(state.nextCueId, 'welcome');
});
test('failed starts return to holding and keep the failed cue selected', () => {
  const loading = beginCue(connected(), cues, { now: 1_000 }).state;
  const failed = handleOutputEvent(loading, cues, event(loading, 'error', { error: 'Cannot decode file' }));
  assert.equal(failed.state.status, 'error');
  assert.equal(failed.state.nextCueId, 'opening');
  assert.equal(failed.state.activeCueId, 'opening');
  assert.equal(failed.command.action, 'hold');
  assert.notEqual(failed.state.runId, loading.runId);
  assert.equal(handleOutputEvent(failed.state, cues, event(loading, 'started')).state, failed.state);
});
test('playback errors preserve the already-selected next cue', () => {
  const state = playing();
  const failed = handleOutputEvent(state, cues, event(state, 'error'));
  assert.equal(failed.state.nextCueId, 'welcome');
  assert.equal(failed.state.status, 'error');
  assert.equal(failed.command.action, 'hold');
  assert.equal(handleOutputEvent(failed.state, cues, event(failed.state, 'error')).command, undefined);
});
test('live scenes wait indefinitely and cannot be auto-ended or paused', () => {
  const state = playing(cues, 'welcome');
  assert.equal(state.status, 'live');
  assert.equal(state.nextCueId, 'ads');
  assert.equal(handleOutputEvent(state, cues, event(state, 'ended')).state, state);
  assert.equal(pause(state).state, state);
});
test('a finished video returns to holding by default without advancing again', () => {
  const state = playing();
  const ended = handleOutputEvent(state, cues, event(state, 'ended'));
  assert.equal(ended.state.status, 'holding');
  assert.equal(ended.state.activeCueId, 'opening');
  assert.equal(ended.state.nextCueId, 'welcome');
  assert.equal(ended.command.action, 'hold');
  assert.equal(handleOutputEvent(ended.state, cues, event(state, 'ended')).state, ended.state);
});
test('auto-follow is explicit and requires a valid next media cue', () => {
  const state = playing(cues, 'ads');
  const ended = handleOutputEvent(state, cues, event(state, 'ended', { now: 2_000 }));
  assert.equal(ended.state.status, 'loading');
  assert.equal(ended.state.activeCueId, 'logo');
  assert.equal(ended.state.nextCueId, 'logo');
  assert.equal(ended.command.action, 'play');
  assert.equal(ended.command.cue.kind, 'image');
  const started = handleOutputEvent(ended.state, cues, event(ended.state, 'started'));
  assert.equal(started.state.nextCueId, null);
});
test('auto-follow never launches a live scene', () => {
  const rundown = [{ ...cues[0], endAction: 'next' }, cues[1]];
  const state = playing(rundown);
  const ended = handleOutputEvent(state, rundown, event(state, 'ended'));
  assert.equal(ended.state.status, 'holding');
  assert.equal(ended.state.nextCueId, 'welcome');
  assert.equal(ended.command.action, 'hold');
});
test('auto-follow rejects a missing next file and waits on holding', () => {
  const rundown = [{ ...cues[0], endAction: 'next' }, { ...cues[3], file: '' }];
  const state = playing(rundown);
  assert.equal(handleOutputEvent(state, rundown, event(state, 'ended')).command.action, 'hold');
});
test('hold invalidates old events and resume cannot restart a held cue', () => {
  const state = playing();
  const held = hold(state);
  assert.equal(held.state.nextCueId, 'welcome');
  assert.equal(held.state.activeCueId, 'opening');
  assert.equal(held.command.action, 'hold');
  assert.equal(resume(held.state).state, held.state);
  assert.equal(handleOutputEvent(held.state, cues, event(state, 'ended')).state, held.state);
});
test('blackout keeps the rundown position and invalidates old events', () => {
  const state = playing();
  const black = blackout(state);
  assert.equal(black.state.status, 'black');
  assert.equal(black.state.nextCueId, 'welcome');
  assert.equal(black.command.action, 'black');
  assert.equal(handleOutputEvent(black.state, cues, event(state, 'error')).state, black.state);
});
test('pause and resume use new tokens without consuming next cue', () => {
  const state = playing();
  const paused = pause(state);
  assert.equal(paused.state.status, 'paused');
  assert.equal(paused.command.action, 'pause');
  assert.equal(handleOutputEvent(paused.state, cues, event(state, 'ended')).state, paused.state);
  assert.equal(handleOutputEvent(paused.state, cues, event(paused.state, 'ended')).state, paused.state);
  const resumed = resume(paused.state);
  assert.equal(resumed.state.status, 'playing');
  assert.equal(resumed.command.action, 'resume');
  assert.equal(resumed.state.nextCueId, 'welcome');
  assert.notEqual(resumed.state.runId, paused.state.runId);
});
test('restart loads the active cue under a new token and preserves next selection', () => {
  const state = playing();
  const restarted = restart(hold(state).state, cues, { now: 1_100 });
  assert.equal(restarted.command.action, 'restart');
  assert.equal(restarted.command.cue.id, 'opening');
  assert.equal(restarted.state.status, 'loading');
  assert.equal(restarted.state.nextCueId, 'welcome');
  const started = handleOutputEvent(restarted.state, cues, event(restarted.state, 'started'));
  assert.equal(started.state.nextCueId, 'welcome');
  assert.equal(handleOutputEvent(started.state, cues, event(state, 'ended')).state, started.state);
});
test('restart recovers an error without waiting for GO cooldown', () => {
  const loading = beginCue(connected(), cues, { now: 1_000 }).state;
  const failed = handleOutputEvent(loading, cues, event(loading, 'error')).state;
  const recovered = restart(failed, cues, { now: 1_010 });
  assert.equal(recovered.state.status, 'loading');
  assert.equal(recovered.state.error, null);
  assert.equal(recovered.command.action, 'restart');
  const started = handleOutputEvent(recovered.state, cues, event(recovered.state, 'started'));
  assert.equal(started.state.nextCueId, 'welcome');
});
test('a manually selected next cue survives the current cue starting', () => {
  const loading = beginCue(connected(), cues, { now: 1_000 }).state;
  const selected = selectCue(loading, 'ads').state;
  const started = handleOutputEvent(selected, cues, event(selected, 'started'));
  assert.equal(started.state.activeCueId, 'opening');
  assert.equal(started.state.nextCueId, 'ads');
});
test('the last cue ends in holding with no implicit wraparound', () => {
  const rundown = [{ ...cues[0], endAction: 'next' }];
  const state = playing(rundown);
  assert.equal(state.nextCueId, null);
  const ended = handleOutputEvent(state, rundown, event(state, 'ended'));
  assert.equal(ended.state.status, 'holding');
  assert.equal(ended.state.nextCueId, null);
  assert.equal(beginCue(ended.state, rundown, { now: 2_000 }).command, undefined);
});
test('switching outputs stops the old output and rejects its stale events', () => {
  const state = playing();
  const switched = setOutput(state, 'audience-b');
  assert.equal(switched.state.outputId, 'audience-b');
  assert.equal(switched.state.status, 'holding');
  assert.equal(switched.command.targetOutputId, 'audience-a');
  assert.equal(switched.command.action, 'hold');
  assert.equal(handleOutputEvent(switched.state, cues, event(state, 'ended')).state, switched.state);
  assert.equal(setOutput(switched.state, 'audience-b').state, switched.state);
});
test('rundown updates stop a removed active cue without reviving stale playback', () => {
  const state = playing();
  const updated = updateRundown(state, cues.slice(1));
  assert.equal(updated.state.activeCueId, null);
  assert.equal(updated.state.nextCueId, 'welcome');
  assert.equal(updated.state.status, 'holding');
  assert.equal(updated.command.action, 'hold');
  assert.equal(handleOutputEvent(updated.state, cues, event(state, 'ended')).state, updated.state);
});
test('removing a queued cue chooses the next remaining cue', () => {
  const state = playing();
  const updated = updateRundown(state, cues.filter((cue) => cue.id !== 'welcome'));
  assert.equal(updated.state.nextCueId, 'ads');
  assert.equal(updated.state.status, 'playing');
  assert.equal(updated.state.runId, state.runId);
});
test('reset returns to first cue, holds output, and invalidates old callbacks', () => {
  const state = playing(cues, 'ads');
  const result = reset(state, cues);
  assert.equal(result.state.activeCueId, null);
  assert.equal(result.state.nextCueId, 'opening');
  assert.equal(result.state.outputId, 'audience-a');
  assert.equal(result.command.action, 'hold');
  assert.equal(handleOutputEvent(result.state, cues, event(state, 'ended')).state, result.state);
});
test('state and cue inputs are not mutated by any operation', () => {
  const frozenCues = Object.freeze(cues.map((cue) => Object.freeze({ ...cue })));
  const state = Object.freeze(connected(frozenCues));
  const started = beginCue(state, frozenCues, { now: 1_000 });
  assert.notEqual(started.state, state);
  assert.notEqual(started.command.cue, frozenCues[0]);
  selectCue(state, 'ads');
  hold(state);
  blackout(state);
  reset(state, frozenCues);
  updateRundown(state, frozenCues);
});

console.log(`\n${passed} independent room-state checks passed.`);
