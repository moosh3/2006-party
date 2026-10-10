'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchProgramStream, isNewerProgramStream, type ProgramStream } from '@/lib/program-stream';

/** Realtime is an invalidation hint, never a second playback clock. Polling
 * always stays active so disconnected sockets and sleeping tabs recover. */
export function useProgramStream(enabled = true) {
  const [stream, setStream] = useState<ProgramStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || !mounted.current || inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const next = await fetchProgramStream(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setStream((previous) => isNewerProgramStream(previous, next) ? next : previous);
      setError(null);
    } catch (reason) {
      if (mounted.current && inFlight.current === controller) {
        console.warn('Unable to refresh program feed:', reason instanceof Error ? reason.message : 'Request failed');
        setError('The show feed is temporarily unavailable. Reconnecting…');
      }
    } finally {
      window.clearTimeout(timeout);
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, [enabled]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) return () => { mounted.current = false; };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3000);
    const resume = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    const channel = supabase.channel('program-snapshot-updates').on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'current_stream', filter: 'id=eq.1',
    }, () => void refresh()).subscribe();
    return () => {
      mounted.current = false;
      inFlight.current?.abort();
      inFlight.current = null;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      void supabase.removeChannel(channel);
    };
  }, [enabled, refresh]);

  return { stream, error, refresh };
}
