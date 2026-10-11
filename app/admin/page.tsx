'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import './operator.css';
import StreamControl from '@/components/admin/StreamControl';
import VideoPlayer from '@/components/VideoPlayer';
import QueueManager from '@/components/admin/QueueManager';
import VideoPlaylistSettings from '@/components/admin/VideoPlaylistSettings';
import AudienceDoorsControl from '@/components/admin/AudienceDoorsControl';
import { useProgramStream } from '@/hooks/useProgramStream';

function formatTransition(value?: string | null) {
  if (!value) return 'None scheduled';

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));
}

export default function AdminDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const { stream: streamData, refresh: refreshStream } = useProgramStream(!loading);
  const [posterMode, setPosterMode] = useState(false);
  const [posterLoading, setPosterLoading] = useState(false);

  useEffect(() => {
    // Check admin authentication and load stream
    async function checkAuth() {
      try {
        const response = await fetch('/api/admin/set-current');
        if (response.status === 401) {
          router.push('/admin/login');
          return;
        }
        setLoading(false);
      } catch (error) {
        console.error('Auth check failed:', error);
        router.push('/admin/login');
      }
    }

    checkAuth();
  }, [router]);

  const receivedPosterMode = streamData?.showPoster;
  useEffect(() => {
    if (receivedPosterMode !== undefined) setPosterMode(receivedPosterMode);
  }, [receivedPosterMode]);

  async function handleTogglePoster() {
    setPosterLoading(true);
    try {
      const response = await fetch('/api/admin/toggle-poster', {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        setPosterMode(data.showPoster);
      } else {
        alert('Failed to toggle poster mode');
      }
    } catch (error) {
      console.error('Failed to toggle poster:', error);
      alert('Error toggling poster mode');
    } finally {
      setPosterLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="operator-desktop min-h-screen flex items-center justify-center">
        <p role="status">Loading stream controls…</p>
      </div>
    );
  }

  return (
    <div className="operator-desktop min-h-screen text-twitch-text">
      <header className="bg-twitch-dark border-b border-twitch-border">
        <div className="operator-shell px-4 py-3">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-twitch-purple">2006 · Show control</h1>
              <a href="/admin/game" className="underline text-sm">Trivia, TRL &amp; awards →</a>

            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <a
                href="/stage"
                className="twitch-button-secondary text-sm flex-1 sm:flex-none text-center min-h-[44px] flex items-center justify-center"
              >
                Stage Display
              </a>
              <a
                href="/event"
                className="twitch-button-secondary text-sm flex-1 sm:flex-none text-center min-h-[44px] flex items-center justify-center"
              >
                Audience View
              </a>
              <button
                onClick={async () => {
                  await fetch('/api/auth/admin-logout', { method: 'POST' });
                  router.push('/admin/login');
                }}
                className="text-twitch-text-alt hover:text-twitch-text transition-colors min-h-[44px] px-3"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="operator-shell p-4 sm:p-6">
        {streamData && (
          <div className="operator-status">
            <div className="operator-status-grid text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-twitch-text-alt mb-1">Mode</p>
                <p className="font-semibold text-twitch-purple">{streamData.playoutMode === 'manual' ? 'Queue' : streamData.playoutMode === 'schedule' ? 'Schedule' : 'Checking…'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-twitch-text-alt mb-1">Status</p>
                <p className="font-semibold">{streamData.isHoldScreen ? 'Holding' : streamData.playbackState === 'playing' ? 'Playing' : streamData.playbackState === 'paused' ? 'Paused' : 'Checking…'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-twitch-text-alt mb-1">Current cue</p>
                <p className="font-semibold break-words">{streamData.title || 'No cue selected'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-twitch-text-alt mb-1">Next Transition</p>
                <p className="font-semibold">{streamData.nextTransitionAt ? formatTransition(streamData.nextTransitionAt) : streamData.playoutMode === 'manual' ? streamData.autoAdvanceEnabled ? streamData.playbackState === 'paused' ? 'After playback resumes' : 'Waiting for a timed cue' : 'When you press Next' : 'None scheduled'}</p>
              </div>
            </div>

          </div>
        )}

        <div className="operator-workspace">
          {/* The queue is the operator's main workspace. Keep setup secondary. */}
          <section className="operator-queue min-w-0" aria-label="Show queue">
            <QueueManager program={streamData} onStreamRefresh={refreshStream} />
          </section>

          <div className="operator-monitor">
          {/* Monitor the current cue beside its playback controls. */}
          <section className="operator-preview min-w-0 twitch-card p-4" aria-label="Program preview">
              <h2 className="text-lg font-semibold mb-3 text-twitch-text">Program monitor</h2>
              <p className="text-xs text-twitch-text-alt mb-4">
                What’s on the shared program.
              </p>
              {streamData ? (
                <VideoPlayer
                  key={streamData.playbackSessionId}
                  playbackSessionId={streamData.playbackSessionId}
                  playbackRevision={streamData.playbackRevision}
                  serverNow={streamData.serverNow}
                  playbackPositionSeconds={streamData.playbackPositionSeconds}
                  countdown={streamData.countdown} clipEndSeconds={streamData.clipEndSeconds} playbackDurationSeconds={streamData.playbackDurationSeconds}
                  snapshotReceivedAt={streamData.snapshotReceivedAt}
                  snapshotRoundTripMs={streamData.snapshotRoundTripMs}
                  onStreamRefresh={refreshStream}
                  playbackId={streamData.playbackId}
                  token={streamData.token}
                  title={streamData.title}
                  kind={streamData.kind}
                  sourceType={streamData.sourceType}
                  youtubePlaylistId={streamData.youtubePlaylistId}
                  sourceUrl={streamData.sourceUrl}
                  isAdmin={true}
                  allowAdminBroadcast={false}
                  isHoldScreen={streamData.isHoldScreen}
                  playoutMode={streamData.playoutMode}
                  playbackState={streamData.playbackState}
                  playbackPosition={streamData.playbackPosition}
                  playbackUpdatedAt={streamData.playbackUpdatedAt}
                  playbackElapsedMs={streamData.playbackElapsedMs}
                  activeSlotId={streamData.activeSlotId}
                />
              ) : (
                <div className="aspect-video bg-twitch-darker flex items-center justify-center rounded">
                  <p className="text-twitch-text-alt">No stream configured. Add a video below.</p>
                </div>
              )}
          </section>

          <section className="operator-controls min-w-0" aria-label="Live playback controls">
            <StreamControl showLibraryControls={false} showPlaybackControls={true} />
          </section>


          <AudienceDoorsControl />
          </div>
        </div>

          <aside className="operator-library min-w-0 space-y-4" aria-label="Library and show setup">
            <details className="operator-setup">
              <summary className="min-h-[44px] cursor-pointer py-3 font-semibold">Media library &amp; setup</summary>
              <p className="text-sm text-twitch-text-alt mb-4">Add and manage source videos here. Arrange and run them from the queue.</p>
              <StreamControl showLibraryControls={true} showPlaybackControls={false} />
            </details>
            <details className="operator-setup">
              <summary>Program poster</summary>
              <div className="operator-setting-row">
                <p className="text-sm">Poster is {posterMode ? 'on' : 'off'}. Audience admission is controlled separately by the doors.</p>
                <button type="button" onClick={handleTogglePoster} disabled={posterLoading} className="twitch-button-secondary min-h-[44px] px-4">
                  {posterLoading ? 'Updating…' : posterMode ? 'Turn poster off' : 'Turn poster on'}
                </button>
              </div>
            </details>
            <details className="operator-setup">
              <summary className="min-h-[44px] cursor-pointer py-3 font-semibold">Event extras</summary>
              <VideoPlaylistSettings />
            </details>
          </aside>
      </main>
    </div>
  );
}
