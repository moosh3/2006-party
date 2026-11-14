import type { GamePrompt } from './game-types';

export const SHOW_INVITATIONS = {
  welcome: { label: 'Jen: voting closed', note: 'After voting closes on the other website, show Jen’s announcement.' },
  clippy: { label: 'Clippy: study break', note: 'Invite viewers to write while the puppet Clippy video plays.' },
  'essay-last-call': { label: 'Essays: last call', note: 'Remind unfinished writers to submit before Let’s Check Our Scores.' },
} as const;

export type ShowInvitationKind = keyof typeof SHOW_INVITATIONS;
export type ShowInvitation = {
  id: string;
  showId: string;
  kind: ShowInvitationKind;
  trlStatus: 'open' | 'closed' | 'unavailable';
};

export function isShowInvitationKind(value: unknown): value is ShowInvitationKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHOW_INVITATIONS, value);
}

/** One show-scoped channel in the existing private operator action log. */
export const invitationActionType = (showId: string) => `audience_invitation:${showId}`;

export function readShowInvitation(
  show: { id: string; status: string },
  action: { id: number | string; details: unknown } | null,
  prompts: Pick<GamePrompt, 'kind' | 'status'>[],
): ShowInvitation | null {
  if (show.status !== 'active' || !action || !action.details || typeof action.details !== 'object') return null;
  const kind = (action.details as { kind?: unknown }).kind;
  if (!isShowInvitationKind(kind) || !/^\d+$/.test(String(action.id))) return null;
  const trl = prompts.filter(p => p.kind === 'trl' && p.status !== 'draft');
  return { id: String(action.id), showId: show.id, kind,
    trlStatus: trl.some(p => p.status === 'open') ? 'open' : trl.length ? 'closed' : 'unavailable' };
}

export const invitationStorageKey = (viewerId: string, showId: string) =>
  `2006_show_invitation_v1:${JSON.stringify([viewerId, showId])}`;

export function invitationCopy(invitation: ShowInvitation) {
  if (invitation.kind === 'welcome') return {
    speaker: 'Jen · SBconfetti', heading: 'Voting is closed.',
    body: null,
    action: null,
  };
  if (invitation.kind === 'essay-last-call') return {
    speaker: 'Clippy · homework patrol', heading: 'Pencils down(ish).',
    body: 'Let’s Check Our Scores is coming up. Saved is not submitted! Hand in your 2006 memory if you’d like it in tonight’s essay list.',
    action: 'Finish & submit',
  };
  return {
    speaker: 'Clippy · paperclip on duty', heading: 'STUDY BREAK!',
    body: 'Your away message has lore. Give us the director’s cut: pick a prompt, write a few lines, and submit before Let’s Check Our Scores.',
    action: 'Open my essay',
  };
}
