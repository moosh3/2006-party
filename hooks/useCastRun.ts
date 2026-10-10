'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CAST_RUNS, type CastRunId } from '@/lib/cast-runs';

export type CastRunOrigin = 'desktop' | 'watch' | 'extras';
export type CastRun = { art: CastRunId; origin: CastRunOrigin; nonce: string; loaded: boolean };

/** One local animation owner for the desktop and two mobile strips. Never touches playout. */
export function useCastRun({ paused, visible, mobilePanel, safariVisible }: {
  paused: boolean;
  visible: boolean;
  mobilePanel: 'watch' | 'game' | 'chat' | 'extras';
  safariVisible: boolean;
}) {
  const [preferences, setPreferences] = useState({ ready: false, mobile: false, reduced: true });
  const [run, setRun] = useState<CastRun | null>(null);
  const active = useRef<CastRun | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finishRun = useCallback((nonce?: string) => {
    if (nonce && active.current?.nonce !== nonce) return false;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    active.current = null;
    setRun(null);
    return true;
  }, []);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 900px)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      finishRun();
      setPreferences({ ready: true, mobile: mobile.matches, reduced: reduced.matches });
    };
    const hide = () => { if (document.hidden) finishRun(); };
    update();
    mobile.addEventListener('change', update);
    reduced.addEventListener('change', update);
    document.addEventListener('visibilitychange', hide);
    return () => {
      mobile.removeEventListener('change', update);
      reduced.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', hide);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      active.current = null;
    };
  }, [finishRun]);

  // A hidden strip must not finish or restart its animation when reopened.
  useEffect(() => { finishRun(); }, [paused, visible, mobilePanel, safariVisible, finishRun]);

  const canRun = preferences.ready && !preferences.reduced && !paused && visible;
  const originVisible = useCallback((origin: CastRunOrigin) => (
    preferences.mobile ? origin === mobilePanel : origin === 'desktop' && safariVisible
  ), [preferences.mobile, mobilePanel, safariVisible]);

  const startRun = useCallback((art: CastRunId, origin: CastRunOrigin) => {
    if (!canRun || !originVisible(origin) || document.hidden || active.current) return false;
    const next: CastRun = { art, origin, nonce: crypto.randomUUID(), loaded: false };
    active.current = next; // Synchronous guard against rapid taps before React renders.
    setRun(next);
    // An unavailable image must never leave the strip locked indefinitely.
    timer.current = setTimeout(() => finishRun(next.nonce), 8_000);
    return true;
  }, [canRun, originVisible, finishRun]);

  const loadRun = useCallback((nonce: string) => {
    const current = active.current;
    if (!current || current.nonce !== nonce || current.loaded) return;
    if (timer.current !== null) clearTimeout(timer.current);
    const loaded = { ...current, loaded: true };
    active.current = loaded;
    setRun(loaded);
    timer.current = setTimeout(() => finishRun(nonce), CAST_RUNS[current.art].durationMs);
  }, [finishRun]);

  return { run, startRun, loadRun, finishRun, canRun, reducedMotion: preferences.reduced };
}
