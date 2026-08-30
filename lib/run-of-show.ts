export type ShowSurface = 'all' | 'online-and-room' | 'online-only' | 'live';

export type RunOfShowCue = {
  id: string;
  label: string;
  surface: ShowSurface;
  performerCue: string;
};

// Sequence transcribed from the production document. Exact durations and media
// identifiers remain production inputs and are not guessed here.
export const RUN_OF_SHOW: RunOfShowCue[] = [
  { id: 'intro-supercut', label: '2006 super cut', surface: 'online-and-room', performerCue: 'Opening montage into the VJ introduction' },
  { id: 'welcome', label: 'Welcome', surface: 'online-and-room', performerCue: 'Welcome the room and remind the audience to vote' },
  { id: 'ad-spots-1', label: 'Ad spots', surface: 'all', performerCue: 'Caption and reset for the next live segment' },
  { id: 'game-of-2006', label: 'The game of being a kid in 2006', surface: 'online-and-room', performerCue: 'Explain the rules and begin the CD-burning task' },
  { id: 'videos-10-9', label: 'Countdown videos #10 and #9', surface: 'all', performerCue: 'Reset for the Clippy check-in' },
  { id: 'clippy-check-in', label: 'Does anyone need any help?', surface: 'online-and-room', performerCue: 'Check audience tasks and introduce Clippy' },
  { id: 'video-8-ads', label: 'Video #8 and ads', surface: 'all', performerCue: 'Move to the family computer for live AIM' },
  { id: 'live-aim', label: 'Live AIM message check', surface: 'live', performerCue: 'Answer audience messages; watch the visible computer clock' },
  { id: 'videos-7-6', label: 'Countdown videos #7 and #6', surface: 'all', performerCue: 'Reset for People We Know' },
  { id: 'people-we-know', label: 'People We Know', surface: 'online-and-room', performerCue: 'Share stories with supporting images on screen' },
  { id: 'ads-video-4', label: 'Ads and video #4', surface: 'all', performerCue: 'Prepare the remote correspondent feed' },
  { id: 'remote-correspondent', label: 'Remote correspondent', surface: 'online-and-room', performerCue: 'Follow the correspondent feed outside the room' },
  { id: 'ads-video-5', label: 'Ads and video #5', surface: 'all', performerCue: 'Reset for the keep-going sequence' },
  { id: 'keep-going', label: 'And we gotta just keep going', surface: 'online-and-room', performerCue: 'Move through the live sequence into the Nerf beat' },
  { id: 'video-3', label: 'Video #3', surface: 'all', performerCue: 'Prepare the quick comeback' },
  { id: 'awkward-comeback', label: 'Awkward quick comeback', surface: 'online-and-room', performerCue: 'Clippy checks the audience tasks' },
  { id: 'video-2', label: 'Video #2', surface: 'all', performerCue: 'Set for the full-group performance' },
  { id: 'when-you-were-young', label: 'When You Were Young', surface: 'online-and-room', performerCue: 'Full-group performance into the winning video' },
  { id: 'winning-video', label: 'Winning video', surface: 'all', performerCue: 'Play the complete #1 video' },
  { id: 'wrap', label: 'Wrap it up', surface: 'live', performerCue: 'Final VJ monologue and handoff into karaoke' },
  { id: 'online-karaoke', label: 'Online karaoke handoff', surface: 'online-only', performerCue: 'Send online viewers to the full playlist' },
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

