'use client';
import { useCallback, useEffect, useState } from 'react';
import { invitationStorageKey, type ShowInvitation } from '@/lib/show-invitations';

/** Dismissal survives reconnects/reloads, but never hides another night's invitation. */
export function useShowInvitation(invitation: ShowInvitation | null, viewerId: string, enabled: boolean) {
  const scope = invitation ? invitationStorageKey(viewerId, invitation.showId) : null;
  const [ledger, setLedger] = useState<{ scope: string | null; dismissed: string | null }>({ scope: null, dismissed: null });
  useEffect(() => {
    if (!scope) return;
    setLedger(previous => {
      if (previous.scope === scope) return previous;
      let dismissed: string | null = null;
      try { dismissed = localStorage.getItem(scope); } catch { /* Keep a visit-local dismissal when storage is blocked. */ }
      return { scope, dismissed };
    });
  }, [scope]);
  const dismiss = useCallback(() => {
    if (!invitation || !scope) return;
    setLedger({ scope, dismissed: invitation.id });
    try { localStorage.setItem(scope, invitation.id); } catch { /* The in-memory dismissal still works. */ }
  }, [invitation, scope]);
  return { invitation: enabled && scope === ledger.scope && ledger.dismissed !== invitation?.id ? invitation : null, dismiss };
}
