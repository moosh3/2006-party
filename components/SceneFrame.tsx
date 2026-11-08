'use client';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { SPRITES, spriteLines, type Sprite } from '@/lib/cast';
import { RULES_TOUR, SPRITE_WELCOME, type RulesTourAction } from '@/lib/rules-of-the-game';
import { SCENES, type SceneId } from '@/lib/scenes';
import ScoresBoard from '@/components/ScoresBoard';
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

  if (sceneId === 'check-our-scores') return <ScoresBoard interactive={interactive} />;
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

/** Walk-in time before the Sprites have gathered: 2.4 s walk plus a 0.3 s stagger each. */
const ARRIVE_MS = 2400 + 300 * (SPRITES.length - 1) + 200;
/** Decorative MySpace glitter: [left %, top %, size, delay s]. */
const GLITTER: readonly [number, number, number, number][] = [
  [6, 10, 1.1, 0], [18, 34, 0.7, 1.2], [29, 8, 0.9, 0.6], [44, 22, 0.6, 2.1], [58, 6, 1, 1.5], [71, 30, 0.8, 0.3],
  [86, 12, 1.2, 1.9], [94, 40, 0.7, 0.9], [10, 58, 0.8, 2.4], [90, 62, 0.9, 1.1], [4, 86, 0.7, 0.4], [96, 88, 0.8, 1.7],
];
const WELCOME_MS = 5000;

/** Two things at once: the Sprites walk in, gather and greet guests, who can
 * click each one for its lines; below, a self-paced setup wizard shows the
 * rest of the site. Also reopened from the desktop after the segment airs. */
export function RulesOfTheGame({ title = SCENES['rules-of-the-game'].label, sessionId, actions, autoStartTour = true, entrance = autoStartTour }: {
  title?: string; sessionId?: string; actions?: SceneActions; autoStartTour?: boolean;
  /** Walk in from the left when the scene starts; the reopened window starts gathered. */
  entrance?: boolean;
}) {
  const bubbleId = useId();
  const [arrived, setArrived] = useState(!entrance);
  const [welcoming, setWelcoming] = useState(entrance);
  const [talking, setTalking] = useState<{ art: Sprite['art']; line: number } | null>(null);
  const clicks = useRef<Partial<Record<Sprite['art'], number>>>({});
  // The wizard is there from the start but never moves focus by itself.
  const [step, setStep] = useState<number | null>(() => (autoStartTour && !tourDone(sessionId) ? 0 : null));
  const audio = useRef<HTMLAudioElement | null>(null);
  const current = step === null ? null : RULES_TOUR[step];
  const speaker = SPRITES.find(sprite => sprite.art === talking?.art) || null;

  useEffect(() => {
    if (arrived) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setArrived(true), reduced ? 0 : ARRIVE_MS);
    return () => window.clearTimeout(timer);
  }, [arrived]);
  useEffect(() => {
    if (!arrived || !welcoming) return;
    const timer = window.setTimeout(() => setWelcoming(false), WELCOME_MS);
    return () => window.clearTimeout(timer);
  }, [arrived, welcoming]);
  useEffect(() => () => { audio.current?.pause(); }, []);
  // Light up the page controls this step is about (see scene-frame.css).
  const highlight = current?.highlight;
  useEffect(() => {
    if (!highlight) return;
    const root = document.documentElement;
    root.dataset.tourTarget = highlight;
    return () => { if (root.dataset.tourTarget === highlight) delete root.dataset.tourTarget; };
  }, [highlight]);
  const stopAudio = () => { audio.current?.pause(); audio.current = null; };
  // After a guest's own wizard click, keep keyboard focus on a sensible button
  // (a disabled or removed button would drop focus to the page).
  const nextButton = useRef<HTMLButtonElement>(null);
  const finishButton = useRef<HTMLButtonElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    // Only when the clicked button is gone or disabled; otherwise focus stays put.
    const active = document.activeElement as HTMLButtonElement | null;
    if (active && active !== document.body && active.isConnected && !active.disabled) return;
    (step === null ? startButton.current : nextButton.current || finishButton.current)?.focus();
  }, [step]);
  const goTo = (next: number) => { refocus.current = true; setStep(next); };
  const endTour = () => { refocus.current = true; setStep(null); markTourDone(sessionId); };

  /** Each click says the next of the Sprite's lines, back to the first after the last. */
  const speak = (sprite: Sprite) => {
    const lines = spriteLines(sprite);
    const count = clicks.current[sprite.art] ?? 0;
    const line = count % lines.length;
    clicks.current[sprite.art] = count + 1;
    setWelcoming(false);
    setTalking({ art: sprite.art, line });
    stopAudio();
    const src = sprite.lineAudio?.[line];
    if (src) {
      const clip = new Audio(src);
      audio.current = clip;
      void clip.play().catch(() => { /* a blocked or missing clip leaves the text */ });
    }
  };

  return (
    <section className="scene-frame scene-frame-audience scene-rules" aria-label={title}
      onKeyDown={event => { if (event.key === 'Escape' && talking) { stopAudio(); setTalking(null); } }}>
      <div className="scene-glitter" aria-hidden="true">
        {GLITTER.map(([left, top, size, delay]) => (
          <span key={`${left}-${top}`} style={{ left: `${left}%`, top: `${top}%`, fontSize: `${size}em`, animationDelay: `${delay}s` }}>✦</span>
        ))}
      </div>
      <div className="scene-stage" data-entering={!arrived || undefined}>
        {arrived && welcoming && <p className="scene-bubble scene-welcome" role="status">{SPRITE_WELCOME}</p>}
        <div className="scene-friends">
        <p className="scene-friends-title" aria-hidden="true">The 2006ers’ Friend Space</p>
        <ul className="scene-lineup">
          {SPRITES.map((sprite, i) => {
            const isTalking = talking?.art === sprite.art;
            return (
              <li key={sprite.art} style={{ '--i': i } as CSSProperties}
                data-align={i < 2 ? 'start' : i >= SPRITES.length - 2 ? 'end' : 'center'}>
                {isTalking && speaker && (
                  <div id={bubbleId} className="scene-bubble scene-line" role="status" aria-live="polite">
                    <p>{spriteLines(speaker)[talking.line]}</p>
                    <button type="button" disabled={!actions} onClick={() => actions?.openBuddy(speaker.index)}>Buddy Info</button>
                  </div>
                )}
                <button type="button" aria-label={`${sprite.name} (${sprite.screenName}): say something`}
                  aria-controls={isTalking ? bubbleId : undefined} onClick={() => speak(sprite)}>
                  {/* Still frames only: the Sprites walk and stand, they never spin. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/2006/cast/${sprite.art}.png`} alt="" width={32} height={48} />
                  <span>{sprite.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="scene-friends-count" aria-hidden="true">The 2006ers have <b>{SPRITES.length}</b> friends.</p>
        </div>
      </div>

      <div className="scene-wizard" role="region" aria-label={`${title}: getting started`}
        onKeyDown={event => { if (event.key === 'Escape' && current) { event.stopPropagation(); endTour(); } }}>
        {current ? (
          <>
            <div className="scene-wizard-title">
              <span>Getting started</span>
              <span>Step {step! + 1} of {RULES_TOUR.length}</span>
            </div>
            <div className="scene-wizard-body" aria-live="polite" aria-atomic="true">
              <p className="scene-wizard-heading">{current.title}</p>
              <p>{current.body}</p>
              {current.pointer && <p className="scene-tour-pointer">{current.pointer}</p>}
              {current.action && <button type="button" className="scene-wizard-action" disabled={!actions}
                onClick={() => actions?.open(current.action!.target)}>{current.action.label}</button>}
            </div>
            <div className="scene-wizard-footer">
              <ol className="scene-wizard-dots" aria-hidden="true">
                {RULES_TOUR.map((s, i) => <li key={s.id} data-current={i === step || undefined} data-done={i < step! || undefined} />)}
              </ol>
              <button type="button" disabled={step === 0} onClick={() => goTo(step! - 1)}>&lt; Back</button>
              {step! < RULES_TOUR.length - 1
                ? <button type="button" ref={nextButton} onClick={() => goTo(step! + 1)}>Next &gt;</button>
                : <button type="button" ref={finishButton} onClick={endTour}>Finish</button>}
              {step! < RULES_TOUR.length - 1 && <button type="button" onClick={endTour}>Skip</button>}
            </div>
          </>
        ) : (
          <button type="button" ref={startButton} className="scene-tour-start" onClick={() => goTo(0)}>Show me around</button>
        )}
      </div>
    </section>
  );
}
