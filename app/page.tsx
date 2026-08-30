'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AimWindow from '@/components/aim/AimWindow';
import { getViewerData } from '@/lib/viewer';

export default function LandingPage() {
  const router = useRouter();
  const [showPoster, setShowPoster] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasViewer, setHasViewer] = useState(false);

  useEffect(() => {
    document.title = '2006 · The Show';
    setHasViewer(Boolean(getViewerData()));

    fetch('/api/current', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setShowPoster(Boolean(data?.showPoster)))
      .catch(() => setShowPoster(false))
      .finally(() => setLoading(false));
  }, []);

  const doorsClosed = showPoster && !loading && !hasViewer;

  return (
    <div className="aim-desktop aim-landing">
      <a className="skip-link" href="#aim-landing-main">Skip to content</a>
      <main id="aim-landing-main" className="aim-landing-main">
        <div className="aim-landing-stack">
          <AimWindow
            title="2006 — Sign On"
            className="aim-landing-window"
            menuItems={['My AIM', 'People', 'Help']}
            status={doorsClosed ? 'Waiting for the show to open' : 'Ready'}
          >
            <div className="aim-landing-art">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/2006/art.png" alt="2006 — The Year, The Show, Live" />
            </div>
            <div className="aim-landing-body">
              <p>A live performance and online broadcast by Artistic Accessibility Collective.</p>
              {doorsClosed ? (
                <p className="aim-landing-notice" role="status">
                  The online room is not open yet. Keep this window nearby.
                </p>
              ) : (
                <button
                  type="button"
                  className="aim-xp-button aim-xp-button-primary aim-landing-button"
                  onClick={() => router.push(hasViewer ? '/event' : '/login')}
                >
                  {hasViewer ? 'Enter the show' : 'Sign on'}
                </button>
              )}
            </div>
          </AimWindow>
          <a className="aim-aac" href="https://www.artisticaccessibility.com" target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/2006/aac.png" alt="Artistic Accessibility Collective" />
          </a>
        </div>
      </main>
      <style jsx>{`
        .aim-landing { padding: 20px; }
        .aim-landing-main { min-height: calc(100dvh - 40px); display: grid; place-items: center; }
        .aim-landing-stack { width: min(100%, 430px); }
        .aim-landing-art { margin: 10px; overflow: hidden; border: 1px solid #6f6f6f; background: #000; box-shadow: inset 1px 1px 0 #3a3a3a; }
        .aim-landing-art img { display: block; width: 100%; height: auto; }
        .aim-landing-body { display: grid; gap: 12px; padding: 4px 18px 18px; text-align: center; font-size: 13px; line-height: 1.45; }
        .aim-landing-body p { margin: 0; }
        .aim-landing-notice { padding: 9px; border: 1px solid #b9b3a0; background: #fff; color: #555; }
        .aim-landing-button { justify-self: center; min-width: 150px; }
      `}</style>
    </div>
  );
}
