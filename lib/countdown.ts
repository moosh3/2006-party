export interface CountdownCue {
  rank: number;
  startSeconds: number;
  durationSeconds: number;
  bannerUrl: string | null;
}

export const COUNTDOWN_LENGTHS: Record<number, number> = { 5: 15, 4: 30, 3: 45, 2: 60 };

export function countdownError(cue: CountdownCue, sourceDuration: number): string | null {
  if (!Number.isInteger(cue.rank) || cue.rank < 1 || cue.rank > 5) return 'Choose a countdown position from #5 to #1.';
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) return 'Add the exact video duration in the library first.';
  if (!Number.isFinite(cue.startSeconds) || cue.startSeconds < 0 || !Number.isFinite(cue.durationSeconds) || cue.durationSeconds <= 0) return 'Enter a valid highlight start and excerpt length in seconds.';
  if (cue.startSeconds + cue.durationSeconds > sourceDuration) return 'The excerpt extends past the end of this video.';
  if (cue.rank === 5 && cue.durationSeconds !== 15) return '#5 plays 15 seconds.';
  if (cue.rank === 1 && (cue.startSeconds !== 0 || cue.durationSeconds !== sourceDuration)) return '#1 plays the full video from the beginning.';
  if (cue.bannerUrl !== null && (typeof cue.bannerUrl !== 'string' || cue.bannerUrl.length > 2048 || !/^(https:\/\/[^/@\s]+(?:\/[^\s]*)?|\/2006\/[^\s]+)$/.test(cue.bannerUrl))) return 'Use a direct HTTPS banner file URL, or a /2006/ asset path.';
  return null;
}
