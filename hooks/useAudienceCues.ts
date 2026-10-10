'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudienceCueConfig } from '@/lib/audience-cue-config';
import { AudienceCueDelivery, getDeliveryKey } from '@/lib/audience-cue-delivery';
import { getAudienceCueFrame, type AudienceCue } from '@/lib/audience-cues';
import type { ProgramStream } from '@/lib/program-stream';

type CueState = {
  scope: string | null;
  occurrenceId: string | null;
  activeCues: AudienceCue[];
  visibleCues: AudienceCue[];
};
type Runtime = {
  scope: string;
  delivery: AudienceCueDelivery;
  serialized: string;
  evaluate: (() => void) | null;
};
const EMPTY_CUES: AudienceCue[] = [];
const EMPTY_STATE: CueState = { scope: null, occurrenceId: null, activeCues: EMPTY_CUES, visibleCues: EMPTY_CUES };

function validIdentifier(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}
function sameCues(previous: readonly AudienceCue[], next: readonly AudienceCue[]) {
  // The engine preserves config object references. Clock ticks therefore stay
  // render-free, while a replaced same-ID action receives its current payload.
  return previous.length === next.length && previous.every((cue, index) => cue === next[index]);
}
function persist(runtime: Runtime) {
  const serialized = runtime.delivery.serialize();
  if (serialized === runtime.serialized) return;
  runtime.serialized = serialized;
  try { window.localStorage.setItem(runtime.scope, serialized); }
  catch { /* The in-memory ledger still prevents duplicate invitations. */ }
}

/** One local observer of the existing authoritative stream. Disabled production
 * configuration does not read storage, start timers, or register listeners. */
export function useAudienceCues({ stream, viewerId, config, enabled, offline, onEnter }: {
  stream: ProgramStream | null;
  viewerId: string;
  config: AudienceCueConfig;
  enabled: boolean;
  offline: boolean;
  onEnter?: (cue: AudienceCue, deliveryKey: string) => void;
}) {
  const armed = enabled === true && config?.enabled === true
    && validIdentifier(config.showId, 160) && validIdentifier(viewerId, 256)
    && Array.isArray(config.cues) && config.cues.length > 0 && config.cues.length <= 128;
  const scope = armed ? `2006_audience_cue_ledger_v1:${JSON.stringify([viewerId, config.showId])}` : null;
  const latest = useRef({ stream, config, offline, onEnter, armed, scope });
  latest.current = { stream, config, offline, onEnter, armed, scope };
  const runtimeRef = useRef<Runtime | null>(null);
  const [state, setState] = useState<CueState>(EMPTY_STATE);

  useEffect(() => {
    if (!armed || !scope) {
      runtimeRef.current?.delivery.resetObservation();
      setState(previous => previous.scope === null ? previous : EMPTY_STATE);
      return;
    }
    let runtime = runtimeRef.current;
    if (!runtime || runtime.scope !== scope) {
      let stored: string | null = null;
      try { stored = window.localStorage.getItem(scope); }
      catch { /* Browser storage can be unavailable or blocked. */ }
      const delivery = new AudienceCueDelivery(stored);
      runtime = { scope, delivery, serialized: delivery.serialize(), evaluate: null };
      runtimeRef.current = runtime;
    }
    // Preserve the in-memory ledger across StrictMode cleanup/setup replay.
    const observer = runtime;
    let mounted = true;
    const publish = (occurrenceId: string | null, activeCues: readonly AudienceCue[], visibleCues: readonly AudienceCue[]) => {
      if (!mounted) return;
      setState(previous => previous.scope === scope && previous.occurrenceId === occurrenceId
        && sameCues(previous.activeCues, activeCues) && sameCues(previous.visibleCues, visibleCues)
        ? previous : { scope, occurrenceId, activeCues: [...activeCues], visibleCues: [...visibleCues] });
    };
    const evaluate = () => {
      if (!mounted) return;
      const input = latest.current;
      if (!input.armed || input.scope !== scope || input.offline || document.hidden || navigator.onLine === false) {
        observer.delivery.resetObservation();
        publish(null, EMPTY_CUES, EMPTY_CUES);
        return;
      }
      const frame = getAudienceCueFrame(input.config.cues, input.stream, performance.now());
      const delivered = observer.delivery.step(input.config.showId, frame);
      publish(frame.occurrenceId, frame.activeCues, delivered.visibleCues);
      persist(observer);
      if (!frame.occurrenceId) return;
      for (const cue of delivered.entered) {
        try { latest.current.onEnter?.(cue, getDeliveryKey(input.config.showId, frame.occurrenceId, cue)); }
        catch { console.warn('An audience cue handler could not complete.'); }
      }
    };
    observer.evaluate = evaluate;
    evaluate();
    const interval = window.setInterval(evaluate, 250);
    document.addEventListener('visibilitychange', evaluate);
    window.addEventListener('online', evaluate);
    window.addEventListener('offline', evaluate);
    window.addEventListener('pageshow', evaluate);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', evaluate);
      window.removeEventListener('online', evaluate);
      window.removeEventListener('offline', evaluate);
      window.removeEventListener('pageshow', evaluate);
      observer.delivery.resetObservation();
      if (observer.evaluate === evaluate) observer.evaluate = null;
    };
  }, [armed, scope]);

  // Fresh polls and changed connectivity reconcile immediately, without replacing
  // the interval/listeners or capturing an obsolete stream or onEnter callback.
  useEffect(() => { runtimeRef.current?.evaluate?.(); }, [stream, offline, config, armed, scope]);

  const dismissCue = useCallback((cue: AudienceCue) => {
    const input = latest.current, observer = runtimeRef.current;
    if (!input.armed || !input.scope || observer?.scope !== input.scope || input.offline
      || state.scope !== input.scope || !state.occurrenceId
      || document.hidden || navigator.onLine === false) return;
    const frame = getAudienceCueFrame(input.config.cues, input.stream, performance.now());
    if (!frame.healthy || frame.occurrenceId !== state.occurrenceId) return;
    const activeCue = frame.activeCues.find(active => active.id === cue.id);
    if (!activeCue) return;
    observer.delivery.dismiss(input.config.showId, frame.occurrenceId, activeCue);
    persist(observer);
    observer.evaluate?.();
  }, [state.scope, state.occurrenceId]);

  const current = armed && !offline && state.scope === scope ? state : EMPTY_STATE;
  return { armed, activeCues: current.activeCues, visibleCues: current.visibleCues,
    occurrenceId: current.occurrenceId, dismissCue };
}
