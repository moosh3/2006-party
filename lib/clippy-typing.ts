// Clippy reacts to essay typing with live Clippy's catchphrases (MK's run of
// show, segment 3). The lines come from MK; until then this list stays empty
// and the essay helper reuses its existing lines rather than invented copy.
export const LIVE_CLIPPY_LINES: readonly string[] = [];

export const TYPING_PAUSE_MS = 1500;
export const MIN_NEW_WORDS = 8;
export const MIN_GAP_MS = 20_000;

export type TypingState = { lastSpokeAt: number | null; wordsAtLastLine: number };

export const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** After a pause in typing: speak only if the guest wrote enough since Clippy's
 * last line and enough time has passed, so Clippy never chatters. */
export function shouldSpeak(state: TypingState, now: number, words: number) {
  return words - state.wordsAtLastLine >= MIN_NEW_WORDS
    && (state.lastSpokeAt === null || now - state.lastSpokeAt >= MIN_GAP_MS);
}
