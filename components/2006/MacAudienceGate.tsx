'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import './mac-audience-gate.css';

export type MacAudienceGateProps = {
  mode: 'login' | 'waiting' | 'connecting';
  screenName?: string;
  existingSession?: boolean;
  onSignOn?: (name: string) => Promise<void>;
  onSignOff?: () => void;
  connectionError?: string | null;
  onRetry?: () => void;
};

export default function MacAudienceGate({
  mode,
  screenName,
  existingSession = false,
  onSignOn,
  onSignOff,
  connectionError,
  onRetry,
}: MacAudienceGateProps) {
  const nameId = useId();
  const helpId = useId();
  const errorId = useId();
  const [requestedName, setRequestedName] = useState(screenName || '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const edited = useRef(false);
  const visibleError = error || connectionError;

  useEffect(() => {
    if (!edited.current) setRequestedName(screenName || '');
  }, [screenName]);

  async function signOn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !onSignOn) return;

    const name = requestedName.trim();
    if (name.length < 2 || name.length > 20) {
      setError('Choose a screen name between 2 and 20 characters.');
      return;
    }

    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSignOn(name);
    } catch (signOnError) {
      setError(signOnError instanceof Error ? signOnError.message : 'Could not sign on. Please try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="mac2006-audience-gate" data-mode={mode}>
      <section className="mac2006-audience-login" aria-labelledby="mac2006-audience-title">
        <header className="mac2006-audience-login-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mac2006-audience-apple" src="/2006/mac-apple.svg" alt="" width={46} height={46} />
          <h1 id="mac2006-audience-title">2006</h1>
          <p>The year. The show. Live.</p>
        </header>

        <div className="mac2006-audience-login-body">
          <div className="mac2006-audience-account">
            <div className="mac2006-audience-account-icon" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/2006/icons/aim.png" alt="" width={56} height={56} />
            </div>
            <div>
              {mode === 'login' ? (
                <>
                  <h2>Welcome to 2006.</h2>
                  <p>Pick your screen name to sign on.</p>
                </>
              ) : mode === 'waiting' ? (
                <>
                  <p className="mac2006-audience-signed-on">Signed on as</p>
                  <h2 className="mac2006-audience-screen-name">{screenName || 'Audience member'}</h2>
                </>
              ) : (
                <>
                  <h2>Connecting to the show…</h2>
                  <p>Checking your screen name and the doors.</p>
                </>
              )}
            </div>
          </div>

          {mode === 'login' ? (
            <form className="mac2006-audience-form" onSubmit={signOn} noValidate aria-busy={busy}>
              <label htmlFor={nameId}>Screen name</label>
              <input
                id={nameId}
                name="screenName"
                value={requestedName}
                onChange={(event) => { edited.current = true; setRequestedName(event.target.value); setError(null); }}
                minLength={2}
                maxLength={20}
                autoComplete="nickname"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                required
                disabled={busy}
                aria-describedby={`${helpId}${visibleError ? ` ${errorId}` : ''}`}
                aria-invalid={Boolean(error)}
              />
              <p id={helpId} className="mac2006-audience-help">
                This becomes your AIM name and your name on the trivia scoreboard.
                {existingSession && <span> Returning? Your original screen name and score will be kept.</span>}
              </p>
              {visibleError && <p id={errorId} className="mac2006-audience-error" role="alert">{visibleError}</p>}
              <div className="mac2006-audience-login-actions">
                <span>No password needed.</span>
                <button type="submit" className="mac2006-audience-button primary" disabled={busy || !onSignOn}>
                  {busy ? 'Signing on…' : 'Sign on'}
                </button>
              </div>
            </form>
          ) : (
            <div className="mac2006-audience-waiting">
              {mode === 'waiting' && (
                <>
                  <div className="mac2006-audience-door-status">
                    <span className="mac2006-audience-status-light" aria-hidden="true" />
                    <h3>The show starts soon</h3>
                  </div>
                  <p>Keep this window open. You’ll enter automatically when the host opens the doors.</p>
                </>
              )}
              {visibleError ? (
                <div className="mac2006-audience-connection-error">
                  <p className="mac2006-audience-error" role="alert">{visibleError}</p>
                  {onRetry && <button type="button" className="mac2006-audience-button" onClick={onRetry}>Try again</button>}
                </div>
              ) : (
                <p className="mac2006-audience-connection" role="status">
                  {mode === 'connecting' ? 'Connecting…' : 'Waiting for the host to open doors.'}
                </p>
              )}
              {onSignOff && (
                <button type="button" className="mac2006-audience-button mac2006-audience-back" onClick={onSignOff}>Back to login</button>
              )}
            </div>
          )}
        </div>
        <footer className="mac2006-audience-login-footer">2006 · Audience sign-on</footer>
      </section>
      <p className="mac2006-audience-desktop-caption">After school, online.</p>
    </main>
  );
}
