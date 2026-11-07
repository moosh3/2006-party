/** Scores window contracts. No database, network or browser. */
import assert from 'node:assert/strict';
import { countdownAiredSince } from '../lib/scores';
import { SCENES, isSceneId } from '../lib/scenes';

const advance = (rank: unknown, title?: string) => ({ details: { to_title: title, countdown: rank === undefined ? null : { rank } } });
// Newest first, as read from the log.
assert.deepEqual(countdownAiredSince([
  advance(2, 'Crazy'), advance(undefined, 'Ads 6'), advance(3, 'Promiscuous'), advance(3, 'Replayed earlier'),
  advance(4, 'SexyBack'), advance(5, "Hips Don't Lie"), { details: null }, {},
]), [{ rank: 5, title: "Hips Don't Lie" }, { rank: 4, title: 'SexyBack' }, { rank: 3, title: 'Promiscuous' }, { rank: 2, title: 'Crazy' }],
'One entry per rank, most recent wins, #5 first; non-countdown cues ignored');
assert.deepEqual(countdownAiredSince([advance(1, '')]), [{ rank: 1, title: 'Video #1' }], 'Missing titles fall back to the rank');
for (const bad of [0, 6, 2.5, '3', null]) assert.deepEqual(countdownAiredSince([advance(bad, 'x')]), [], `${bad} is not a rank`);
assert.equal(isSceneId('check-our-scores'), true);
assert.equal(SCENES['check-our-scores'].label, "Let's Check Our Scores");
console.log('PASS: scores countdown log reading and the Scores scene id.');
