'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AimExperience from '@/components/2006/AimExperience';
import MacAudienceGate from '@/components/2006/MacAudienceGate';
import { useLobbyPresence } from '@/components/lobby-lounge/useLobbyPresence';
import { useProgramStream } from '@/hooks/useProgramStream';
import { useAudienceIdentity } from '@/hooks/useAudienceIdentity';
import { useAudienceDoors } from '@/hooks/useAudienceDoors';
import type { ViewerData } from '@/lib/viewer';

// Closing doors unmounts playback. Reopening must fetch a fresh show snapshot,
// never briefly replay the source remembered from before the closure.
function AdmittedEvent({ viewer, onSignOff }: { viewer: ViewerData; onSignOff: () => void }) {
  const { stream: streamData, error: streamError, refresh: refreshStream } = useProgramStream();
  useLobbyPresence({ userId: viewer.id, displayName: viewer.displayName, avatar: viewer.avatar });
  return <AimExperience viewer={viewer} streamData={streamData} streamError={streamError}
    tokenRefreshError={null} refreshStream={refreshStream} onSignOff={onSignOff} />;
}

export default function EventPage() {
  const router = useRouter();
  const { viewer, error: identityError, retry: retryIdentity } = useAudienceIdentity();
  const { doors, error: doorsError, refresh: refreshDoors } = useAudienceDoors(Boolean(viewer));
  const admitted = Boolean(viewer && doors?.doorsOpen);

  useEffect(() => {
    if (!admitted) document.title = viewer && doors ? 'Show starts soon · 2006' : 'Connecting · 2006';
  }, [admitted, viewer, doors]);

  if (!viewer || !doors) return <MacAudienceGate mode="connecting" connectionError={identityError || doorsError}
    onRetry={viewer ? () => void refreshDoors() : retryIdentity} onSignOff={() => router.replace('/login')} />;
  if (!admitted) return <MacAudienceGate mode="waiting" screenName={viewer.displayName} connectionError={doorsError}
    onRetry={() => void refreshDoors()} onSignOff={() => router.replace('/login')} />;

  return <AdmittedEvent key={viewer.id} viewer={viewer} onSignOff={() => router.replace('/login')} />;
}
