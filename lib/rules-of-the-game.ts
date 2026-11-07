import type { CastRunId } from './cast-runs';

export type RulesTourAction = 'superlative' | 'trl' | 'essay';
export type RulesTourStep = { id: string; presenter: CastRunId; title: string; body: string; action?: { label: string; target: RulesTourAction } };

// Draft copy for MK's review (docs/rules-of-the-game.md). Sprite Lip hosts the
// segment; the other presenters are a suggested pairing.
export const RULES_TOUR: readonly RulesTourStep[] = [
  { id: 'cast', presenter: 'lip', title: 'Welcome to the Rules of the Game!',
    body: 'These are the 2006ers. Click any of us to see our catchphrase and open our Buddy Info.' },
  { id: 'superlatives', presenter: 'jen', title: 'Cast superlatives are open',
    body: 'Vote for the 2006er who fits each yearbook award. You can change your vote until the host closes it.',
    action: { label: 'Vote now', target: 'superlative' } },
  { id: 'trl', presenter: 'mk', title: 'TRL voting is closed',
    body: 'Voting closed before the show. Watch the countdown to see where your pick landed.',
    action: { label: 'See TRL', target: 'trl' } },
  { id: 'essay', presenter: 'yongwoo', title: 'Write your 2006 essay',
    body: 'Open TextEdit, pick a prompt and write a few lines. Clippy is standing by to help.',
    action: { label: 'Open essay', target: 'essay' } },
  { id: 'done', presenter: 'alec', title: 'Those are the rules!',
    body: 'Have fun, keep voting, and keep an eye on the countdown.' },
];
