'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useProgramStream } from '@/hooks/useProgramStream';
import ErrorBoundary from '@/components/ErrorBoundary';
import VideoPlayer from '@/components/VideoPlayer';
import { getNextRunOfShowCue, getRunOfShowCue } from '@/lib/run-of-show';
import './stage.css';

function formatRemaining(nextTransitionAt: string | null | undefined, now: number, mode?: string) {
  if (!nextTransitionAt) return mode === 'schedule' ? 'SCHEDULE' : 'QUEUE';
  const remainingSeconds = Math.max(0, Math.floor((new Date(nextTransitionAt).getTime() - now) / 1000));
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function StagePage() {
  const { stream, error, refresh } = useProgramStream();
  const [now, setNow] = useState(() => Date.now());
  const programRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.title = 'Stage Display · 2006';
    const clockInterval = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      window.clearInterval(clockInterval);
    };
  }, []);

  const currentCue = useMemo(() => getRunOfShowCue(stream?.activeSlotId), [stream?.activeSlotId]);
  const nextCue = useMemo(() => getNextRunOfShowCue(stream?.activeSlotId), [stream?.activeSlotId]);
  const clock = formatRemaining(stream?.nextTransitionAt, now, stream?.playoutMode);
  const urgent = Boolean(stream?.nextTransitionAt) && new Date(stream!.nextTransitionAt!).getTime() - now <= 60_000;

  async function enterFullscreen() {
    try {
      // Fullscreen only the program, not the operator's cue footer.
      await programRef.current?.requestFullscreen();
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
      <button type="button" className="stage-fullscreen" onClick={enterFullscreen}
        title="Video only. Press Escape to leave fullscreen.">Fullscreen</button>

      <section ref={programRef} className="stage-program" aria-label="Synchronized program video">
        <ErrorBoundary fallback={<div className="stage-empty">PROGRAM VIDEO ERROR</div>}>
          <VideoPlayer
            key={stream.playbackSessionId}
            playbackSessionId={stream.playbackSessionId}
            playbackRevision={stream.playbackRevision}
            serverNow={stream.serverNow}
            playbackPositionSeconds={stream.playbackPositionSeconds}
            countdown={stream.countdown} clipEndSeconds={stream.clipEndSeconds} playbackDurationSeconds={stream.playbackDurationSeconds}
            snapshotReceivedAt={stream.snapshotReceivedAt}
            snapshotRoundTripMs={stream.snapshotRoundTripMs}
            onStreamRefresh={refresh}
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
          <strong>{stream.countdown ? `#${stream.countdown.rank} · ${stream.title}` : currentCue?.label || stream.title}</strong>
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
