'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveViewerData } from '@/lib/viewer';
import '@/components/2006/experience.css';

const ANON_NAMES = [
  'xXbrokenheartXx', 'sk8rgrl2006', 'raWrXD', 'aimlessly_urs', 'ttyl_never',
  'MCRisMYlife', 'glitterbomb182', 'notURbabygurl', 'away_msg_only',
  'dialUpDarling', 'top8reject', 'sharpieCDR', 'flatironFatale',
  'myspaceTom_stan', 'T9poet', 'burnedUaMix',
];

function anonymousScreenName() {
  const storageKey = '2006_party_used_screen_names';
  let used: string[] = [];
  try { used = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { used = []; }
  const available = ANON_NAMES.filter((name) => !used.includes(name));
  const pool = available.length ? available : ANON_NAMES;
  const base = pool[Math.floor(Math.random() * pool.length)];
  const result = available.length ? base : `${base}${Math.floor(Math.random() * 89 + 10)}`;
  localStorage.setItem(storageKey, JSON.stringify([...used, base].slice(-40)));
  return result;
}

export default function LoginPage() {
  const router = useRouter();
  const [screenName, setScreenName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { document.title = 'Sign On · 2006'; }, []);

  const signOn = (requestedName?: string, initialScreen = 'home') => {
    const name = (requestedName || screenName).trim().slice(0, 20) || anonymousScreenName();
    if (name.length < 2) {
      setError('Screen name must be at least 2 characters.');
      return;
    }
    saveViewerData(`${name.toLowerCase().replace(/[^a-z0-9]+/g, '.') || 'anon'}@2006.local`, name, 'aim');
    sessionStorage.setItem('2006_party_initial_screen', initialScreen);
    router.push('/event');
  };

  return (
    <div className="aim-desktop xp2006-desktop">
      <a className="sr-only" href="#xp2006-signon">Skip to the window</a>
      <main id="xp2006-signon" className="xp2006-frame">
        <h1 className="sr-only">Sign On · 2006</h1>
        <section className="xp2006-window">
          <div className="xp2006-titlebar">
            <span className="xp2006-running-man" aria-hidden="true" />
            <span className="xp2006-title">Sign On</span>
            <span className="xp2006-window-buttons" aria-hidden="true"><span>_</span><span>□</span><span className="xp2006-signoff-x">×</span></span>
          </div>
          <form className="xp2006-signon-body" onSubmit={(event) => { event.preventDefault(); signOn(); }}>
            <div className="xp2006-signon-art">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/2006/art.png" alt="2006, the year, the show, live" />
            </div>
            <div className="xp2006-signon-rule" />
            <label className="xp2006-signon-row">
              <span>Screen Name</span>
              <span className="xp2006-signon-input"><input value={screenName} onChange={(event) => setScreenName(event.target.value)} maxLength={20} autoComplete="off" spellCheck={false} placeholder="<New User>" autoFocus /><i>▼</i></span>
            </label>
            <p className="xp2006-signon-hint">make up a screen name, or skip it and we&apos;ll pick one<br /><em>the password is being pure of heart</em></p>
            {error && <p className="xp2006-signon-error" role="alert">{error}</p>}
            <button type="button" className="xp2006-signon-anon" onClick={() => signOn(anonymousScreenName())}>Continue as Anon</button>
            <div className="xp2006-signon-checks" aria-hidden="true"><span><i /> Save password</span><span><i /> Auto-login</span></div>
            <div className="xp2006-signon-actions">
              <button type="button" onClick={() => signOn(anonymousScreenName(), 'show')}><span>❓</span>Help</button>
              <button type="button" onClick={() => signOn(anonymousScreenName(), 'graveyard')}><span>🔧</span>Setup</button>
              <button type="submit" className="go"><span className="xp2006-running-man big" aria-hidden="true" />Sign On</button>
            </div>
            <div className="xp2006-signon-version">Version: 2006 · ONLINE NOW &amp; TAKING SUBMISSIONS</div>
          </form>
        </section>
        <a className="xp2006-aac" href="https://www.artisticaccessibility.com" target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/2006/aac.png" alt="Artistic Accessibility Collective" />
        </a>
      </main>
    </div>
  );
}
