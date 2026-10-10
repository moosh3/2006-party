import type { GameKind } from './game-types';
import type { ProgramStream } from './program-stream';
import { isPlaybackSnapshot, makePlaybackAnchor, projectPlaybackPosition } from './playback-sync';

export type AudienceCueAction =
  | { type: 'poll'; promptId: string; kind: GameKind }
  | { type: 'essay'; promptIndex?: number }
  | { type: 'feedback'; formUrl: string }
  | { type: 'commercial' }
  | { type: 'awards' };

export type AudienceCue = {
  id: string;
  enabled: boolean;
  match: { playbackId?: string; assetKey?: string; slotId?: string };
  startSeconds: number;
  endSeconds: number;
  action: AudienceCueAction;
  lateJoin?: 'show' | 'skip';
  repeat?: 'show' | 'occurrence';
};

export type AudienceCueFrame = {
  occurrenceId: string | null;
  positionSeconds: number | null;
  activeCues: readonly AudienceCue[];
  healthy: boolean;
};

const MAX_SNAPSHOT_AGE_MS = 10_000;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_FEEDBACK_URL_LENGTH = 8192;
const selectorNames = ['playbackId', 'assetKey', 'slotId'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function isFeedbackUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_FEEDBACK_URL_LENGTH
    || value.trim() !== value || /[\\\u0000-\u001f\u007f]/.test(value) || value.startsWith('//')) return false;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (hasScheme && !/^https:\/\//i.test(value)) return false;
  try {
    const url = new URL(value, 'https://audience-cues.invalid/');
    return url.protocol === 'https:' && !url.username && !url.password
      && (hasScheme || url.origin === 'https://audience-cues.invalid');
  } catch {
    return false;
  }
}

function isAction(value: unknown): value is AudienceCueAction {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'poll':
      return isIdentifier(value.promptId) && ['trl', 'trivia', 'superlative'].includes(value.kind as string);
    case 'essay':
      return value.promptIndex === undefined || (typeof value.promptIndex === 'number'
        && Number.isSafeInteger(value.promptIndex) && value.promptIndex >= 0);
    case 'feedback':
      return isFeedbackUrl(value.formUrl);
    case 'commercial':
    case 'awards':
      return true;
    default:
      return false;
  }
}

function isCue(value: unknown): value is AudienceCue {
  if (!isRecord(value) || !isIdentifier(value.id) || value.enabled !== true || !isRecord(value.match)) return false;
  const selectors = Object.keys(value.match);
  if (!selectors.length || selectors.some((key) => !selectorNames.includes(key as typeof selectorNames[number])
    || !isIdentifier((value.match as Record<string, unknown>)[key]))) return false;
  return typeof value.startSeconds === 'number' && Number.isFinite(value.startSeconds) && value.startSeconds >= 0
    && typeof value.endSeconds === 'number' && Number.isFinite(value.endSeconds) && value.endSeconds > value.startSeconds
    && (value.lateJoin === undefined || value.lateJoin === 'show' || value.lateJoin === 'skip')
    && (value.repeat === undefined || value.repeat === 'show' || value.repeat === 'occurrence')
    && isAction(value.action);
}

/** Clock health describes the source snapshot, not whether any configured cue is active.
 * Holds, live/YouTube sources and stale snapshots cannot open audience tasks.
 * The caller owns observer history, late-join policy and show/occurrence dismissal ledgers. */
export function getAudienceCueFrame(
  cues: readonly AudienceCue[],
  stream: ProgramStream | null,
  now: number,
): AudienceCueFrame {
  const unavailable: AudienceCueFrame = { occurrenceId: null, positionSeconds: null, activeCues: [], healthy: false };
  if (!stream || !isPlaybackSnapshot(stream) || !isIdentifier(stream.playbackId)
    || !isIdentifier(stream.playbackSessionId) || stream.isHoldScreen === true
    || (stream.isHoldScreen !== undefined && typeof stream.isHoldScreen !== 'boolean')
    || stream.kind !== 'vod' || (stream.sourceType !== undefined && stream.sourceType !== 'mux')
    || stream.playbackId === 'demo-playback-id' || stream.playbackId.startsWith('youtube:')
    || !Number.isFinite(now) || now < 0
    || !Number.isFinite(stream.snapshotReceivedAt) || stream.snapshotReceivedAt < 0
    || !Number.isFinite(stream.snapshotRoundTripMs) || stream.snapshotRoundTripMs < 0) return unavailable;

  const ageMs = now - stream.snapshotReceivedAt;
  if (ageMs < 0 || ageMs > MAX_SNAPSHOT_AGE_MS) return unavailable;
  const duration = stream.playbackDurationSeconds;
  if (duration !== null && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0)) return unavailable;

  // Video seeking intentionally stops 50ms before its end. Audience cue windows
  // use the true projected position instead, so that margin cannot invent a cue.
  const anchor = makePlaybackAnchor({ ...stream, playbackDurationSeconds: null }, stream.snapshotReceivedAt, stream.snapshotRoundTripMs);
  const projected = projectPlaybackPosition(anchor, now);
  if (!Number.isFinite(projected)) return unavailable;
  const frame: AudienceCueFrame = {
    occurrenceId: stream.playbackSessionId,
    positionSeconds: duration === null ? projected : Math.min(projected, duration),
    activeCues: [],
    healthy: true,
  };
  if (duration !== null && projected >= duration) return frame;

  const configured: readonly AudienceCue[] = Array.isArray(cues) ? cues : [];
  const ids = new Map<string, number>();
  for (const cue of configured) {
    if (isRecord(cue) && typeof cue.id === 'string') ids.set(cue.id, (ids.get(cue.id) || 0) + 1);
  }
  frame.activeCues = configured.filter((cue) => {
    if (!isCue(cue) || ids.get(cue.id) !== 1) return false;
    const { playbackId, assetKey, slotId } = cue.match;
    return (playbackId === undefined || playbackId === stream.playbackId)
      && (assetKey === undefined || assetKey === stream.activeAssetKey)
      && (slotId === undefined || slotId === stream.activeSlotId)
      && projected >= cue.startSeconds && projected < cue.endSeconds;
  });
  return frame;
}

/** JSON tuple encoding prevents punctuation in identifiers from causing collisions. */
export function getAudienceCueKey(occurrenceId: string, cueId: string): string {
  return JSON.stringify([occurrenceId, cueId]);
}
