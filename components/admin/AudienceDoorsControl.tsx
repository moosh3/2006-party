'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface DoorsState {
  doorsOpen: boolean;
  revision: number;
  changedAt: string;
}

function isDoorsState(value: unknown): value is DoorsState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return typeof state.doorsOpen === 'boolean' && typeof state.revision === 'number'
    && Number.isSafeInteger(state.revision) && state.revision >= 0
    && typeof state.changedAt === 'string' && Number.isFinite(Date.parse(state.changedAt));
}

export default function AudienceDoorsControl() {
  const [state, setState] = useState<DoorsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const busyRef = useRef(false);
  const lastRevision = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const id = ++sequence.current;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/admin/audience-doors', { cache: 'no-store', signal: controller.signal });
      const data: unknown = await response.json();
      if (controller.signal.aborted || id !== sequence.current) return;
      if (!response.ok || !isDoorsState(data)) {
        setError(response.status === 401 ? 'Admin session expired. Sign in again.' : 'Could not check the doors. Refresh before changing them.');
        return;
      }
      if (lastRevision.current !== null && lastRevision.current !== data.revision) {
        setConfirmClose(false);
        setMessage('');
      }
      lastRevision.current = data.revision;
      setState(data);
      setError('');
    } catch {
      if (id === sequence.current) {
        setError('Could not check the doors. Refresh before changing them.');
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 10000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      request.current?.abort();
      sequence.current += 1;
    };
  }, [refresh]);

  async function changeDoors(doorsOpen: boolean) {
    if (!state || busyRef.current || error) return;
    busyRef.current = true;
    setBusy(true);
    setMessage('');
    setError('');
    setConfirmClose(false);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const id = ++sequence.current;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/admin/audience-doors', {
        method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doorsOpen, expectedRevision: state.revision }),
      });
      const data: unknown = await response.json();
      if (controller.signal.aborted || id !== sequence.current) return;
      if (!response.ok || !isDoorsState(data)) {
        setError(response.status === 409
          ? 'Another admin changed the doors. Refresh and try again.'
          : 'Doors could not be changed. Refresh to check their current state.');
        return;
      }
      lastRevision.current = data.revision;
      setState(data);
      setMessage(data.doorsOpen ? 'Doors opened. Signed-in viewers can enter the show.' : 'Doors closed. Viewers see the waiting screen.');
    } catch {
      if (id === sequence.current) {
        setError('Connection interrupted. Refresh to check whether the doors changed.');
      }
    } finally {
      window.clearTimeout(timeout);
      busyRef.current = false;
      if (id === sequence.current) setBusy(false);
    }
  }

  return (
    <section className="twitch-card p-4 mb-4 sm:mb-6" aria-labelledby="audience-doors-heading">
      <div className="flex flex-col gap-3">
        <div>
          <h2 id="audience-doors-heading" className="text-lg font-semibold text-twitch-text">Audience doors</h2>
          <p className="text-sm mt-1" role="status">
            {state ? (state.doorsOpen ? 'Open: viewers can enter the show.' : 'Closed: viewers wait at the Mac login screen.') : 'Checking doors…'}
          </p>
          <p className="text-xs text-twitch-text-alt mt-1">Opening doors admits viewers. It does not start, pause or change the program.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="twitch-button min-h-[44px] px-4"
            disabled={!state || busy || Boolean(error)}
            onClick={() => state?.doorsOpen ? setConfirmClose(true) : void changeDoors(true)}>
            {busy ? 'Updating…' : state?.doorsOpen ? 'Close doors' : 'Open doors'}
          </button>
          <button type="button" className="twitch-button-secondary min-h-[44px] px-3" disabled={busy} onClick={() => void refresh()}>Refresh doors</button>
        </div>
      </div>
      {confirmClose && (
        <div className="mt-3 pt-3 border-t border-twitch-border">
          <p className="text-sm">Close doors for everyone? Current viewers will return to the waiting screen. Playback keeps running.</p>
          <div className="flex flex-wrap gap-2 mt-2">
            <button type="button" className="twitch-button-secondary min-h-[44px] px-3" onClick={() => setConfirmClose(false)}>Keep doors open</button>
            <button type="button" className="twitch-button min-h-[44px] px-3" disabled={busy || Boolean(error)} onClick={() => void changeDoors(false)}>Yes, close doors</button>
          </div>
        </div>
      )}
      {error ? <p role="alert" className="text-sm text-error mt-3">{error}</p> : null}
      {message ? <p role="status" className="text-sm mt-3">{message}</p> : null}
    </section>
  );
}
