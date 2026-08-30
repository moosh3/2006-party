'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import VideoPlayer from '@/components/VideoPlayer';
import { getNextRunOfShowCue, getRunOfShowCue } from '@/lib/run-of-show';
import './stage.css';

type StageStream = {
  playbackId: string;
  token: string;
  expiresAt: string;
  title: string;
  kind: string;
  isHoldScreen?: boolean;
  playoutMode?: 'manual' | 'schedule' | string;
  playbackState?: 'playing' | 'paused' | string;
  playbackPosition?: number;
  playbackUpdatedAt?: string;
  playbackElapsedMs?: number;
  activeSlotId?: string | null;
  scheduleStatus?: string | null;
  nextTransitionAt?: string | null;
  sourceType?: string;
  youtubePlaylistId?: string | null;
  sourceUrl?: string | null;
  captionUrl?: string | null;
  captionLabel?: string | null;
  captionLanguage?: string | null;
};

function isStageStream(value: unknown): value is StageStream {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.playbackId === 'string'
    && typeof candidate.token === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.kind === 'string';
}

function formatRemaining(nextTransitionAt: string | null | undefined, now: number) {
  if (!nextTransitionAt) return 'MANUAL';
  const remainingSeconds = Math.max(0, Math.floor((new Date(nextTransitionAt).getTime() - now) / 1000));
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function StagePage() {
  const [stream, setStream] = useState<StageStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/current', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Stage feed returned ${response.status}`);
      const data: unknown = await response.json();
      if (!isStageStream(data)) throw new Error('Stage feed response is incomplete');
      setStream(data);
      setError(null);
    } catch (refreshError) {
      console.error('Unable to refresh stage feed:', refreshError);
      setError('PROGRAM FEED OFFLINE');
    }
  }, []);

  useEffect(() => {
    document.title = 'Stage Display · 2006';
    refresh();
    const refreshInterval = window.setInterval(refresh, 3000);
    const clockInterval = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      window.clearInterval(refreshInterval);
      window.clearInterval(clockInterval);
    };
  }, [refresh]);

  const currentCue = useMemo(() => getRunOfShowCue(stream?.activeSlotId), [stream?.activeSlotId]);
  const nextCue = useMemo(() => getNextRunOfShowCue(stream?.activeSlotId), [stream?.activeSlotId]);
  const clock = formatRemaining(stream?.nextTransitionAt, now);
  const urgent = Boolean(stream?.nextTransitionAt) && new Date(stream!.nextTransitionAt!).getTime() - now <= 60_000;

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Browser or display policy can refuse fullscreen; the route still works.
    }
  }

  if (!stream) {
    return (
      <main className="stage-empty" aria-live="polite">
        <p>{error || 'CONNECTING TO PROGRAM FEED'}</p>
        {error && <button type="button" onClick={refresh}>Retry</button>}
      </main>
    );
  }

  return (
    <main className="stage-display">
      <button type="button" className="stage-fullscreen" onClick={enterFullscreen}>Fullscreen</button>

      <section className="stage-program" aria-label="Synchronized program video">
        <ErrorBoundary fallback={<div className="stage-empty">PROGRAM VIDEO ERROR</div>}>
          <VideoPlayer
            key={`${stream.sourceType || 'mux'}:${stream.playbackId}:${stream.activeSlotId || 'manual'}:${stream.isHoldScreen ? 'hold' : 'show'}`}
            playbackId={stream.playbackId}
            token={stream.token}
            title={stream.title}
            kind={stream.kind}
            sourceType={stream.sourceType}
            youtubePlaylistId={stream.youtubePlaylistId}
            sourceUrl={stream.sourceUrl}
            isHoldScreen={stream.isHoldScreen}
            playoutMode={stream.playoutMode}
            playbackState={stream.playbackState}
            playbackPosition={stream.playbackPosition}
            playbackUpdatedAt={stream.playbackUpdatedAt}
            playbackElapsedMs={stream.playbackElapsedMs}
            activeSlotId={stream.activeSlotId}
            captionUrl={stream.captionUrl}
            captionLabel={stream.captionLabel}
            captionLanguage={stream.captionLanguage}
            onPlaybackError={refresh}
          />
        </ErrorBoundary>
      </section>

      <section className={`stage-cue-bar ${urgent ? 'stage-cue-urgent' : ''}`} aria-live="polite">
        <div className="stage-cue-current">
          <span className="stage-cue-label">NOW</span>
          <strong>{currentCue?.label || stream.title}</strong>
          <span>{currentCue?.performerCue || (stream.playoutMode === 'manual' ? 'Following the operator console' : 'Following the scheduled program feed')}</span>
        </div>

        <div className="stage-cue-clock">
          <span>{stream.nextTransitionAt ? 'NEXT CUE' : 'CUE MODE'}</span>
          <strong>{clock}</strong>
        </div>

        <div className="stage-cue-next">
          <span className="stage-cue-label">NEXT</span>
          <strong>{nextCue?.label || (stream.nextTransitionAt ? 'Scheduled transition' : 'Waiting for operator')}</strong>
        </div>
      </section>

      {error && <div className="stage-connection-warning">{error} — showing the last received cue</div>}
    </main>
  );
}

