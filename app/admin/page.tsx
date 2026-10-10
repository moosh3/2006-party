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
        <div className="max-w-7xl mx-auto px-4 py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-twitch-purple">Admin Dashboard</h1>
              <a href="/admin/game" className="underline text-sm">Open trivia, TRL &amp; superlative game desk →</a>
              <p className="text-xs sm:text-sm text-twitch-text-alt">Manage your stream</p>
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
          
          {/* Entry Screen Mode Toggle */}
          <div className="mt-4 pt-4 border-t border-twitch-border">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-twitch-text mb-1">Program poster mode</h3>
                <p className="text-xs text-twitch-text-alt">
                  {posterMode 
                    ? 'Poster flag is on. Audience admission is controlled by doors below.'
                    : 'Poster flag is off. Audience admission is controlled by doors below.'
                  }
                </p>
              </div>
              <button
                onClick={handleTogglePoster}
                disabled={posterLoading}
                className={`w-full sm:w-auto px-4 sm:px-6 py-3 rounded-lg font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] ${
                  posterMode
                    ? 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white'
                    : 'bg-gradient-to-r from-success to-green-600 hover:from-green-500 hover:to-success text-white'
                }`}
              >
                {posterLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin">⟳</span>
                    <span className="hidden sm:inline">Switching...</span>
                  </span>
                ) : posterMode ? (
                  <span className="flex items-center justify-center gap-2">
                    🎬 <span className="hidden xs:inline">POSTER ON</span><span className="xs:hidden">Poster on</span>
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    📝 <span className="hidden xs:inline">POSTER OFF</span><span className="xs:hidden">Poster off</span>
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-6">
        <AudienceDoorsControl />
        {streamData && (
          <div className="twitch-card p-4 mb-4 sm:mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
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
                <p className="font-semibold">{streamData.title || 'No cue selected'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-twitch-text-alt mb-1">Next Transition</p>
                <p className="font-semibold">{streamData.nextTransitionAt ? formatTransition(streamData.nextTransitionAt) : streamData.playoutMode === 'manual' ? streamData.autoAdvanceEnabled ? streamData.playbackState === 'paused' ? 'After playback resumes' : 'Waiting for a timed cue' : 'When you press Next' : 'None scheduled'}</p>
              </div>
            </div>
            <p className="text-xs text-twitch-text-alt mt-3">
              {streamData.playoutMode === 'manual'
                ? streamData.autoAdvanceEnabled ? 'Auto-advance on: queued videos follow each other automatically.' : 'Auto-advance off: press Play Next in Queue when you are ready.'
                : 'Schedule follows the show timetable.'}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Left Column - Video Preview and Library Controls */}
          <div className="lg:col-span-2 space-y-6">
            {/* Video Preview */}
            <div className="twitch-card p-4">
              <h2 className="text-lg font-semibold mb-3 text-twitch-text">Video Preview</h2>
              <p className="text-xs text-twitch-text-alt mb-4">
                Read-only preview. In Queue mode, use the playback controls to run the show.
              </p>
              {streamData ? (
                <VideoPlayer
                  key={streamData.playbackSessionId}
                  playbackSessionId={streamData.playbackSessionId}
                  playbackRevision={streamData.playbackRevision}
                  serverNow={streamData.serverNow}
                  playbackPositionSeconds={streamData.playbackPositionSeconds}
                  playbackDurationSeconds={streamData.playbackDurationSeconds}
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
            </div>

            <VideoPlaylistSettings />

            {/* Library Controls - Below Video Preview */}
            <StreamControl showLibraryControls={true} showPlaybackControls={false} />
          </div>

          {/* Right Column - Playback Controls and Queue */}
          <div className="lg:col-span-1 space-y-6">
            <StreamControl showLibraryControls={false} showPlaybackControls={true} />
            <QueueManager program={streamData} onStreamRefresh={refreshStream} />
          </div>
        </div>
      </main>
    </div>
  );
}
