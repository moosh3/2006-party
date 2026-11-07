'use client';
import { useEffect } from 'react';
import { SPRITES } from '@/lib/cast';
import { SCENES, type SceneId } from '@/lib/scenes';
import './scene-frame.css';

/** A timed scene in place of program video. The database clock owns when it
 * starts and ends; this only renders it and asks for a refresh at its end. */
export default function SceneFrame({ sceneId, interactive, playbackState, playbackPositionSeconds, playbackDurationSeconds,
  snapshotReceivedAt, onStreamRefresh, onOpenBuddy }: {
  sceneId: SceneId | null;
  /** Online audience gets the lineup; stage and operator monitor get a card. */
  interactive: boolean;
  playbackState?: string;
  playbackPositionSeconds?: number;
  playbackDurationSeconds?: number | null;
  snapshotReceivedAt?: number;
  onStreamRefresh?: () => void;
  onOpenBuddy?: (index: number) => void;
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

  if (!interactive) {
    return (
      <div className="scene-frame scene-frame-card" role="img" aria-label={`${title}. ${scene?.stageLine || ''}`}>
        <strong>{title}</strong>
        {scene?.stageLine && <span>{scene.stageLine}</span>}
      </div>
    );
  }

  return (
    <section className="scene-frame scene-frame-audience" aria-label={title}>
      <h2>{title}</h2>
      <ul className="scene-lineup">
        {SPRITES.map(sprite => (
          <li key={sprite.art}>
            <button type="button" disabled={!onOpenBuddy} onClick={() => onOpenBuddy?.(sprite.index)}
              aria-label={`${sprite.name} (${sprite.screenName}): open Buddy Info`}>
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
      <p className="scene-hint">Click a 2006er to open their Buddy Info.</p>
    </section>
  );
}
