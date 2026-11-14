'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { CastRunId } from '@/lib/cast-runs';
import { CAST_SHOWCASE } from '@/lib/cast-showcase';
import { SPRITES, spriteLines } from '@/lib/cast';
import { SPRITE_PROFILES } from '@/lib/sprite-profiles';
import { spriteSpotlight } from '@/lib/scene-presentation';
import './sprite-showcase.css';

/** Show the complete original animation once, then leave the still portrait. */
export function SpriteEntrance({ art, motionAllowed, paused }: { art: CastRunId; motionAllowed: boolean; paused: boolean }) {
  const instance = useId();
  const [finished, setFinished] = useState(false);
  const started = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animate = motionAllowed && !paused && !finished;
  useEffect(() => {
    // Pausing or hiding an entrance settles it; resuming must not replay it.
    if (!animate && started.current) setFinished(true);
    return () => { if (timer.current !== null) clearTimeout(timer.current); };
  }, [animate]);
  const loaded = () => {
    if (!animate || started.current) return;
    started.current = true;
    timer.current = setTimeout(() => setFinished(true), CAST_SHOWCASE[art].durationMs);
  };
  return <div className="sprite-show-portrait" data-animated={animate || undefined}>
    {/* A fresh request starts the GIF at its first frame when this profile enters. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={animate ? `${CAST_SHOWCASE[art].src}?entrance=${encodeURIComponent(instance)}` : `/2006/cast/${art}.png`}
      alt="" width={animate ? 1024 : 32} height={animate ? 1024 : 48}
      onLoad={loaded} onError={() => setFinished(true)} />
  </div>;
}

/** Passive room presentation of the same cast details used by Buddy Info. */
export default function SpriteShowcase({ position, paused = false }: { position: number; paused?: boolean }) {
  const [motionAllowed, setMotionAllowed] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setMotionAllowed(!reduced.matches && !document.hidden);
    update();
    reduced.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      reduced.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const { person, line } = spriteSpotlight(position, SPRITES.length);
  const sprite = SPRITES[person];
  const profile = SPRITE_PROFILES[sprite.art];
  return <section className="sprite-show" aria-label="Rules of the Game: meet the cast" data-paused={paused || undefined}>
    <div className="sprite-show-scene">
      <article className="sprite-show-card" key={sprite.art} aria-label={`${sprite.name}’s profile`}>
        <div className="sprite-show-person">
          <h2>{sprite.name}</h2><p className="sprite-show-handle">{sprite.screenName}</p>
          <SpriteEntrance art={sprite.art} motionAllowed={motionAllowed} paused={paused} />
          <p className="sprite-show-line" key={line}>{spriteLines(sprite)[line]}</p>
        </div>
        <div className="sprite-show-details">
          <header><strong>{profile?.characterName || sprite.name}</strong><span>{profile?.asl || sprite.screenName}</span></header>
          {profile ? <>
            <p className="sprite-show-brand">{profile.archetype}</p>
            <dl className="sprite-show-stats">{profile.stats.map(stat => <div key={stat.name}><dt>{stat.name}</dt><dd>{stat.bonus}</dd></div>)}</dl>
            <div className="sprite-show-extras"><p><b>Theme song</b>{profile.themeSong}</p><p><b>HP / XP</b>{profile.hp} / {profile.xp}</p></div>
            {profile.conditions.length > 0 && <p className="sprite-show-conditions">{profile.conditions.join(' · ')}</p>}
          </> : <div className="sprite-show-alec"><h3>In their own words</h3><dl>{spriteLines(sprite).map((phrase, i) => <div key={i}><dt>{['Celebrate', 'Bummer', 'Extra'][i]}</dt><dd>{phrase}</dd></div>)}</dl></div>}
        </div>
      </article>
      <ul className="sprite-show-lineup" aria-label="The six 2006ers">{SPRITES.map((friend, i) => <li key={friend.art} aria-current={i === person ? 'true' : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/2006/cast/${friend.art}.png`} alt="" width={32} height={48} /><span>{friend.name}</span>
      </li>)}</ul>
    </div>
  </section>;
}
