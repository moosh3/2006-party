// Let's Check Our Scores (segment 7): what the window shows, and how the
// countdown so far is read from the queue log (sql/030_check_our_scores.sql).
import type { PublishedEssay } from './essays';

export type ScoresSuperlative = { id: string; question: string; status: 'open' | 'closed'; options: { label: string; count: number }[] };
export type ScoresCountdown = { rank: number; title: string };
export type ScoresPayload = {
  /** False until the Scores scene has started tonight; totals stay private until then. */
  available: boolean;
  superlatives: ScoresSuperlative[];
  countdown: ScoresCountdown[];
  essays: PublishedEssay[];
};

/** Countdown cues that started, one per rank (most recent wins), #5 first. */
export function countdownAiredSince(actions: readonly { details?: unknown }[]): ScoresCountdown[] {
  const byRank = new Map<number, string>();
  for (const action of actions) {
    const details = action.details && typeof action.details === 'object' ? action.details as Record<string, unknown> : null;
    const cue = details?.countdown && typeof details.countdown === 'object' ? details.countdown as Record<string, unknown> : null;
    const rank = cue?.rank;
    if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 1 || rank > 5 || byRank.has(rank)) continue;
    byRank.set(rank, typeof details?.to_title === 'string' && details.to_title ? details.to_title : `Video #${rank}`);
  }
  return [...byRank].map(([rank, title]) => ({ rank, title })).sort((a, b) => b.rank - a.rank);
}
