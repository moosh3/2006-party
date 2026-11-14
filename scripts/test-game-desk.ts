import assert from 'node:assert/strict';
import type { GamePrompt } from '../lib/game-types';
import { runDeskActions, superlativeActions, triviaActions } from '../lib/game-desk';

const prompt = (id: string, kind: GamePrompt['kind'], status: GamePrompt['status'], results_visible = false): GamePrompt =>
  ({ id, kind, status, results_visible, show_id: 'night', question: id, options: [] });
const first = prompt('first', 'trivia', 'closed', true);
const pending = prompt('pending', 'trivia', 'closed');
const open = prompt('open', 'trivia', 'open');
const next = prompt('next', 'trivia', 'draft');
const later = prompt('later', 'trivia', 'draft');
const external = prompt('external', 'trl', 'open');
const questions = [external, first, pending, open, next, later];
assert.deepEqual(triviaActions(questions, 'open'), [{ action: 'trivia_open' }], 'One request opens the full list');
assert.deepEqual(triviaActions(questions, 'close_reveal'), [{ action: 'trivia_close_reveal' }], 'One request closes and reveals the full list');
assert.deepEqual(triviaActions([external, first], 'open'), []);
assert.deepEqual(triviaActions([first], 'close_reveal'), [], 'Do not toggle answers back off');
const awards = [prompt('a', 'superlative', 'draft'), prompt('b', 'superlative', 'open'), prompt('c', 'superlative', 'closed'), prompt('d', 'superlative', 'closed', true), external, open];
assert.deepEqual(superlativeActions(awards, 'open'), [{ action: 'open', id: 'a' }]);
assert.deepEqual(superlativeActions(awards, 'close'), [{ action: 'close', id: 'b' }]);
assert.deepEqual(superlativeActions(awards, 'reveal'), [{ action: 'reveal', id: 'c' }]);
async function main() {
  const sent: string[] = [];
  await assert.rejects(runDeskActions(['close-first', 'close-second', 'reveal-first'], async action => {
    sent.push(action);
    if (action === 'close-second') throw new Error('Disconnected');
  }), /Disconnected/);
  assert.deepEqual(sent, ['close-first', 'close-second'], 'Stop after a failure; never reveal while closing the list is incomplete');
  // Resume from refreshed state after a reveal response was lost: visible answers stay visible.
  assert.deepEqual(triviaActions([first, pending], 'close_reveal'), [{ action: 'trivia_close_reveal' }]);
  console.log('PASS: full-list opening, close-all-before-reveal, saved order, recovery, and untouched cast/video votes.');
}
void main();
