export type SceneMusicTrack = Readonly<{ src: string; title: string; volume: number }>;

export const RESULTS_MUSIC = {
  src: '/2006/music/mario-party-results.m4a',
  title: 'Mario Party — Results',
  volume: 0.25,
} as const satisfies SceneMusicTrack;

export const RULES_MUSIC = {
  src: '/2006/music/chacarron.m4a',
  title: 'Chacarrón',
  volume: 0.25,
} as const;

export type SceneMusicStatus = 'muted' | 'paused' | 'playing' | 'blocked' | 'error';
export type SceneMusicState = { position: number; playing: boolean; enabled: boolean; volume: number };
type MusicElement = Pick<HTMLAudioElement, 'currentTime' | 'duration' | 'paused' | 'loop' | 'volume' | 'play' | 'pause' | 'load'>;

export function loopMusicPosition(position: number, duration: number) {
  return Number.isFinite(position) && Number.isFinite(duration) && duration > 0
    ? Math.max(0, position) % duration : 0;
}

/** One local audio element follows the cue; it never sends a playback command. */
export class SceneMusicPlayer {
  private disposed = false;
  private pending = false;
  private blocked = false;
  private shouldPlay = false;
  private status: SceneMusicStatus = 'muted';

  constructor(private media: MusicElement, private onStatus: (state: SceneMusicStatus) => void) {
    media.loop = true;
  }

  private report(status: SceneMusicStatus) {
    if (this.disposed || status === this.status) return;
    this.status = status;
    this.onStatus(status);
  }

  update(state: SceneMusicState, userGesture = false) {
    if (this.disposed) return;
    this.shouldPlay = state.playing && state.enabled;
    this.media.volume = Number.isFinite(state.volume) ? Math.min(1, Math.max(0, state.volume)) : RULES_MUSIC.volume;
    if (userGesture) {
      if (this.status === 'error') this.media.load();
      this.blocked = false;
    }
    if (Number.isFinite(this.media.duration) && this.media.duration > 0) {
      const target = loopMusicPosition(state.position, this.media.duration);
      const difference = Math.abs(this.media.currentTime - target);
      const drift = Math.min(difference, Math.abs(this.media.duration - difference));
      if (drift > (this.media.paused ? 0.1 : 1.5)) {
        try { this.media.currentTime = target; } catch { /* Metadata/canplay retries when seeking becomes available. */ }
      }
    }
    if (!this.shouldPlay) {
      this.media.pause();
      this.report(state.enabled ? 'paused' : 'muted');
      return;
    }
    if (this.blocked || this.pending || !this.media.paused) return;
    this.pending = true;
    // Called directly from the button handler on retry, preserving user activation.
    void this.media.play().then(() => {
      this.pending = false;
      if (this.disposed || !this.shouldPlay) this.media.pause();
      else this.report('playing');
    }).catch((reason: unknown) => {
      this.pending = false;
      if (this.disposed || !this.shouldPlay) return;
      this.blocked = true;
      this.report(reason instanceof Error && reason.name === 'NotAllowedError' ? 'blocked' : 'error');
    });
  }

  fail() { this.blocked = true; this.media.pause(); this.report('error'); }
  destroy() { this.disposed = true; this.shouldPlay = false; this.media.pause(); }
}
