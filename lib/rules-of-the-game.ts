export type RulesTourAction = 'superlative' | 'trl' | 'essay';
/** Page controls a step lights up, by their data-tour attribute. */
export type RulesTourHighlight = 'vote' | 'essay' | 'chat';
export type RulesTourStep = {
  id: string; title: string; body: string;
  action?: { label: string; target: RulesTourAction };
  highlight?: RulesTourHighlight;
  /** Names the highlighted control, so the pointer is not visual only. */
  pointer?: string;
};

/** What the Sprites say together after walking in (draft for MK). */
export const SPRITE_WELCOME = 'Welcome to 2006!';

// Self-paced setup wizard below the Sprites, separate from playing with them.
// Draft copy for MK's review (docs/rules-of-the-game.md).
export const RULES_TOUR: readonly RulesTourStep[] = [
  { id: 'welcome', title: 'Welcome to the show',
    body: 'Click a 2006er for a catchphrase. Extremely clickable, mildly chaotic. Take the quick tour below, or skip and explore.' },
  { id: 'superlatives', title: 'Vote in the cast superlatives',
    body: 'Who deserves each yearbook award? Pick a 2006er. You can change your vote until the host closes it.',
    action: { label: 'Vote now', target: 'superlative' },
    highlight: 'vote', pointer: 'Find them any time under the glowing Vote & Trivia buttons.' },
  { id: 'trl', title: 'Watch the countdown',
    body: 'Music-video voting happens on the other website. Watch the countdown here to see where the audience’s picks landed.' },
  { id: 'essay', title: 'Write your 2006 essay',
    body: 'A memory, a song, a questionable screen name. Write a few lines in TextEdit and submit before Let’s Check Our Scores. Saving a draft keeps it on your computer.',
    action: { label: 'Open essay', target: 'essay' },
    highlight: 'essay', pointer: 'Look for the glowing TextEdit icon and Essay due! link (Extras on phones).' },
  { id: 'chat', title: 'Chat with everyone watching',
    body: 'Say hi in AIM. Bring your best screen-name energy. The cast reads along during the show.',
    highlight: 'chat', pointer: 'The chat is in the glowing AIM window (Chat on phones).' },
  { id: 'done', title: 'You’re all set',
    body: 'Enjoy the show! After this segment, the Rules of the Game icon in the Dock (Extras on phones) brings this back.' },
];
