'use client';
import { useEffect, useState } from 'react';
import { scenePosition, type SceneClock } from '@/lib/scene-presentation';

export function useScenePosition(clock: SceneClock) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(performance.now());
    if (clock.playbackState !== 'playing') return;
    const timer = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, [clock.playbackState, clock.snapshotReceivedAt]);
  return scenePosition(clock, now);
}
