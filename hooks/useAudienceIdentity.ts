'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseAudienceViewer } from '@/lib/audience-access';
import { adoptAudienceViewer, type ViewerData } from '@/lib/viewer';

/** A browser label alone never admits someone: confirm the cookie-backed identity. */
export function useAudienceIdentity() {
  const router = useRouter();
  const [viewer, setViewer] = useState<ViewerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(previous => previous + 1), []);

  useEffect(() => {
    let cancelled = false;
    let active: AbortController | null = null;
    setError(null);
    async function restore() {
      if (active) return;
      const request = new AbortController();
      active = request;
      const timeout = window.setTimeout(() => request.abort(), 8000);
      try {
        const response = await fetch('/api/audience/sign-on', { cache: 'no-store', signal: request.signal });
        if (!response.ok) throw new Error('Could not confirm your screen name. Please try again.');
        const identity = parseAudienceViewer((await response.json()).viewer);
        if (cancelled || request.signal.aborted) return;
        if (!identity) { setViewer(null); router.replace('/login'); return; }
        if (identity.blocked) {
          setViewer(null);
          throw new Error('This screen name has been blocked by a moderator.');
        }
        setViewer(adoptAudienceViewer(identity));
        setError(null);
      } catch (restoreError) {
        if (!cancelled) setError(request.signal.aborted
          ? 'The connection timed out. Please try again.'
          : restoreError instanceof Error ? restoreError.message : 'Could not connect. Please try again.');
      } finally {
        window.clearTimeout(timeout);
        if (active === request) active = null;
      }
    }
    void restore();
    const resume = () => { if (document.visibilityState === 'visible') void restore(); };
    const timer = window.setInterval(resume, 30000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    return () => {
      cancelled = true;
      active?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
    };
  }, [router, attempt]);

  return { viewer, error, retry };
}
