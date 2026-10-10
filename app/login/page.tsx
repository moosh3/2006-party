'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import MacAudienceGate from '@/components/2006/MacAudienceGate';
import { parseAudienceViewer } from '@/lib/audience-access';
import { adoptAudienceViewer, getViewerData } from '@/lib/viewer';

export default function LoginPage() {
  const router = useRouter();
  const [screenName, setScreenName] = useState('');
  const [existingSession, setExistingSession] = useState(false);
  const activeSignOn = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    document.title = 'Log In · 2006';
    setScreenName(getViewerData()?.displayName || '');
    const request = new AbortController();
    const timeout = window.setTimeout(() => request.abort(), 8000);
    async function restore() {
      try {
        const response = await fetch('/api/audience/sign-on', { cache: 'no-store', signal: request.signal });
        if (!response.ok) return;
        const viewer = parseAudienceViewer((await response.json()).viewer);
        if (viewer && !viewer.blocked && !request.signal.aborted) {
          adoptAudienceViewer(viewer);
          setScreenName(viewer.name);
          setExistingSession(true);
        }
      } catch { /* The explicit sign-on can retry a failed restore. */ }
      finally { window.clearTimeout(timeout); }
    }
    void restore();
    return () => { mounted.current = false; request.abort(); activeSignOn.current?.abort(); window.clearTimeout(timeout); };
  }, []);

  async function signOn(name: string) {
    const request = new AbortController();
    activeSignOn.current = request;
    const timeout = window.setTimeout(() => request.abort(), 10000);
    try {
      const response = await fetch('/api/audience/sign-on', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }), cache: 'no-store', signal: request.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Could not sign on. Please try again.');
      const viewer = parseAudienceViewer(data.viewer);
      if (!viewer || viewer.blocked) throw new Error('This screen name cannot join the show.');
      if (!mounted.current || request.signal.aborted) return;
      adoptAudienceViewer(viewer);
      try { sessionStorage.setItem('2006_party_initial_screen', 'show'); } catch { /* Show is the default. */ }
      router.push('/event');
    } catch (signOnError) {
      if (request.signal.aborted) throw new Error('The connection timed out. Please try again.');
      throw signOnError;
    } finally {
      window.clearTimeout(timeout);
      if (activeSignOn.current === request) activeSignOn.current = null;
    }
  }

  return <MacAudienceGate mode="login" screenName={screenName} existingSession={existingSession} onSignOn={signOn} />;
}
