import { SPRITES } from './cast';
import type { CastRunId } from './cast-runs';

export interface CountdownCue {
  rank: number;
  /** Separate title-card time; omitted on existing cues. */
  introSeconds?: number;
  startSeconds: number;
  durationSeconds: number;
  bannerUrl: string | null;
  /** Presenting Sprite shown on the title card (database update 031); omitted on older cues. */
  presenter?: CastRunId;
}

/** MK's run of show: “VIDEO NUMBER FIVE: Sprite Emma Presents”, and so on. */
export const COUNTDOWN_PRESENTERS: Record<number, CastRunId> = { 5: 'emma', 4: 'yongwoo', 3: 'jen', 2: 'mk', 1: 'lip' };

/** Bundled artwork stays attached to the rank, never the selected song. */
export const COUNTDOWN_BANNERS: Record<number, { video: string; poster: string }> = Object.fromEntries(
  [1, 2, 3, 4, 5].map(rank => [rank, { video: `/2006/countdown/number-${rank}.webm`, poster: `/2006/countdown/number-${rank}.png` }]),
);

export const COUNTDOWN_LENGTHS: Record<number, number> = { 5: 15, 4: 30, 3: 45, 2: 60 };

export function countdownError(cue: CountdownCue, sourceDuration: number): string | null {
  if (!Number.isInteger(cue.rank) || cue.rank < 1 || cue.rank > 5) return 'Choose a countdown position from #5 to #1.';
  if (cue.introSeconds !== undefined && (!Number.isFinite(cue.introSeconds) || cue.introSeconds < 0 || cue.introSeconds > 10)) return 'Choose a title card length from 0 to 10 seconds.';
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) return 'Add the exact video duration in the library first.';
  if (!Number.isFinite(cue.startSeconds) || cue.startSeconds < 0 || !Number.isFinite(cue.durationSeconds) || cue.durationSeconds <= 0) return 'Enter a valid highlight start and excerpt length in seconds.';
  if (cue.startSeconds + cue.durationSeconds > sourceDuration) return 'The excerpt extends past the end of this video.';
  if (cue.rank === 5 && cue.durationSeconds !== 15) return '#5 plays 15 seconds.';
  if (cue.rank === 1 && (cue.startSeconds !== 0 || cue.durationSeconds !== sourceDuration)) return '#1 plays the full video from the beginning.';
  if (cue.presenter !== undefined && !SPRITES.some(sprite => sprite.art === cue.presenter)) return 'Choose a presenter from the cast, or none.';
  if (cue.bannerUrl !== null && (typeof cue.bannerUrl !== 'string' || cue.bannerUrl.length > 2048 || !/^(https:\/\/[^/@\s]+(?:\/[^\s]*)?|\/2006\/[^\s]+)$/.test(cue.bannerUrl))) return 'Use a direct HTTPS banner file URL, or a /2006/ asset path.';
  return null;
}
