/** The documented IFrame API shared by individual videos and the legacy playlist. */
export interface YouTubePlayer {
  destroy(): void;
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  cueVideoById(options: { videoId: string; startSeconds?: number }): void;
  loadPlaylist(options: { listType: 'playlist'; list: string; index?: number; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getIframe(): HTMLIFrameElement;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setVolume(volume: number): void;
  setLoop?(loopPlaylists: boolean): void;
  getPlaylist?(): string[];
  getPlaylistIndex?(): number;
  playVideoAt?(index: number): void;
}

export interface YouTubePlayerEvent { target: YouTubePlayer; data?: number }
export interface YouTubeApi {
  Player: new (element: HTMLElement, options: {
    width: string;
    height: string;
    videoId?: string;
    playerVars: Record<string, string | number>;
    events: {
      onReady: (event: YouTubePlayerEvent) => void;
      onStateChange: (event: YouTubePlayerEvent) => void;
      onError: (event: YouTubePlayerEvent) => void;
      onAutoplayBlocked?: (event: YouTubePlayerEvent) => void;
    };
  }) => YouTubePlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number; UNSTARTED: number };
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const IFRAME_API_URL = 'https://www.youtube.com/iframe_api';
const IFRAME_API_TIMEOUT_MS = 12000;
let pendingApi: Promise<YouTubeApi> | null = null;

/** One script per page, bounded failure, and a fresh attempt after a failed load. */
export function loadYouTubeIframeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (pendingApi) return pendingApi;

  const attempt = new Promise<YouTubeApi>((resolve, reject) => {
    const previousCallback = window.onYouTubeIframeAPIReady;
    let script = document.querySelector<HTMLScriptElement>(`script[src="${IFRAME_API_URL}"]`);
    let settled = false;
    let timeout: number;

    const cleanup = () => {
      window.clearTimeout(timeout);
      script?.removeEventListener('error', failed);
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previousCallback;
    };
    const failed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      // Retire the failed shared script so the retry is a real new request.
      script?.remove();
      reject(new Error('YouTube could not be reached. Check the connection and retry.'));
    };
    const ready = () => {
      // Preserve another embed's callback without letting it strand ours.
      try { previousCallback?.(); } catch { /* Other embed owns its errors. */ }
      if (settled) return;
      if (!window.YT?.Player) { failed(); return; }
      settled = true;
      cleanup();
      resolve(window.YT);
    };

    window.onYouTubeIframeAPIReady = ready;
    timeout = window.setTimeout(failed, IFRAME_API_TIMEOUT_MS);
    if (!script) {
      script = document.createElement('script');
      script.src = IFRAME_API_URL;
      script.async = true;
      script.addEventListener('error', failed);
      document.head.appendChild(script);
    } else {
      script.addEventListener('error', failed);
    }
  });

  pendingApi = attempt;
  // Rejections are observed here as well as by each caller; a failed promise
  // must never permanently prevent later videos or a user's retry from loading.
  void attempt.catch(() => { if (pendingApi === attempt) pendingApi = null; });
  return attempt;
}
