'use client';
import { invitationCopy, type ShowInvitation as Invitation } from '@/lib/show-invitations';
import ClippyAnimation from './ClippyAnimation';
import './show-invitation.css';

export default function ShowInvitation({ invitation, paused, onAction, onDismiss }: {
  invitation: Invitation; paused: boolean; onAction: () => void; onDismiss: () => void;
}) {
  const copy = invitationCopy(invitation);
  return <aside className="show-invitation" data-speaker={invitation.kind === 'welcome' ? 'jen' : 'clippy'} aria-label={copy.heading}>
    <div className="show-invitation-portrait">
      {invitation.kind === 'welcome'
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src="/2006/cast/jen.png" width="32" height="48" alt="" />
        : <ClippyAnimation compact reaction="hello" paused={paused} />}
    </div>
    <div className="show-invitation-copy" role="status" aria-live="polite" aria-atomic="true">
      <small>{copy.speaker}</small><strong>{copy.heading}</strong>{copy.body && <p>{copy.body}</p>}
    </div>
    <div className="show-invitation-actions">
      {copy.action && <button type="button" className="mac2006-aqua-button primary" onClick={onAction}>{copy.action}</button>}
      <button type="button" className="mac2006-aqua-button" onClick={onDismiss}>Keep watching</button>
    </div>
  </aside>;
}
