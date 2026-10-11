/** A position sampled by the server, not a viewer's wall clock. */
export interface PlaybackSnapshot {
  playbackId: string;
  sourceType?: string;
  playbackSessionId: string;
  playbackRevision: number;
  serverNow: string;
  playbackState: string;
  playbackPositionSeconds: number;
  playbackDurationSeconds?: number | null;
  clipEndSeconds?: number | null;
}

export interface PlaybackAnchor extends PlaybackSnapshot {
  receivedAt: number;
  roundTripMs: number;
}

export function isPlaybackSnapshot(value: unknown): value is PlaybackSnapshot {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return typeof data.playbackId === 'string'
    && typeof data.playbackSessionId === 'string' && data.playbackSessionId.length > 0
    && typeof data.serverNow === 'string' && Number.isFinite(Date.parse(data.serverNow))
    && typeof data.playbackRevision === 'number' && Number.isSafeInteger(data.playbackRevision)
    && data.playbackRevision >= 0
    && (data.playbackState === 'playing' || data.playbackState === 'paused')
    && typeof data.playbackPositionSeconds === 'number'
    && Number.isFinite(data.playbackPositionSeconds) && data.playbackPositionSeconds >= 0;
}

export function makePlaybackAnchor(
  snapshot: PlaybackSnapshot,
  receivedAt: number,
  roundTripMs = 0,
): PlaybackAnchor {
  return {
    ...snapshot,
    receivedAt,
    // A very slow request is not a trustworthy latency estimate. The next
    // healthy poll corrects it; never seek ten seconds ahead on a weak link.
    roundTripMs: Math.min(2000, Math.max(0, Number.isFinite(roundTripMs) ? roundTripMs : 0)),
  };
}

export function snapshotIsNewer(candidate: PlaybackSnapshot, current: PlaybackSnapshot | null) {
  if (!current) return true;
  if (candidate.playbackRevision !== current.playbackRevision) {
    return candidate.playbackRevision > current.playbackRevision;
  }
  return Date.parse(candidate.serverNow) >= Date.parse(current.serverNow);
}

/** The timestamp comparison guards stale HTTP responses; elapsed uses only a monotonic clock. */
export function projectPlaybackPosition(
  anchor: PlaybackAnchor,
  now: number,
  options: { hold?: boolean; duration?: number | null } = {},
) {
  const elapsedMs = anchor.playbackState === 'playing'
    ? Math.max(0, now - anchor.receivedAt) + anchor.roundTripMs / 2
    : 0;
  const position = Math.max(0, anchor.playbackPositionSeconds + elapsedMs / 1000);
  const duration = !options.hold && anchor.clipEndSeconds != null ? anchor.clipEndSeconds : options.duration ?? anchor.playbackDurationSeconds;
  if (!Number.isFinite(duration) || !duration || duration <= 0) return position;
  if (options.hold) return position % duration;
  // Leave a tiny margin so a correction doesn't repeatedly manufacture an
  // ended event while the authoritative server is loading the next cue.
  return Math.min(position, Math.max(0, duration - 0.05));
}

/** Independent of polling: an excerpt stops even while the network is down. */
export function excerptHasEnded(anchor: PlaybackAnchor | null, now: number) {
  if (!anchor || anchor.clipEndSeconds == null) return false;
  const elapsed = anchor.playbackState === 'playing' ? (Math.max(0, now - anchor.receivedAt) + anchor.roundTripMs / 2) / 1000 : 0;
  return anchor.playbackPositionSeconds + elapsed >= anchor.clipEndSeconds;
}

export interface SyncMediaState {
  currentTime: number;
  readyState: number;
  paused: boolean;
  seeking: boolean;
  ended: boolean;
  duration: number;
}

export interface PlaybackCorrection {
  seekTo: number | null;
  playbackRate: number;
  action: 'play' | 'pause' | null;
}

/** Re-evaluated against actual media on every tick, even for unchanged anchors. */
export function getPlaybackCorrection(
  media: SyncMediaState,
  anchor: PlaybackAnchor,
  now: number,
  options: { hold?: boolean; live?: boolean; force?: boolean } = {},
): PlaybackCorrection {
  const correction: PlaybackCorrection = { seekTo: null, playbackRate: 1, action: null };
  if (media.readyState < 1 || media.seeking) return correction;

  const playing = options.hold || (anchor.playbackState === 'playing' && !excerptHasEnded(anchor, now));
  if (!options.live) {
    const duration = Number.isFinite(media.duration) && media.duration > 0
      ? media.duration : anchor.playbackDurationSeconds;
    const target = projectPlaybackPosition(anchor, now, { hold: options.hold, duration });
    const drift = target - media.currentTime;
    if ((!options.hold && anchor.clipEndSeconds != null && media.currentTime >= anchor.clipEndSeconds) || Math.abs(drift) > (options.force || !playing ? 0.15 : 2)) {
      correction.seekTo = target;
    } else if (playing && Math.abs(drift) > 0.35) {
      correction.playbackRate = drift > 0 ? 1.03 : 0.97;
    }
  }
  // Don't restart a finished VOD at its final frame. The server's duration
  // clock advances it; ended notifications are only a wake-up hint.
  const seeksBeforeEnd = correction.seekTo !== null
    && Number.isFinite(media.duration) && correction.seekTo < media.duration - 0.25;
  if (playing && media.paused && (!media.ended || options.hold || seeksBeforeEnd)) correction.action = 'play';
  if (!playing && !media.paused) correction.action = 'pause';
  return correction;
}

export function applySynchronousPlaybackCorrection(
  media: { currentTime: number; playbackRate: number; pause: () => void },
  correction: PlaybackCorrection,
) {
  if (correction.seekTo !== null) media.currentTime = correction.seekTo;
  media.playbackRate = correction.playbackRate;
  if (correction.action === 'pause') media.pause();
  return correction.action === 'play';
}
