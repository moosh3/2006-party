/** Clippy typing-line pacing. Pure; no DOM or timers. */
import assert from 'node:assert/strict';
import { MIN_GAP_MS, MIN_NEW_WORDS, countWords, shouldSpeak } from '../lib/clippy-typing';

assert.equal(countWords(''), 0);
assert.equal(countWords('  my first\nMySpace   top 8 '), 5);
const fresh = { lastSpokeAt: null, wordsAtLastLine: 0 };
assert.equal(shouldSpeak(fresh, 1000, MIN_NEW_WORDS - 1), false, 'Too few words');
assert.equal(shouldSpeak(fresh, 1000, MIN_NEW_WORDS), true, 'First pause after enough words');
const spoke = { lastSpokeAt: 1000, wordsAtLastLine: 10 };
assert.equal(shouldSpeak(spoke, 1000 + MIN_GAP_MS - 1, 40), false, 'Too soon after the last line');
assert.equal(shouldSpeak(spoke, 1000 + MIN_GAP_MS, 10 + MIN_NEW_WORDS - 1), false, 'Not enough new words');
assert.equal(shouldSpeak(spoke, 1000 + MIN_GAP_MS, 10 + MIN_NEW_WORDS), true);
assert.equal(shouldSpeak(spoke, 1000 + MIN_GAP_MS, 2), false, 'Deleting text never triggers a line');
console.log('PASS: Clippy typing lines wait for a pause, enough new words and a 20-second gap.');
