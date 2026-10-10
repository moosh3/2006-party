'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { newerAudienceDoors, parseAudienceDoors, type AudienceDoors } from '@/lib/audience-access';

/** First checks fail closed; transient outages preserve the last confirmed state. */
export function useAudienceDoors(enabled = true) {
  const [doors, setDoors] = useState<AudienceDoors | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (!enabled || !mounted.current || controller.current) return;
    const request = new AbortController();
    controller.current = request;
    const timeout = window.setTimeout(() => request.abort(), 8000);
    try {
      const response = await fetch('/api/audience/doors', { cache: 'no-store', signal: request.signal });
      if (!response.ok) throw new Error('Doors check unavailable');
      const next = parseAudienceDoors(await response.json());
      if (mounted.current && controller.current === request && !request.signal.aborted) {
        setDoors(previous => newerAudienceDoors(previous, next));
        setError(null);
      }
    } catch {
      if (mounted.current && controller.current === request) setError('Connection interrupted. We’re checking the doors again.');
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === request) controller.current = null;
    }
  }, [enabled]);
  useEffect(() => {
    mounted.current = enabled;
    if (!enabled) {
      // A later restored/unblocked identity needs a fresh admission check.
      setDoors(null);
      setError(null);
      return () => { mounted.current = false; };
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    return () => {
      mounted.current = false;
      controller.current?.abort();
      controller.current = null;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
    };
  }, [enabled, refresh]);
  return { doors, error, refresh };
}
