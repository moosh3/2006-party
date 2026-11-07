/** Scene cue client contracts. No database, network or browser. */
import assert from 'node:assert/strict';
import { MAX_SCENE_SECONDS, isSceneId, parseScenePlaybackId, sceneLengthError } from '../lib/scenes';
import { SPRITES } from '../lib/cast';

const id = 'scene:rules-of-the-game:0b5c7f8e-1d2a-4c3b-9e8f-7a6b5c4d3e2f';
assert.equal(parseScenePlaybackId(id), 'rules-of-the-game');
for (const bad of ['scene:people-we-know:0b5c7f8e-1d2a-4c3b-9e8f-7a6b5c4d3e2f', 'scene:rules-of-the-game', 'youtube:video:abcdefghijk', '', null, undefined]) {
  assert.equal(parseScenePlaybackId(bad), null, `${bad} is not a known scene`);
}
assert.equal(isSceneId('rules-of-the-game'), true);
assert.equal(isSceneId('toString'), false, 'Prototype keys are not scenes');
for (const ok of [0.5, 90, 90.25, MAX_SCENE_SECONDS]) assert.equal(sceneLengthError(ok), null);
for (const bad of [0, -1, MAX_SCENE_SECONDS + 1, Number.NaN, Number.POSITIVE_INFINITY, '90', null]) assert.notEqual(sceneLengthError(bad), null);
assert.deepEqual(SPRITES.map(s => [s.name, s.screenName, s.index]), [
  ['MK', 'mkashe9', 0], ['Jen', 'SBconfetti', 1], ['Lip', 'x0x_BlueShellVictim_x0x', 2],
  ['Yongwoo', 'neodafunky', 3], ['Emma', 'EmmaIsNine', 4], ['Alec', 'bbulldogs48', 5],
], 'Sprite order matches the Buddy List and excludes SmarterChild');
console.log('PASS: scene ids, lengths and the shared Sprite roster.');
