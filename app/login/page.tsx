'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AimWindow from '@/components/aim/AimWindow';
import { getViewerData, saveViewerData } from '@/lib/viewer';

export default function LoginPage() {
  const router = useRouter();
  const [screenName, setScreenName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = 'Sign On · 2006';
    if (getViewerData()) router.replace('/event');
  }, [router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/viewer/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, displayName: screenName }),
      });
      const data = await response.json();

      if (!data.valid) {
        setError(data.error || 'Unable to sign on');
        return;
      }

      saveViewerData(email, screenName, 'aim');
      router.push('/event');
    } catch {
      setError('Unable to sign on. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="aim-desktop aim-sign-on">
      <a className="skip-link" href="#aim-sign-on-main">Skip to content</a>
      <main id="aim-sign-on-main" className="aim-sign-on-main">
        <div className="aim-sign-on-stack">
          <AimWindow title="2006 — Sign On" menuItems={['My AIM', 'People', 'Help']} status="Screen names appear in the live chat">
            <form className="aim-sign-on-form" onSubmit={handleSubmit}>
              <div className="aim-sign-on-art">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/2006/art.png" alt="2006 — The Year, The Show, Live" />
              </div>

              <label>
                <span>Screen Name</span>
                <input
                  value={screenName}
                  onChange={(event) => setScreenName(event.target.value)}
                  autoComplete="username"
                  minLength={2}
                  maxLength={50}
                  required
                  disabled={loading}
                />
              </label>

              <label>
                <span>E-mail Address</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  disabled={loading}
                />
              </label>

              <p className="aim-sign-on-hint">Your screen name is public. Your email is not shown in chat.</p>
              {error && <p className="aim-sign-on-error" role="alert">{error}</p>}

              <div className="aim-sign-on-actions">
                <button type="button" className="aim-xp-button" onClick={() => router.push('/')} disabled={loading}>Cancel</button>
                <button type="submit" className="aim-xp-button aim-xp-button-primary" disabled={loading}>
                  {loading ? 'Signing on…' : 'Sign On'}
                </button>
              </div>
            </form>
          </AimWindow>
          <a className="aim-aac" href="https://www.artisticaccessibility.com" target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/2006/aac.png" alt="Artistic Accessibility Collective" />
          </a>
        </div>
      </main>
      <style jsx>{`
        .aim-sign-on { padding: 20px; }
        .aim-sign-on-main { min-height: calc(100dvh - 40px); display: grid; place-items: center; }
        .aim-sign-on-stack { width: min(100%, 430px); }
        .aim-sign-on-form { display: grid; gap: 10px; padding: 10px 12px 14px; }
        .aim-sign-on-art { overflow: hidden; border: 1px solid #6f6f6f; background: #000; box-shadow: inset 1px 1px 0 #3a3a3a; }
        .aim-sign-on-art img { display: block; width: 100%; height: auto; }
        .aim-sign-on-form label { display: grid; grid-template-columns: 108px 1fr; align-items: center; gap: 8px; font-size: 12px; }
        .aim-sign-on-form input { min-width: 0; border: 1px solid #808080; background: #fff; box-shadow: inset 1px 1px 0 #4a4a4a; font: inherit; padding: 5px 6px; }
        .aim-sign-on-hint { margin: 0; color: #5a5a52; font-size: 10px; line-height: 1.4; text-align: center; }
        .aim-sign-on-error { margin: 0; color: #a31616; font-size: 11px; text-align: center; }
        .aim-sign-on-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 2px; }
        @media (max-width: 420px) { .aim-sign-on-form label { grid-template-columns: 1fr; gap: 3px; } }
      `}</style>
    </div>
  );
}
