/** Presentation only: never advances the queue or changes the shared clock. */
export type SceneClock = {
  playbackState?: string;
  playbackPositionSeconds?: number;
  playbackDurationSeconds?: number | null;
  snapshotReceivedAt?: number;
  snapshotRoundTripMs?: number;
};

export function scenePosition(clock: SceneClock, now: number) {
  const base = Number.isFinite(clock.playbackPositionSeconds) ? Math.max(0, clock.playbackPositionSeconds!) : 0;
  const latency = Number.isFinite(clock.snapshotRoundTripMs) ? Math.min(2000, Math.max(0, clock.snapshotRoundTripMs!)) / 2 : 0;
  const elapsed = clock.playbackState === 'playing' && Number.isFinite(clock.snapshotReceivedAt)
    ? (Math.max(0, now - clock.snapshotReceivedAt!) + latency) / 1000 : 0;
  const duration = clock.playbackDurationSeconds;
  return duration && Number.isFinite(duration) && duration > 0
    ? Math.min(base + elapsed, Math.max(0, duration - 0.05)) : base + elapsed;
}

export const SPRITE_SPOTLIGHT_SECONDS = 24;
export function spriteSpotlight(position: number, count: number) {
  const seconds = Number.isFinite(position) ? Math.max(0, position) : 0;
  return {
    person: Math.floor(seconds / SPRITE_SPOTLIGHT_SECONDS) % Math.max(1, count),
    line: Math.floor((seconds % SPRITE_SPOTLIGHT_SECONDS) / 8),
  };
}
