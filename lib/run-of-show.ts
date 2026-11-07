export type ShowSurface = 'all' | 'online-and-room' | 'online-only' | 'live';

export type RunOfShowCue = {
  id: string;
  label: string;
  surface: ShowSurface;
  performerCue: string;
};

// Sequence transcribed from MK's run-of-show document (November 2026). Exact
// durations and media identifiers remain production inputs and are not guessed
// here. "Sprite" means the cast member's avatar on the website.
export const RUN_OF_SHOW: RunOfShowCue[] = [
  { id: 'pre-show-loop', label: 'Pre-show loop', surface: 'all', performerCue: 'Long intro loop that reminds people to vote several times' },
  { id: 'welcome', label: 'Welcome', surface: 'online-and-room', performerCue: 'Jen welcomes the room while Sprite Jen welcomes home viewers: voting is now closed' },
  { id: 'ads-1', label: 'Ads 1', surface: 'all', performerCue: "We'll Be Right Back #1, Ellen, Booty Booty Booty Booty" },
  { id: 'rules-of-the-game', label: 'Rules of the Game', surface: 'online-and-room', performerCue: 'Lip preps the rules in the room while Sprite Lip sets up online viewers to click around' },
  { id: 'ads-2', label: 'Ads 2', surface: 'all', performerCue: "We'll Be Right Back #2, First Gorillas Cut, Commercials, First Yongoo Cut" },
  { id: 'video-5', label: 'Video #5', surface: 'all', performerCue: 'Sprite Emma presents' },
  { id: 'clippy', label: 'Clippy', surface: 'online-and-room', performerCue: 'Clippy encourages a brave attendee to try the essay; virtual Clippy online' },
  { id: 'ads-3', label: 'Ads 3', surface: 'all', performerCue: "We'll Be Right Back #3, Second Yongoo Cut, MK Ring Tones One, insert, Second Gorillas Cut" },
  { id: 'video-4', label: 'Video #4', surface: 'all', performerCue: 'Sprite Yongoo presents' },
  { id: 'people-we-know', label: 'People We Know', surface: 'online-and-room', performerCue: 'Watch and react as the Sprites present our information' },
  { id: 'ads-4', label: 'Ads 4', surface: 'all', performerCue: "We'll Be Right Back #4, Third Gorillas, Last Yongoo, insert" },
  { id: 'video-3', label: 'Video #3', surface: 'all', performerCue: 'Sprite Jen presents' },
  { id: 'foreign-correspondent', label: 'Emma, our foreign correspondent', surface: 'online-and-room', performerCue: 'Emma takes one person on a journey while the Emma and Jen version plays on screens and at home' },
  { id: 'ads-5', label: 'Ads 5', surface: 'all', performerCue: 'Crazy Post Emma Ads #1, Fourth Gorillas, Crazy Post Emma Ads #2, MK Ring Tones Two, Crazy Post Emma Ads #3' },
  { id: 'something-went-wrong', label: 'Something went wrong', surface: 'all', performerCue: 'Error screen and sound, then cut to Life Is A Highway' },
  { id: 'life-is-a-highway', label: 'Life Is A Highway', surface: 'online-and-room', performerCue: 'Lip-sync to the edit from opposite sides of the room; flashlight on whoever is talking' },
  { id: 'ads-6', label: 'Ads 6', surface: 'all', performerCue: 'Urgent News Bulletin: news mash-up with silly adult commercials' },
  { id: 'video-2', label: 'Video #2', surface: 'all', performerCue: 'Sprite MK presents' },
  { id: 'check-our-scores', label: "Let's Check Our Scores", surface: 'online-and-room', performerCue: 'Scores window opens online; attendee reads their essay, then Alec reads audience submissions if time allows' },
  { id: 'ads-7', label: 'Ads 7', surface: 'all', performerCue: "We'll Be Right Back with your #1 Video, Last Gorillas, inserts" },
  { id: 'video-1', label: 'Video #1', surface: 'all', performerCue: 'Sprite Lip presents' },
  { id: 'when-we-were-young', label: 'When We Were Young', surface: 'online-and-room', performerCue: 'Same video in both places; performed live in the room' },
  { id: 'ending-loop', label: 'Ending loop', surface: 'all', performerCue: 'Ending loop video' },
];

export function getRunOfShowCue(id?: string | null) {
  if (!id) return null;
  return RUN_OF_SHOW.find((cue) => cue.id === id) || null;
}

export function getNextRunOfShowCue(id?: string | null) {
  if (!id) return null;
  const index = RUN_OF_SHOW.findIndex((cue) => cue.id === id);
  return index >= 0 ? RUN_OF_SHOW[index + 1] || null : null;
}

