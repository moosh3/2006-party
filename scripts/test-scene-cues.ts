/** Scene cue client contracts. No database, network or browser. */
import assert from 'node:assert/strict';
import { MAX_SCENE_SECONDS, isSceneId, parseScenePlaybackId, sceneLengthError, scenesAiredSince } from '../lib/scenes';
import { SPRITES } from '../lib/cast';
import { RULES_TOUR } from '../lib/rules-of-the-game';

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
assert.deepEqual(scenesAiredSince([
  { details: { to_playback_id: 'welcome' } }, { details: null }, {},
  { details: { to_playback_id: id } }, { details: { to_playback_id: id.replace('0b5c', '1b5c') } },
  { details: { to_playback_id: 'scene:people-we-know:0b5c7f8e-1d2a-4c3b-9e8f-7a6b5c4d3e2f' } },
]), ['rules-of-the-game'], 'Only known scenes that started are reported, once');
assert.deepEqual(scenesAiredSince([]), []);
assert.equal(RULES_TOUR[0].presenter, 'lip', 'Sprite Lip opens the tour');
assert.ok(RULES_TOUR.every(step => SPRITES.some(sprite => sprite.art === step.presenter)), 'Every presenter is a Sprite');
assert.equal(new Set(RULES_TOUR.map(step => step.id)).size, RULES_TOUR.length);
assert.deepEqual(RULES_TOUR.filter(step => step.action).map(step => step.action!.target), ['superlative', 'trl', 'essay']);
assert.ok(RULES_TOUR.every(step => !step.highlight || step.pointer), 'Every highlighted control is also named in the step text');
assert.deepEqual(RULES_TOUR.map(step => step.highlight ?? null), ['cast', 'vote', 'vote', 'essay', null]);
assert.ok(SPRITES.every(sprite => sprite.catchphrase === undefined || sprite.catchphrase.trim().length > 0), 'No blank catchphrases');
console.log('PASS: scene ids, lengths, the shared Sprite roster and the Rules of the Game tour.');
