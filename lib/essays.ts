// Shared by the TextEdit app and the essay API so stored prompts match what guests saw.
export const ESSAY_PROMPTS = [
  'Write about a song that made 2006 feel bigger than your bedroom.',
  'Describe the first online space where you felt like yourself.',
  'What did you think adulthood would look like in 2006?',
] as const;

export const ESSAY_MIN_CHARACTERS = 10;
export const ESSAY_MAX_CHARACTERS = 5000;

export type PublishedEssay = { id: string; screenName: string; prompt: string; body: string; createdAt: string };

/** Line breaks and tabs are allowed; other control characters, links and the
 * same basic profanity list as game suggestions are not. */
export function essayError(value: unknown): string | null {
  if (typeof value !== 'string') return 'Write your essay first.';
  const text = value.trim();
  if (text.length < ESSAY_MIN_CHARACTERS) return `Write at least ${ESSAY_MIN_CHARACTERS} characters.`;
  if (text.length > ESSAY_MAX_CHARACTERS) return `Keep it under ${ESSAY_MAX_CHARACTERS} characters.`;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) return 'Remove unusual characters and try again.';
  if (/\b(fuck\w*|shit\w*|cunt\w*)\b/i.test(text) || /https?:\/\/|www\./i.test(text)) return 'Please remove profanity or links.';
  return null;
}

export function isEssayPromptIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < ESSAY_PROMPTS.length;
}
