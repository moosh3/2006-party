import type { CountdownCue } from './countdown';

export type ProgramStream = {
  playbackId: string; token: string; expiresAt: string; title: string; kind: string;
  showPoster?: boolean; isHoldScreen?: boolean; playoutMode?: string; playbackState?: string;
  playbackPosition?: number; playbackUpdatedAt?: string; playbackElapsedMs?: number;
  playbackSessionId: string; playbackRevision: number; serverNow: string;
  playbackPositionSeconds: number; playbackDurationSeconds: number | null;
  snapshotReceivedAt: number; snapshotRoundTripMs: number;
  activeSlotId?: string | null; activeAssetKey?: string | null; scheduleStatus?: string | null;
  nextTransitionAt?: string | null; scheduleTitle?: string | null;
  sourceType?: string; youtubePlaylistId?: string | null; youtubeVideoId?: string | null; sourceUrl?: string | null;
  captionUrl?: string | null; captionLabel?: string | null; captionLanguage?: string | null;
  countdown?: CountdownCue | null;
  clipEndSeconds?: number | null;
  autoAdvanceEnabled?: boolean;
  automationStatus?: string; automationError?: string | null;
};

export function isProgramStream(value: unknown): value is Omit<ProgramStream, 'snapshotReceivedAt' | 'snapshotRoundTripMs'> {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return ['playbackId', 'token', 'expiresAt', 'title', 'kind', 'playbackSessionId', 'serverNow']
    .every((key) => typeof data[key] === 'string')
    && Number.isFinite(Date.parse(data.serverNow as string))
    && Number.isSafeInteger(data.playbackRevision) && (data.playbackRevision as number) >= 0
    && Boolean(data.playbackSessionId)
    && ['playing', 'paused'].includes(data.playbackState as string)
    && Number.isFinite(data.playbackPositionSeconds)
    && (data.playbackPositionSeconds as number) >= 0
    && (data.playbackDurationSeconds === null || (
      Number.isFinite(data.playbackDurationSeconds) && (data.playbackDurationSeconds as number) > 0
    ));
}

export function isNewerProgramStream(previous: ProgramStream | null, next: ProgramStream) {
  if (!previous) return true;
  if (next.playbackRevision !== previous.playbackRevision) return next.playbackRevision > previous.playbackRevision;
  return Date.parse(next.serverNow) >= Date.parse(previous.serverNow);
}

export async function fetchProgramStream(signal: AbortSignal): Promise<ProgramStream> {
  const started = performance.now();
  const response = await fetch('/api/current', { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`Program feed returned ${response.status}`);
  const data: unknown = await response.json();
  if (!isProgramStream(data)) throw new Error('Program feed response is incomplete');
  const received = performance.now();
  return { ...data, snapshotReceivedAt: received, snapshotRoundTripMs: received - started };
}
