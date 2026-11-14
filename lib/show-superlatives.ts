import type { CastRunId } from './cast-runs';

/** Production-supplied categories. Contributor credit is for the operator only;
 * every category uses the show's saved cast roster as its voting choices. */
export const SHOW_SUPERLATIVES: readonly {
  id: CastRunId;
  contributor: string;
  question: string;
}[] = [
  { id: 'mk', contributor: 'MK', question: 'Most likely to know where they are sitting at lunch' },
  { id: 'alec', contributor: 'Alec', question: 'Most likely to break the computer' },
  { id: 'lip', contributor: 'Lip', question: 'Who’s most likely to grow up' },
  { id: 'jen', contributor: 'Jen', question: 'Most likely to break an arm skateboarding and tell everyone it was actually a sharkbite (true story)' },
  { id: 'emma', contributor: 'Emma', question: 'Most likely to win a sweepstakes contest' },
  { id: 'yongwoo', contributor: 'Yongwoo', question: 'Most likely to have a wikipedia page with a "controversies" section' },
];
