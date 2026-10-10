import type { AudienceCue, AudienceCueFrame } from './audience-cues';

const LEDGER_VERSION = 1;
const MAX_KEYS = 256;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_ENCODED_KEY_LENGTH = MAX_IDENTIFIER_LENGTH * 3 * 6 + 32;
// A JSON-escaped key may be escaped again in both persisted arrays. The bound
// must also accept our own worst-case valid serialization, not just ASCII IDs.
const MAX_SERIALIZED_LENGTH = MAX_KEYS * (MAX_ENCODED_KEY_LENGTH * 4 + 16) + 1024;
const INITIAL_ENTRY_GRACE_SECONDS = 0.5;

type Observation = { showId: string; occurrenceId: string; positionSeconds: number };
type Delivery = { entered: AudienceCue[]; visibleCues: AudienceCue[] };

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Tuple lengths distinguish show-scoped invitations from explicit per-occurrence
 * invitations. Identifiers containing punctuation cannot collide with each other. */
export function getDeliveryKey(showId: string, occurrenceId: string, cue: Pick<AudienceCue, 'id' | 'repeat'>): string {
  return JSON.stringify(cue.repeat === 'occurrence' ? [showId, cue.id, occurrenceId] : [showId, cue.id]);
}

function parseKey(value: unknown): { key: string; occurrenceScoped: boolean } | null {
  if (typeof value !== 'string' || value.length > MAX_ENCODED_KEY_LENGTH) return null;
  try {
    const tuple: unknown = JSON.parse(value);
    if (!Array.isArray(tuple) || (tuple.length !== 2 && tuple.length !== 3) || !tuple.every(isIdentifier)) return null;
    // Canonicalize legitimate tuple keys rather than trusting arbitrary whitespace.
    return { key: JSON.stringify(tuple), occurrenceScoped: tuple.length === 3 };
  } catch {
    return null;
  }
}

function isVisibleCue(cue: AudienceCue, position: number): boolean {
  return Boolean(cue && isIdentifier(cue.id) && cue.enabled === true
    && Number.isFinite(cue.startSeconds) && cue.startSeconds >= 0
    && Number.isFinite(cue.endSeconds) && cue.endSeconds > cue.startSeconds
    && position >= cue.startSeconds && position < cue.endSeconds
    && (cue.lateJoin === undefined || cue.lateJoin === 'show' || cue.lateJoin === 'skip')
    && (cue.repeat === undefined || cue.repeat === 'show' || cue.repeat === 'occurrence'));
}

/** Invitation history is separate from task availability. This local anonymous
 * ledger contains identifiers only, never answers, drafts, viewer data, or assets.
 * Storage, React, the playback clock and all effects belong to the caller. */
export class AudienceCueDelivery {
  private consumed = new Map<string, boolean>();
  private dismissed = new Set<string>();
  private observation: Observation | null = null;

  constructor(serializedLedger?: string | null) {
    if (typeof serializedLedger !== 'string' || serializedLedger.length > MAX_SERIALIZED_LENGTH) return;
    try {
      const ledger: unknown = JSON.parse(serializedLedger);
      if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return;
      const record = ledger as Record<string, unknown>;
      if (record.version !== LEDGER_VERSION || !Array.isArray(record.consumed)) return;
      if (record.dismissed !== undefined && !Array.isArray(record.dismissed)) return;
      // Never iterate an unbounded externally supplied ledger.
      if (record.consumed.length > MAX_KEYS * 4
        || (Array.isArray(record.dismissed) && record.dismissed.length > MAX_KEYS * 4)) return;
      for (const candidate of record.consumed) {
        const parsed = parseKey(candidate);
        if (parsed) this.consume(parsed.key, parsed.occurrenceScoped);
      }
      for (const candidate of (record.dismissed as unknown[] | undefined) ?? []) {
        const parsed = parseKey(candidate);
        if (parsed) this.recordDismissal(parsed.key, parsed.occurrenceScoped);
      }
    } catch {
      // A corrupt or incompatible browser store is an empty invitation history.
    }
  }

  step(showId: string, frame: AudienceCueFrame): Delivery {
    if (!isIdentifier(showId) || !frame || frame.healthy !== true
      || !isIdentifier(frame.occurrenceId) || typeof frame.positionSeconds !== 'number'
      || !Number.isFinite(frame.positionSeconds) || frame.positionSeconds < 0
      || !Array.isArray(frame.activeCues)) {
      this.resetObservation();
      return { entered: [], visibleCues: [] };
    }
    const { occurrenceId, positionSeconds } = frame;
    // The source frame remains assignment truth. Dismissal only hides its cue
    // bar/invitation; callers may keep the underlying game or essay available.
    const activeCues = frame.activeCues.filter((cue) => isVisibleCue(cue, positionSeconds));
    const entered: AudienceCue[] = [];
    const previous = this.observation;
    const observedSameOccurrence = previous?.showId === showId && previous.occurrenceId === occurrenceId;
    for (const cue of activeCues) {
      const key = getDeliveryKey(showId, occurrenceId, cue);
      if (this.consumed.has(key)) continue;
      const knownCrossing = observedSameOccurrence && previous.positionSeconds < cue.startSeconds;
      const nearStart = positionSeconds - cue.startSeconds <= INITIAL_ENTRY_GRACE_SECONDS;
      // Consuming skipped notices prevents a seek back into this window from
      // replaying an invitation which the late-joining viewer already missed.
      this.consume(key, cue.repeat === 'occurrence');
      if (cue.lateJoin !== 'skip' || knownCrossing || nearStart) entered.push(cue);
    }
    this.observation = { showId, occurrenceId, positionSeconds };
    const visibleCues = activeCues.filter((cue) => !this.dismissed.has(getDeliveryKey(showId, occurrenceId, cue)));
    return { entered, visibleCues };
  }

  dismiss(showId: string, frameOccurrenceId: string, cue: AudienceCue): void {
    if (!isIdentifier(showId) || !isIdentifier(frameOccurrenceId) || !cue || !isIdentifier(cue.id)
      || (cue.repeat !== undefined && cue.repeat !== 'show' && cue.repeat !== 'occurrence')) return;
    this.recordDismissal(getDeliveryKey(showId, frameOccurrenceId, cue), cue.repeat === 'occurrence');
  }

  serialize(): string {
    return JSON.stringify({ version: LEDGER_VERSION, consumed: [...this.consumed.keys()], dismissed: [...this.dismissed] });
  }

  /** Hidden/offline/stale intervals break crossing continuity, not deduplication. */
  resetObservation(): void { this.observation = null; }

  private recordDismissal(key: string, occurrenceScoped: boolean): void {
    this.consume(key, occurrenceScoped);
    if (this.consumed.has(key)) this.dismissed.add(key);
  }

  private consume(key: string, occurrenceScoped: boolean): void {
    if (this.consumed.has(key)) return;
    this.consumed.set(key, occurrenceScoped);
    while (this.consumed.size > MAX_KEYS) {
      const disposable = [...this.consumed].find(([, scoped]) => scoped)?.[0]
        ?? this.consumed.keys().next().value as string;
      this.consumed.delete(disposable);
      this.dismissed.delete(disposable);
    }
  }
}
