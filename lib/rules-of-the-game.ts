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
    body: 'Click the 2006ers above to hear what they have to say. When you’re ready, take a quick look around the site. Go at your own pace.' },
  { id: 'superlatives', title: 'Vote in the cast superlatives',
    body: 'Vote for the 2006er who fits each yearbook award. You can change your vote until the host closes it.',
    action: { label: 'Vote now', target: 'superlative' },
    highlight: 'vote', pointer: 'Find them any time under the glowing Vote & Trivia buttons.' },
  { id: 'trl', title: 'TRL voting is closed',
    body: 'Voting closed before the show. Watch the countdown to see where your pick landed.',
    action: { label: 'See TRL', target: 'trl' },
    highlight: 'vote', pointer: 'The TRL tab lives under the same glowing Vote & Trivia buttons.' },
  { id: 'essay', title: 'Write your 2006 essay',
    body: 'Open TextEdit, pick a prompt and write a few lines. Clippy is standing by to help.',
    action: { label: 'Open essay', target: 'essay' },
    highlight: 'essay', pointer: 'Look for the glowing TextEdit icon and Essay due! link (Extras on phones).' },
  { id: 'chat', title: 'Chat with everyone watching',
    body: 'Say hi in the AIM chat room. The cast reads it during the show.',
    highlight: 'chat', pointer: 'The chat is in the glowing AIM window (Chat on phones).' },
  { id: 'done', title: 'You’re all set',
    body: 'Enjoy the show! After this segment, the Rules of the Game icon in the Dock (Extras on phones) brings this back.' },
];
