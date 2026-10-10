'use client';

import { useState, type CSSProperties } from 'react';
import { CAST_RUNS, getCastRunCanvasScale, type CastRunId } from '@/lib/cast-runs';
import type { CastRun, CastRunOrigin } from '@/hooks/useCastRun';

export type ShowBuddy = { art: CastRunId; name: string; screenName: string; index: number };

export default function ShowBuddyStrip({ buddies, origin, run, canRun, reducedMotion, paused, onRun, onLoad, onFinish, onOpen, onToggleMotion }: {
  buddies: readonly ShowBuddy[];
  origin: CastRunOrigin;
  run: CastRun | null;
  canRun: boolean;
  reducedMotion: boolean;
  paused: boolean;
  onRun: (art: CastRunId, origin: CastRunOrigin) => boolean;
  onLoad: (nonce: string) => void;
  onFinish: (nonce?: string) => boolean;
  onOpen: (index: number) => void;
  onToggleMotion: () => void;
}) {
  const [error, setError] = useState(false);
  const ownedRun = run?.origin === origin && canRun ? run : null;
  const runner = buddies.find(buddy => buddy.art === ownedRun?.art);
  const asset = ownedRun ? CAST_RUNS[ownedRun.art] : null;
  const start = (art: CastRunId) => { if (onRun(art, origin)) setError(false); };
  const status = error ? 'Couldn’t load that run. Try again.' : ownedRun
    ? `${runner?.name} ${ownedRun.loaded ? 'is running!' : 'is getting ready…'}`
    : reducedMotion ? 'Motion off. Names open buddy info.'
    : paused ? 'Sprites paused. Names open buddy info.' : 'Tap a sprite to run. Names open buddy info.';

  return (
    <nav className="show2006-buddy-strip" data-motion-off={reducedMotion} aria-label="Meet the 2006ers">
      <div className="show2006-cast-intro">
        <strong>the 2006ers</strong>
        <small>{error ? 'Run didn’t load. Try again.' : reducedMotion ? 'motion off · names = info' : paused ? 'paused · names = info' : 'tap to run · names = info'}</small>
        <a className="show2006-art-credit" aria-label="Original sprites from Artistic Accessibility Collective (opens a new tab)" href="https://www.artisticaccessibility.com/2006/show" target="_blank" rel="noopener noreferrer">AAC sprites ↗</a>
      </div>
      <div className="show2006-cast-roster">
        <div className="show2006-cast-slots">
          {buddies.map(buddy => (
            <div className="show2006-cast-slot" key={buddy.art} data-running={Boolean(ownedRun?.loaded && buddy.art === ownedRun.art)}>
              <button type="button" className="show2006-sprite-button" aria-label={`Make ${buddy.name} run`} title={`Tap ${buddy.name} to run. Their name opens Buddy Info.`} aria-disabled={!canRun || Boolean(run)} onClick={() => start(buddy.art)}>
                <picture>
                  <source media="(prefers-reduced-motion: reduce)" srcSet={`/2006/cast/${buddy.art}.png`} />
                  {/* Complete original idle animation; paused and reduced-motion use the original still. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/2006/cast/${buddy.art}.${paused || reducedMotion ? 'png' : 'gif'}`} alt="" width={32} height={48} />
                </picture>
                {ownedRun && asset && buddy.art === ownedRun.art && (
                  <span className="show2006-run-stage" aria-hidden="true" style={{ '--cast-run-scale': getCastRunCanvasScale(buddy.art) } as CSSProperties}>
                    {/* A unique request replays every frame of the untouched one-shot GIF, not a CSS imitation. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img key={ownedRun.nonce} className="show2006-running-sprite" src={`${asset.src}?run=${ownedRun.nonce}`} width={asset.width} height={asset.height} alt="" onLoad={() => onLoad(ownedRun.nonce)} onError={() => { if (onFinish(ownedRun.nonce)) setError(true); }} />
                  </span>
                )}
              </button>
              <button type="button" className="show2006-name-button" aria-label={`Buddy Info: ${buddy.screenName}`} title={buddy.screenName} onClick={() => onOpen(buddy.index)}>{buddy.name}</button>
            </div>
          ))}
        </div>
        <p className="show2006-run-status" data-error={error} role="status" aria-live="polite" aria-atomic="true">{status}</p>
      </div>
      <button type="button" className="show2006-motion" onClick={onToggleMotion} aria-label={paused ? 'Play sprites' : 'Pause sprites'} aria-pressed={paused}>{paused ? 'Play' : 'Pause'}</button>
    </nav>
  );
}
