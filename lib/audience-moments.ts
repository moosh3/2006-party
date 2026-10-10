// Audience moments: one-off beats the operator pushes to every online viewer
// at the same time (a Clippy line, a window opening, a nudge to vote). They
// are independent of the media queue, so they work in manual playout and do
// not need a locked run of show.

export const AUDIENCE_MOMENT_ACTIONS = ['none', 'vote', 'mail', 'essay', 'chat'] as const;
export type AudienceMomentAction = (typeof AUDIENCE_MOMENT_ACTIONS)[number];

export type AudienceMoment = {
  id: string;
  message: string;
  action: AudienceMomentAction;
  actionLabel: string | null;
  // When true the target window is opened for the viewer immediately rather
  // than waiting for them to press Clippy's button.
  autoOpen: boolean;
  sentAt: string;
  // A clear is stored as its own timestamped moment (rather than NULL) so
  // clients can order it against realtime and polled copies of older moments.
  cleared?: boolean;
};

export type AudienceMomentInput = Omit<AudienceMoment, 'id' | 'sentAt' | 'cleared'>;

// Viewers who join (or reconnect) within this window still see the moment.
export const AUDIENCE_MOMENT_TTL_MS = 10 * 60 * 1000;
export const AUDIENCE_MOMENT_MAX_LENGTH = 280;

export const AUDIENCE_MOMENT_ACTION_LABEL: Record<AudienceMomentAction, string> = {
  none: 'Just Clippy',
  vote: 'Vote panel',
  mail: 'Mail (essay assignment)',
  essay: 'TextEdit (essay)',
  chat: 'AIM chat room',
};

const DEFAULT_BUTTON: Record<AudienceMomentAction, string | null> = {
  none: null,
  vote: 'Vote Now',
  mail: 'Check Mail',
  essay: 'Open Essay',
  chat: 'Open Chat',
};

export function defaultActionLabel(action: AudienceMomentAction) {
  return DEFAULT_BUTTON[action];
}

// Placeholder copy. Swap these for the production wording as beats lock.
export const AUDIENCE_MOMENT_PRESETS: { label: string; moment: AudienceMomentInput }[] = [
  {
    label: 'Need any help?',
    moment: {
      message: 'It looks like you’re watching a play. Does anyone need any help?',
      action: 'none', actionLabel: null, autoOpen: false,
    },
  },
  {
    label: 'Vote now',
    moment: {
      message: 'Voting is open! Pick your video before the countdown keeps going.',
      action: 'vote', actionLabel: 'Vote Now', autoOpen: true,
    },
  },
  {
    label: 'You’ve got mail',
    moment: {
      message: 'You’ve got mail! Your essay assignment just came in.',
      action: 'mail', actionLabel: 'Check Mail', autoOpen: true,
    },
  },
  {
    label: 'Work on your essay',
    moment: {
      message: 'It looks like you’re writing an essay. Time is running out!',
      action: 'essay', actionLabel: 'Open Essay', autoOpen: false,
    },
  },
  {
    label: 'Say hi in chat',
    moment: {
      message: 'The chat room is hopping. Say hi to everyone watching!',
      action: 'chat', actionLabel: 'Open Chat', autoOpen: true,
    },
  },
];

export function isAudienceMomentAction(value: unknown): value is AudienceMomentAction {
  return typeof value === 'string' && (AUDIENCE_MOMENT_ACTIONS as readonly string[]).includes(value);
}

// Parses an untrusted value (DB row, realtime payload) into a moment, or null.
export function parseAudienceMoment(value: unknown): AudienceMoment | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || typeof candidate.message !== 'string') return null;
  if (typeof candidate.sentAt !== 'string' || Number.isNaN(Date.parse(candidate.sentAt))) return null;
  if (candidate.cleared === true) {
    return { id: candidate.id, message: '', action: 'none', actionLabel: null, autoOpen: false, sentAt: candidate.sentAt, cleared: true };
  }
  if (!candidate.message.trim()) return null;
  const action = isAudienceMomentAction(candidate.action) ? candidate.action : 'none';
  return {
    id: candidate.id,
    message: candidate.message.slice(0, AUDIENCE_MOMENT_MAX_LENGTH),
    action,
    actionLabel: typeof candidate.actionLabel === 'string' && candidate.actionLabel.trim()
      ? candidate.actionLabel.trim().slice(0, 40)
      : defaultActionLabel(action),
    autoOpen: candidate.autoOpen === true && action !== 'none',
    sentAt: candidate.sentAt,
  };
}

export function isAudienceMomentFresh(moment: AudienceMoment, now = Date.now()) {
  return now - Date.parse(moment.sentAt) <= AUDIENCE_MOMENT_TTL_MS;
}

// True when `incoming` was sent after `current` (or there is no current).
export function isNewerAudienceMoment(incoming: AudienceMoment, current: AudienceMoment | null) {
  if (!current) return true;
  if (incoming.id === current.id) return false;
  return Date.parse(incoming.sentAt) >= Date.parse(current.sentAt);
}
