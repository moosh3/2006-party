'use client';
import { useEffect, useRef, useState } from 'react';
import { scenePosition, type SceneClock } from '@/lib/scene-presentation';

/** A fresh snapshot can land a fraction of a second behind the local clock.
 * Anything smaller than this is jitter, not a seek, and must not step back. */
const JITTER_SECONDS = 1.5;

export function useScenePosition(clock: SceneClock) {
  const [now, setNow] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    setNow(performance.now());
    if (clock.playbackState !== 'playing') return;
    const timer = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, [clock.playbackState, clock.snapshotReceivedAt]);
  const position = scenePosition(clock, now);
  // Pages and spotlights change on this clock; a backward wobble at a boundary would flip them twice.
  if (position > last.current || last.current - position > JITTER_SECONDS) last.current = position;
  return last.current;
}
