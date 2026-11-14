'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { SPRITES, spriteLines, type Sprite } from '@/lib/cast';
import { RULES_TOUR, SPRITE_WELCOME, type RulesTourAction } from '@/lib/rules-of-the-game';
import { SCENES, type SceneId } from '@/lib/scenes';
import ScoresBoard from '@/components/ScoresBoard';
import SpriteShowcase, { SpriteEntrance } from '@/components/SpriteShowcase';
import { SPRITE_PROFILES } from '@/lib/sprite-profiles';
import StageScene from '@/components/StageScene';
import { useScenePosition } from '@/hooks/useScenePosition';
import SceneMusic, { type SceneMusicMode } from '@/components/SceneMusic';
import { RESULTS_MUSIC, RULES_MUSIC } from '@/lib/scene-music';
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
  playbackDurationSeconds, snapshotReceivedAt, snapshotRoundTripMs, onStreamRefresh, actions, musicMode = 'auto' }: {
  sceneId: SceneId | null;
  /** Online guests click the lineup; stage and monitor automatically present the cast. */
  interactive: boolean;
  playbackSessionId?: string;
  playbackState?: string;
  playbackPositionSeconds?: number;
  playbackDurationSeconds?: number | null;
  snapshotReceivedAt?: number;
  snapshotRoundTripMs?: number;
  onStreamRefresh?: () => void;
  actions?: SceneActions;
  musicMode?: SceneMusicMode;
}) {
  const position = useScenePosition({ playbackState, playbackPositionSeconds, playbackDurationSeconds, snapshotReceivedAt, snapshotRoundTripMs });
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

  if (sceneId === 'check-our-scores') return <div className="scene-with-music" data-projector={!interactive || undefined}>
    <ScoresBoard interactive={interactive} paused={playbackState !== 'playing'} position={position} />
    {musicMode !== 'off' && <SceneMusic key={`${playbackSessionId}:${sceneId}`} track={RESULTS_MUSIC} position={position} playing={playbackState === 'playing'} mode={musicMode} />}
  </div>;
  if (sceneId === 'rules-of-the-game') return <div className="scene-with-music" data-projector={!interactive || undefined}>
    {interactive ? <RulesOfTheGame title={title} sessionId={playbackSessionId} actions={actions} />
      : <StageScene><SpriteShowcase position={position} paused={playbackState !== 'playing'} /></StageScene>}
    {musicMode !== 'off' && <SceneMusic key={`${playbackSessionId}:${sceneId}`} track={RULES_MUSIC} position={position} playing={playbackState === 'playing'} mode={musicMode} />}
  </div>;
  {
    return (
      <div className="scene-frame scene-frame-card" role="img" aria-label={`${title}. ${scene?.stageLine || ''}`}>
        <strong>{title}</strong>
        {scene?.stageLine && <span>{scene.stageLine}</span>}
      </div>
    );
  }
}

/** Decorative MySpace glitter: [left %, top %, size, delay s]. */
const GLITTER: readonly [number, number, number, number][] = [
  [6, 10, 1.1, 0], [18, 34, 0.7, 1.2], [29, 8, 0.9, 0.6], [44, 22, 0.6, 2.1], [58, 6, 1, 1.5], [71, 30, 0.8, 0.3],
  [86, 12, 1.2, 1.9], [94, 40, 0.7, 0.9], [10, 58, 0.8, 2.4], [90, 62, 0.9, 1.1], [4, 86, 0.7, 0.4], [96, 88, 0.8, 1.7],
];
const TYPE_MS = 22;
/** How long a Sprite stays out after its bubble has finished typing, until a guest takes over. */
const LINGER_MS = 6000;

/** What a Sprite says as it walks out: its own description from the character sheet. */
function spriteIntro(sprite: Sprite) {
  const description = SPRITE_PROFILES[sprite.art]?.description.replace(/\s+/g, ' ').trim();
  return description || `Hi! I’m ${sprite.name}. Find me on AIM: ${sprite.screenName}.`;
}

/** Types the bubble out letter by letter. The whole line is laid out from the
 * start so the bubble never resizes, and screen readers get it in one piece. */
function TypedLine({ text, animate }: { text: string; animate: boolean }) {
  const [count, setCount] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate) { setCount(text.length); return; }
    setCount(0);
    const timer = window.setInterval(() => setCount(shown => {
      if (shown >= text.length) { window.clearInterval(timer); return shown; }
      return shown + 1;
    }), TYPE_MS);
    return () => window.clearInterval(timer);
  }, [text, animate]);
  return <>
    <span className="sr-only">{text}</span>
    <span aria-hidden="true">{text.slice(0, count)}<span className="scene-bubble-rest">{text.slice(count)}</span></span>
  </>;
}

/** One Sprite at a time walks out, says its piece in a typed speech bubble and
 * shows its profile card; guests pick who is next and click for catchphrases.
 * The self-paced tour runs along the bottom. Also reopened from the desktop
 * after the segment airs. */
export function RulesOfTheGame({ title = SCENES['rules-of-the-game'].label, sessionId, actions, autoStartTour = true, entrance = autoStartTour }: {
  title?: string; sessionId?: string; actions?: SceneActions; autoStartTour?: boolean;
  /** The Sprites take turns walking out until a guest picks one; the reopened window waits for the guest. */
  entrance?: boolean;
}) {
  const bubbleId = useId();
  const [motionAllowed, setMotionAllowed] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotionAllowed(!reduced.matches);
    update();
    reduced.addEventListener('change', update);
    return () => reduced.removeEventListener('change', update);
  }, []);
  // `line` is null for the walk-out introduction, otherwise one of the Sprite's three lines.
  const [show, setShow] = useState<{ person: number; line: number | null; turn: number }>({ person: 0, line: null, turn: 0 });
  const [touring, setTouring] = useState(entrance);
  // Catchphrases said so far by each Sprite that has been out.
  const clicks = useRef<Partial<Record<Sprite['art'], number>>>({ [SPRITES[0].art]: 0 });
  // The wizard is there from the start but never moves focus by itself.
  const [step, setStep] = useState<number | null>(() => (autoStartTour && !tourDone(sessionId) ? 0 : null));
  const audio = useRef<HTMLAudioElement | null>(null);
  const current = step === null ? null : RULES_TOUR[step];
  const sprite = SPRITES[show.person];
  const profile = SPRITE_PROFILES[sprite.art];
  const said = show.line === null
    ? `${entrance && show.turn === 0 ? `${SPRITE_WELCOME} ` : ''}${spriteIntro(sprite)}`
    : spriteLines(sprite)[show.line];

  useEffect(() => () => { audio.current?.pause(); }, []);
  // Until a guest picks someone, the next Sprite walks out once this one has been read.
  useEffect(() => {
    if (!touring || !motionAllowed) return;
    const timer = window.setTimeout(() => {
      setShow(now => {
        const person = (now.person + 1) % SPRITES.length;
        clicks.current[SPRITES[person].art] ??= 0;
        return { person, line: null, turn: now.turn + 1 };
      });
    }, said.length * TYPE_MS + LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [touring, motionAllowed, said, show.turn]);
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

  /** A Sprite new to the stage walks out and introduces itself. After that each
   * click says the next of its lines, back to the first after the last. */
  const speak = (person: number) => {
    const chosen = SPRITES[person];
    const count = clicks.current[chosen.art];
    setTouring(false);
    stopAudio();
    if (count === undefined) {
      clicks.current[chosen.art] = 0;
      setShow(now => ({ person, line: null, turn: now.turn + 1 }));
      return;
    }
    const line = count % spriteLines(chosen).length;
    clicks.current[chosen.art] = count + 1;
    setShow(now => ({ person, line, turn: now.turn + 1 }));
    const src = chosen.lineAudio?.[line];
    if (src) {
      const clip = new Audio(src);
      audio.current = clip;
      void clip.play().catch(() => { /* a blocked or missing clip leaves the text */ });
    }
  };

  return (
    <section className="scene-frame scene-frame-audience scene-rules" aria-label={title}
      onKeyDown={event => { if (event.key === 'Escape') stopAudio(); }}>
      <div className="scene-glitter" aria-hidden="true">
        {GLITTER.map(([left, top, size, delay]) => (
          <span key={`${left}-${top}`} style={{ left: `${left}%`, top: `${top}%`, fontSize: `${size}em`, animationDelay: `${delay}s` }}>✦</span>
        ))}
      </div>
      <h2 className="scene-rules-title">{title}</h2>
      <div className="scene-show">
        <div className="scene-host">
          <p id={bubbleId} className="scene-bubble" role="status" data-kind={show.line === null ? 'intro' : 'line'}>
            <TypedLine key={show.turn} text={said} animate={motionAllowed} />
          </p>
          <button type="button" className="scene-host-sprite" key={sprite.art} aria-controls={bubbleId}
            aria-label={`${sprite.name} (${sprite.screenName}): say something`} onClick={() => speak(show.person)}>
            <SpriteEntrance art={sprite.art} motionAllowed={motionAllowed} paused={false} />
            <span className="scene-host-name"><b>{sprite.name}</b>{sprite.screenName}</span>
            <span className="scene-host-hint" aria-hidden="true">click me!</span>
          </button>
        </div>
        <article className="scene-card" key={sprite.art} aria-label={`${sprite.name}’s profile card`}>
          <p className="scene-card-top"><span>2006er {show.person + 1}/{SPRITES.length}</span><b>{profile?.asl || sprite.screenName}</b></p>
          <h3>{profile?.characterName || sprite.name}</h3>
          <p className="scene-card-brand">{profile?.archetype || 'In their own words'}</p>
          {profile ? (
            <dl>{profile.stats.map(stat => <div key={stat.name}><dt>{stat.name}</dt><dd>{stat.bonus}</dd></div>)}</dl>
          ) : (
            <dl>{spriteLines(sprite).map((phrase, i) => <div key={i}><dt>{['Celebrate', 'Bummer', 'Extra'][i]}</dt><dd>{phrase}</dd></div>)}</dl>
          )}
          {profile && <div className="scene-card-extras">
            <p className="scene-card-song"><b>Theme song</b> {profile.themeSong}</p>
            {profile.conditions.length > 0 && <p className="scene-card-status"><b>Status</b>{profile.conditions.map(condition => <span key={condition}>{condition}</span>)}</p>}
          </div>}
          <button type="button" className="scene-card-cta" disabled={!actions} onClick={() => actions?.openBuddy(sprite.index)}>View full profile</button>
        </article>
      </div>
      <ul className="scene-lineup" aria-label="Pick a 2006er">
        {SPRITES.map((friend, i) => (
          <li key={friend.art}>
            <button type="button" aria-current={i === show.person ? 'true' : undefined} aria-controls={bubbleId}
              aria-label={i === show.person ? `${friend.name}: say something` : `Bring out ${friend.name}`} onClick={() => speak(i)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/2006/cast/${friend.art}.png`} alt="" width={32} height={48} />
              <span>{friend.name}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="scene-wizard" role="region" aria-label={`${title}: getting started`} data-done={!current || undefined}
        onKeyDown={event => { if (event.key === 'Escape' && current) { event.stopPropagation(); endTour(); } }}>
        {current ? (
          <>
            <div className="scene-wizard-title">
              <span>How to play</span>
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
