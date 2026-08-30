'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AimWindow from '@/components/aim/AimWindow';
import Chat from '@/components/Chat';
import ErrorBoundary from '@/components/ErrorBoundary';
import PollsTab from '@/components/PollsTab';
import VideoPlayer from '@/components/VideoPlayer';
import VideoPlaylistShelf from '@/components/VideoPlaylistShelf';
import { useLobbyPresence } from '@/components/lobby-lounge/useLobbyPresence';
import { useTokenRefresh } from '@/hooks/useTokenRefresh';
import { getViewerData } from '@/lib/viewer';
import { getRunOfShowCue } from '@/lib/run-of-show';
import { ROOM_NAMES } from '@/lib/constants';

type StreamData = {
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

type Viewer = {
  id: string;
  displayName: string;
  avatar: string;
};

function isStreamData(value: unknown): value is StreamData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.playbackId === 'string'
    && typeof candidate.token === 'string'
    && typeof candidate.expiresAt === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.kind === 'string';
}

async function fetchCurrentStream() {
  const response = await fetch('/api/current', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Show feed returned ${response.status}`);
  const data: unknown = await response.json();
  if (!isStreamData(data)) throw new Error('Show feed response is incomplete');
  return data;
}

function TransitionClock({ nextTransitionAt }: { nextTransitionAt?: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  if (!nextTransitionAt) return <span>Manual cue</span>;

  const seconds = Math.max(0, Math.floor((new Date(nextTransitionAt).getTime() - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return <span>Next transition in {minutes}:{String(remainder).padStart(2, '0')}</span>;
}

function LoadingWindow({ message }: { message: string }) {
  return (
    <div className="aim-desktop show-loading-screen">
      <AimWindow title="2006 — Connecting" status="Please wait">
        <div className="show-loading-message">{message}</div>
      </AimWindow>
    </div>
  );
}

export default function EventPage() {
  const router = useRouter();
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [streamData, setStreamData] = useState<StreamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extraPanel, setExtraPanel] = useState<'polls' | 'videos'>('polls');

  const refreshStream = useCallback(async () => {
    try {
      const next = await fetchCurrentStream();
      setStreamData(next);
      setError(null);
    } catch (refreshError) {
      console.error('Unable to refresh show feed:', refreshError);
      setError('The show feed is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'The Show · 2006';
    const savedViewer = getViewerData();
    if (!savedViewer) {
      router.replace('/login');
      return;
    }

    setViewer(savedViewer);
    refreshStream();

    const interval = window.setInterval(refreshStream, 3000);
    const resume = () => {
      if (document.visibilityState === 'visible') refreshStream();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, [refreshStream, router]);

  const tokenRefreshError = useTokenRefresh(streamData, (next) => {
    setStreamData((previous) => previous ? { ...previous, ...next } : next);
  });

  const presenceSelf = viewer ? {
    userId: viewer.id,
    displayName: viewer.displayName,
    avatar: viewer.avatar,
  } : null;
  const viewersHere = useLobbyPresence(presenceSelf);

  const activeCue = useMemo(
    () => getRunOfShowCue(streamData?.activeSlotId),
    [streamData?.activeSlotId]
  );

  if (!viewer || loading) return <LoadingWindow message="Connecting to the show…" />;

  if (error || !streamData) {
    return (
      <div className="aim-desktop show-loading-screen">
        <AimWindow title="2006 — Connection Error" status="Offline">
          <div className="show-loading-message">
            <p>{error || 'No show feed is configured.'}</p>
            <button type="button" className="aim-xp-button aim-xp-button-primary" onClick={refreshStream}>Try again</button>
          </div>
        </AimWindow>
      </div>
    );
  }

  return (
    <div className="aim-desktop show-audience-desktop">
      <a className="skip-link" href="#show-audience-main">Skip to the show</a>

      <header className="show-audience-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/2006/art.png" alt="2006 — The Year, The Show, Live" />
        <div>
          <strong>Online broadcast</strong>
          <span>{viewersHere.length || 1} viewer{(viewersHere.length || 1) === 1 ? '' : 's'} signed on</span>
        </div>
      </header>

      {tokenRefreshError && <div className="show-feed-warning" role="status">{tokenRefreshError}</div>}

      <main id="show-audience-main" className="show-audience-grid">
        <AimWindow
          title={`${streamData.title} — Windows Media Player`}
          className="show-player-window"
          menuItems={['File', 'View', 'Play', 'Tools', 'Help']}
          status={activeCue?.label || streamData.scheduleStatus || 'Online program feed'}
          live
        >
          <div className="show-video-frame">
            <ErrorBoundary fallback={<div className="show-video-error">The video player stopped. Reload this page to reconnect.</div>}>
              <VideoPlayer
                key={`${streamData.sourceType || 'mux'}:${streamData.playbackId}:${streamData.activeSlotId || 'manual'}:${streamData.isHoldScreen ? 'hold' : 'show'}`}
                playbackId={streamData.playbackId}
                token={streamData.token}
                title={streamData.title}
                kind={streamData.kind}
                sourceType={streamData.sourceType}
                youtubePlaylistId={streamData.youtubePlaylistId}
                sourceUrl={streamData.sourceUrl}
                isHoldScreen={streamData.isHoldScreen}
                playoutMode={streamData.playoutMode}
                playbackState={streamData.playbackState}
                playbackPosition={streamData.playbackPosition}
                playbackUpdatedAt={streamData.playbackUpdatedAt}
                playbackElapsedMs={streamData.playbackElapsedMs}
                activeSlotId={streamData.activeSlotId}
                captionUrl={streamData.captionUrl}
                captionLabel={streamData.captionLabel}
                captionLanguage={streamData.captionLanguage}
                onPlaybackError={refreshStream}
              />
            </ErrorBoundary>
          </div>

          <div className="show-now-playing">
            <strong>Now playing:</strong>
            <span>{streamData.title}</span>
            <TransitionClock nextTransitionAt={streamData.nextTransitionAt} />
          </div>

          <div className="show-extra-tabs" role="tablist" aria-label="Show extras">
            <button type="button" role="tab" aria-selected={extraPanel === 'polls'} onClick={() => setExtraPanel('polls')}>Vote</button>
            <button type="button" role="tab" aria-selected={extraPanel === 'videos'} onClick={() => setExtraPanel('videos')}>Videos</button>
          </div>

          <div className="show-extra-panel">
            {extraPanel === 'polls' ? (
              <ErrorBoundary fallback={<p>Voting is temporarily unavailable.</p>}>
                <PollsTab userId={viewer.id} room={ROOM_NAMES.DEFAULT} />
              </ErrorBoundary>
            ) : (
              <ErrorBoundary fallback={<p>The playlist is temporarily unavailable.</p>}>
                <VideoPlaylistShelf />
              </ErrorBoundary>
            )}
          </div>

          <nav className="aim-toolbar" aria-label="2006 online sections">
            <button type="button" className="aim-tool" aria-current="page">
              The Show
            </button>
            <button type="button" className="aim-tool" onClick={() => document.getElementById('show-chat')?.scrollIntoView({ behavior: 'smooth' })}>
              2006ers
            </button>
            <button type="button" className="aim-tool" onClick={() => setExtraPanel('videos')}>
              Videos
            </button>
            <button type="button" className="aim-tool" onClick={() => setExtraPanel('polls')}>
              Vote
            </button>
          </nav>
        </AimWindow>

        <aside id="show-chat" className="show-chat-column" aria-label="Audience chat">
          <ErrorBoundary fallback={<div className="show-chat-error">Chat is temporarily unavailable.</div>}>
            <Chat room={ROOM_NAMES.DEFAULT} userId={viewer.id} />
          </ErrorBoundary>
        </aside>
      </main>

      <a className="aim-aac show-audience-aac" href="https://www.artisticaccessibility.com" target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/2006/aac.png" alt="Artistic Accessibility Collective" />
      </a>

      <style jsx>{`
        .show-audience-desktop { min-height: 100dvh; padding: 16px; }
        .show-audience-brand { width: min(100%, 1420px); margin: 0 auto 10px; display: flex; align-items: center; gap: 12px; color: #fff; text-shadow: 0 2px 5px #000; }
        .show-audience-brand img { width: 160px; height: auto; filter: drop-shadow(3px 3px 0 #ff00dc) drop-shadow(-3px 0 0 #00f4ff); }
        .show-audience-brand div { display: grid; gap: 2px; }
        .show-audience-brand strong { font-size: 14px; }
        .show-audience-brand span { font-size: 11px; }
        .show-feed-warning { width: min(100%, 1420px); margin: 0 auto 8px; border: 1px solid #8a6500; background: #fff4bd; padding: 7px 10px; color: #5a4500; font-size: 12px; }
        .show-audience-grid { width: min(100%, 1420px); margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 390px); gap: 14px; align-items: stretch; }
        .show-player-window { min-width: 0; }
        .show-video-frame { padding: 8px; background: #111; }
        .show-video-frame :global(.relative.aspect-video), .show-video-frame :global(.aspect-video) { border-radius: 0 !important; }
        .show-video-error { aspect-ratio: 16 / 9; display: grid; place-items: center; padding: 24px; color: #fff; text-align: center; }
        .show-now-playing { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 7px 10px; border-bottom: 1px solid #aca899; background: linear-gradient(180deg, #fff, #ece9d8); font-size: 11px; }
        .show-now-playing > span:first-of-type { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1a3d6e; }
        .show-now-playing > span:last-child { color: #555; font-variant-numeric: tabular-nums; }
        .show-extra-tabs { display: flex; gap: 2px; padding: 8px 8px 0; border-bottom: 1px solid #aca899; }
        .show-extra-tabs button { position: relative; top: 1px; min-width: 82px; border: 1px solid #aca899; border-bottom-color: #aca899; border-radius: 4px 4px 0 0; background: #d9d5c6; padding: 5px 12px; font: inherit; font-size: 11px; cursor: pointer; }
        .show-extra-tabs button[aria-selected='true'] { z-index: 1; border-bottom-color: #fff; background: #fff; }
        .show-extra-panel { min-height: 122px; max-height: 260px; overflow: auto; margin: 0 8px 8px; border: 1px solid #aca899; border-top: 0; background: #fff; padding: 8px; }
        .show-chat-column { min-height: 680px; }
        .show-chat-error { height: 100%; display: grid; place-items: center; background: #ece9d8; }
        .show-audience-aac { width: min(100%, 1420px); margin: 0 auto; }
        .show-audience-aac img { width: min(90vw, 360px); }
        .show-loading-screen { min-height: 100dvh; display: grid; place-items: center; padding: 20px; }
        .show-loading-screen > :global(.aim-window) { width: min(100%, 420px); }
        .show-loading-message { min-height: 150px; display: grid; place-items: center; gap: 12px; padding: 24px; text-align: center; font-size: 13px; }
        @media (max-width: 920px) {
          .show-audience-desktop { padding: 8px; }
          .show-audience-brand { margin-bottom: 7px; }
          .show-audience-brand img { width: 112px; }
          .show-audience-grid { grid-template-columns: 1fr; }
          .show-chat-column { min-height: 520px; height: 72dvh; }
          .show-extra-panel { max-height: 320px; }
        }
        @media (max-width: 560px) {
          .show-now-playing { grid-template-columns: auto minmax(0, 1fr); }
          .show-now-playing > span:last-child { grid-column: 1 / -1; }
          .show-extra-panel { max-height: 360px; }
        }
      `}</style>
    </div>
  );
}
