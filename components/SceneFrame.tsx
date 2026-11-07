'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { SPRITES, type Sprite } from '@/lib/cast';
import { RULES_TOUR, type RulesTourAction } from '@/lib/rules-of-the-game';
import { SCENES, type SceneId } from '@/lib/scenes';
import './scene-frame.css';

export type SceneActions = {
  openBuddy: (index: number) => void;
  open: (target: RulesTourAction) => void;
};

const tourKey = (sessionId?: string) => `2006_rules_tour_done_${sessionId || 'unknown'}`;
function tourDone(sessionId?: string) {
  try { return sessionStorage.getItem(tourKey(sessionId)) === '1'; } catch { return false; }
}
function markTourDone(sessionId?: string) {
  try { sessionStorage.setItem(tourKey(sessionId), '1'); } catch { /* the tour simply reappears */ }
}

/** A timed scene in place of program video. The database clock owns when it
 * starts and ends; this only renders it and asks for a refresh at its end. */
export default function SceneFrame({ sceneId, interactive, playbackSessionId, playbackState, playbackPositionSeconds,
  playbackDurationSeconds, snapshotReceivedAt, onStreamRefresh, actions }: {
  sceneId: SceneId | null;
  /** Online audience gets the lineup; stage and operator monitor get a card. */
  interactive: boolean;
  playbackSessionId?: string;
  playbackState?: string;
  playbackPositionSeconds?: number;
  playbackDurationSeconds?: number | null;
  snapshotReceivedAt?: number;
  onStreamRefresh?: () => void;
  actions?: SceneActions;
}) {
  const scene = sceneId ? SCENES[sceneId] : null;
  const title = scene?.label || 'Interactive scene';

  useEffect(() => {
    // A refresh hint at the projected end; periodic snapshots still recover if it is missed.
    if (!onStreamRefresh || playbackState !== 'playing' || !playbackDurationSeconds
      || playbackPositionSeconds === undefined || snapshotReceivedAt === undefined) return;
    const remainingMs = (playbackDurationSeconds - playbackPositionSeconds) * 1000
      - (performance.now() - snapshotReceivedAt) + 250;
    if (!Number.isFinite(remainingMs)) return;
    const timer = window.setTimeout(onStreamRefresh, Math.max(250, remainingMs));
    return () => window.clearTimeout(timer);
  }, [onStreamRefresh, playbackState, playbackDurationSeconds, playbackPositionSeconds, snapshotReceivedAt]);

  if (!interactive || sceneId !== 'rules-of-the-game') {
    return (
      <div className="scene-frame scene-frame-card" role="img" aria-label={`${title}. ${scene?.stageLine || ''}`}>
        <strong>{title}</strong>
        {scene?.stageLine && <span>{scene.stageLine}</span>}
      </div>
    );
  }
  return <RulesOfTheGame title={title} sessionId={playbackSessionId} actions={actions} />;
}

/** The lineup and tour; also reopened from the desktop after the segment airs. */
export function RulesOfTheGame({ title = SCENES['rules-of-the-game'].label, sessionId, actions, autoStartTour = true }: {
  title?: string; sessionId?: string; actions?: SceneActions; autoStartTour?: boolean;
}) {
  const bubbleId = useId();
  const [openArt, setOpenArt] = useState<Sprite['art'] | null>(null);
  // The tour starts with the scene, once per cue; it never moves focus by itself.
  const [step, setStep] = useState<number | null>(() => (autoStartTour && !tourDone(sessionId) ? 0 : null));
  const audio = useRef<HTMLAudioElement | null>(null);
  const open = SPRITES.find(sprite => sprite.art === openArt) || null;
  const current = step === null ? null : RULES_TOUR[step];
  const presenter = current ? SPRITES.find(sprite => sprite.art === current.presenter) : null;

  useEffect(() => () => { audio.current?.pause(); }, []);
  const stopAudio = () => { audio.current?.pause(); audio.current = null; };
  const play = (src: string) => {
    stopAudio();
    const clip = new Audio(src);
    audio.current = clip;
    void clip.play().catch(() => { /* a blocked or missing clip leaves the text */ });
  };
  const endTour = () => { setStep(null); markTourDone(sessionId); };

  return (
    <section className="scene-frame scene-frame-audience" aria-label={title}>
      <h2>{title}</h2>
      <ul className="scene-lineup">
        {SPRITES.map(sprite => (
          <li key={sprite.art} data-presenting={presenter?.art === sprite.art || undefined}>
            <button type="button" aria-expanded={openArt === sprite.art} aria-controls={bubbleId}
              onClick={() => { stopAudio(); setOpenArt(openArt === sprite.art ? null : sprite.art); }}>
              <picture>
                <source media="(prefers-reduced-motion: reduce)" srcSet={`/2006/cast/${sprite.art}.png`} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/2006/cast/${sprite.art}.gif`} alt="" width={32} height={48} />
              </picture>
              <span>{sprite.name}</span>
            </button>
          </li>
        ))}
      </ul>

      {open && (
        <div id={bubbleId} className="scene-bubble" role="group" aria-label={`${open.name} (${open.screenName})`}
          onKeyDown={event => { if (event.key === 'Escape') { stopAudio(); setOpenArt(null); } }}>
          <p className="scene-bubble-name">{open.name} · {open.screenName}</p>
          {open.catchphrase && <p className="scene-bubble-line">“{open.catchphrase}”</p>}
          <div className="scene-actions">
            {open.catchphraseAudio && <button type="button" onClick={() => play(open.catchphraseAudio!)}>Play catchphrase</button>}
            <button type="button" disabled={!actions} onClick={() => actions?.openBuddy(open.index)}>View profile</button>
            <button type="button" onClick={() => { stopAudio(); setOpenArt(null); }}>Close</button>
          </div>
        </div>
      )}

      {current && presenter ? (
        <div className="scene-tour" role="region" aria-label={`${title} tour`}
          onKeyDown={event => { if (event.key === 'Escape') endTour(); }}>
          <picture className="scene-tour-presenter">
            <source media="(prefers-reduced-motion: reduce)" srcSet={`/2006/cast/${presenter.art}.png`} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/2006/cast/${presenter.art}.gif`} alt="" width={32} height={48} />
          </picture>
          <div aria-live="polite" aria-atomic="true">
            <p className="scene-tour-meta">Sprite {presenter.name} · {step! + 1} of {RULES_TOUR.length}</p>
            <p className="scene-tour-title">{current.title}</p>
            <p>{current.body}</p>
          </div>
          <div className="scene-actions">
            {current.action && <button type="button" disabled={!actions} onClick={() => actions?.open(current.action!.target)}>{current.action.label}</button>}
            <button type="button" disabled={step === 0} onClick={() => setStep(step! - 1)}>Back</button>
            {step! < RULES_TOUR.length - 1
              ? <button type="button" onClick={() => setStep(step! + 1)}>Next</button>
              : <button type="button" onClick={endTour}>Done</button>}
            {step! < RULES_TOUR.length - 1 && <button type="button" onClick={endTour}>Skip tour</button>}
          </div>
        </div>
      ) : (
        <button type="button" className="scene-tour-start" onClick={() => setStep(0)}>Show me around</button>
      )}
    </section>
  );
}
