'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AimExperience, { type ExperienceStreamData } from '@/components/2006/AimExperience';
import AimWindow from '@/components/aim/AimWindow';
import { useLobbyPresence } from '@/components/lobby-lounge/useLobbyPresence';
import { useTokenRefresh } from '@/hooks/useTokenRefresh';
import { getRunOfShowCue } from '@/lib/run-of-show';
import { getViewerData } from '@/lib/viewer';

type Viewer = {
  id: string;
  displayName: string;
  avatar: string;
};

function isStreamData(value: unknown): value is ExperienceStreamData {
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

export default function EventPage() {
  const router = useRouter();
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [streamData, setStreamData] = useState<ExperienceStreamData | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const refreshStream = useCallback(async () => {
    try {
      setStreamData(await fetchCurrentStream());
      setStreamError(null);
    } catch (error) {
      console.error('Unable to refresh show feed:', error);
      setStreamError('The show feed is temporarily unavailable.');
    }
  }, []);

  useEffect(() => {
    const savedViewer = getViewerData();
    if (!savedViewer) {
      router.replace('/login');
      return;
    }

    setViewer(savedViewer);
    refreshStream();

    const interval = window.setInterval(refreshStream, 3000);
    const resume = () => { if (document.visibilityState === 'visible') refreshStream(); };
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
  useLobbyPresence(presenceSelf);

  const activeCue = useMemo(
    () => getRunOfShowCue(streamData?.activeSlotId),
    [streamData?.activeSlotId]
  );

  if (!viewer) {
    return (
      <div className="aim-desktop show-loading-screen">
        <AimWindow title="2006 — Connecting" status="Please wait">
          <div className="show-loading-message">Signing on…</div>
        </AimWindow>
      </div>
    );
  }

  return (
    <AimExperience
      viewer={viewer}
      streamData={streamData}
      streamError={streamError}
      tokenRefreshError={tokenRefreshError}
      activeCueLabel={activeCue?.label}
      refreshStream={refreshStream}
      onSignOff={() => router.replace('/login')}
    />
  );
}
