import type { GamePrompt } from './game-types';

export type RoundAction = { action: 'open' | 'close' | 'reveal'; id: string };

/** Each list action is one atomic database operation, safe to repeat. */
export function triviaActions(prompts: GamePrompt[], action: 'open' | 'close_reveal'): { action: 'trivia_open' | 'trivia_close_reveal' }[] {
  const questions = prompts.filter(p => p.kind === 'trivia');
  if (action === 'open') return questions.some(p => p.status === 'draft') ? [{ action: 'trivia_open' }] : [];
  return questions.some(p => p.status === 'open' || (p.status === 'closed' && !p.results_visible))
    ? [{ action: 'trivia_close_reveal' }] : [];
}

export function superlativeActions(prompts: GamePrompt[], action: RoundAction['action']): RoundAction[] {
  return prompts.filter(p => p.kind === 'superlative' && (
    action === 'open' ? p.status === 'draft'
      : action === 'close' ? p.status === 'open'
        : p.status === 'closed' && !p.results_visible
  )).map(p => ({ action, id: p.id }));
}

/** Stop on the first failure. The caller reloads actual state before offering a retry. */
export async function runDeskActions<T>(actions: T[], send: (action: T) => Promise<unknown>) {
  for (const action of actions) await send(action);
}
