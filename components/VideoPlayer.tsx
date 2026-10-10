'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import MuxPlayer from '@mux/mux-player-react';
import type MuxPlayerElement from '@mux/mux-player';
import YouTubeVideoPlayer from '@/components/YouTubeVideoPlayer';
import { loadYouTubeIframeApi, type YouTubePlayer } from '@/lib/youtube-iframe';
import { supabase } from '@/lib/supabase';
import { useRealtimeHealth, type RealtimeHealthStatus } from '@/hooks/useRealtimeHealth';
import {
  CHANNEL_NAMES,
  PLAYBACK_ACTIONS,
  DATABASE_TABLES,
} from '@/lib/constants';
import {
  getPlaybackCorrection,
  applySynchronousPlaybackCorrection,
  isPlaybackSnapshot,
  makePlaybackAnchor,
  projectPlaybackPosition,
  snapshotIsNewer,
  type PlaybackAnchor,
} from '@/lib/playback-sync';
import {
  MUX_SOURCE_TYPE,
  YOUTUBE_PLAYLIST_SOURCE_TYPE,
  YOUTUBE_VIDEO_SOURCE_TYPE,
  parseYouTubePlaylistPlaybackId,
  parseYouTubeVideoPlaybackId,
  type MediaSourceType,
} from '@/lib/youtube';

interface VideoPlayerProps {
  playbackId: string;
  token: string;
  title: string;
  kind?: string;
  isAdmin?: boolean;
  allowAdminBroadcast?: boolean;
  isHoldScreen?: boolean;
  playoutMode?: 'manual' | 'schedule' | string;
  playbackState?: 'playing' | 'paused' | string;
  playbackPosition?: number;
  playbackUpdatedAt?: string;
  playbackElapsedMs?: number;
  playbackSessionId?: string;
  playbackRevision?: number;
  serverNow?: string;
  playbackPositionSeconds?: number;
  playbackDurationSeconds?: number | null;
  snapshotReceivedAt?: number;
  snapshotRoundTripMs?: number;
  activeSlotId?: string | null;
  sourceType?: MediaSourceType | string;
  youtubePlaylistId?: string | null;
  sourceUrl?: string | null;
  captionUrl?: string | null;
  captionLabel?: string | null;
  captionLanguage?: string | null;
  onPlaybackError?: () => void;
  onStreamRefresh?: () => void;
  onReconnectReady?: (reconnect: (() => void) | null) => void;
}

const SIDELOADED_CAPTION_TRACK_ID = 'after-party-sideloaded-captions';
const REALTIME_NOTICE_DELAY_MS = 15000;
const PLAYBACK_SYNC_REQUEST_TIMEOUT_MS = 10000;
const MANUAL_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function YouTubePlaylistPlayer({
  playlistId,
  title,
  viewerLocked,
  onReconnectReady,
}: {
  playlistId: string;
  title: string;
  viewerLocked: boolean;
  onReconnectReady?: (reconnect: (() => void) | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const volumeRef = useRef(80);
  const mutedRef = useRef(false);
  const startedRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimerRef = useRef<number | null>(null);

  // Mobile has no hover, so the control bar would otherwise sit over the
  // video forever. Show it on any tap/mouse move, fade it out after 4s.
  const pokeControls = () => {
    setControlsVisible(true);
    if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), 4000);
  };

  useEffect(() => {
    pokeControls();
    return () => {
      if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let autoplayFallbackTimer: number | null = null;

    setIsReady(false);
    setLoadError(false);
    startedRef.current = false;

    loadYouTubeIframeApi()
      .then((YT) => {
        if (disposed || !mountRef.current) return;

        const player = new YT.Player(mountRef.current, {
          width: '100%',
          height: '100%',
          playerVars: {
            listType: 'playlist',
            list: playlistId,
            loop: 1,
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            playsinline: 1,
            enablejsapi: 1,
            cc_load_policy: 1,
            cc_lang_pref: 'en',
            iv_load_policy: 3,
            rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              if (disposed) return;

              playerRef.current = event.target;
              event.target.setLoop?.(true);
              event.target.setVolume(volumeRef.current);
              if (mutedRef.current) {
                event.target.mute();
              } else {
                event.target.unMute();
              }
              event.target.loadPlaylist({
                listType: 'playlist',
                list: playlistId,
                index: 0,
                startSeconds: 0,
              });
              event.target.playVideo();
              setIsReady(true);

              // Chrome mobile blocks unmuted autoplay; if playback hasn't
              // started shortly after ready, retry muted and surface a pill.
              autoplayFallbackTimer = window.setTimeout(() => {
                autoplayFallbackTimer = null;
                if (disposed || startedRef.current || mutedRef.current) return;
                setMuted(true);
                playerRef.current?.mute();
                playerRef.current?.playVideo();
                setNeedsUnmute(true);
              }, 2000);
            },
            onStateChange: (event) => {
              if (event.data === YT.PlayerState.PLAYING) {
                startedRef.current = true;
              }

              if (!viewerLocked) return;

              if (event.data === YT.PlayerState.PAUSED) {
                window.setTimeout(() => event.target.playVideo(), 100);
              }

              if (event.data === YT.PlayerState.ENDED) {
                const playlist = event.target.getPlaylist?.() || [];
                const index = event.target.getPlaylistIndex?.() ?? 0;

                if (playlist.length > 0 && index >= playlist.length - 1) {
                  event.target.playVideoAt?.(0);
                } else {
                  event.target.playVideo();
                }
              }
            },
            onError: () => {
              if (!disposed) setLoadError(true);
            },
          },
        });

        playerRef.current = player;
      })
      .catch(() => {
        if (!disposed) setLoadError(true);
      });

    return () => {
      disposed = true;
      if (autoplayFallbackTimer !== null) window.clearTimeout(autoplayFallbackTimer);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [playlistId, viewerLocked]);

  useEffect(() => {
    volumeRef.current = volume;
    playerRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    mutedRef.current = muted;
    if (!playerRef.current) return;

    if (muted) {
      playerRef.current.mute();
    } else {
      playerRef.current.unMute();
    }
  }, [muted]);

  const reconnectPlaylist = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    mutedRef.current = false;
    setMuted(false);
    setNeedsUnmute(false);
    player.unMute();
    player.playVideo();
  }, []);

  useEffect(() => {
    onReconnectReady?.(reconnectPlaylist);
    return () => onReconnectReady?.(null);
  }, [onReconnectReady, reconnectPlaylist]);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;

    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }

    await containerRef.current.requestFullscreen().catch(() => undefined);
  };

  if (loadError) {
    return (
      <div className="aspect-video bg-black flex items-center justify-center rounded-lg">
        <div className="text-center p-6 twitch-card">
          <p className="text-red-500 mb-4">Unable to load YouTube playlist.</p>
          <button
            onClick={() => window.location.reload()}
            className="twitch-button"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative aspect-video bg-black overflow-hidden max-h-screen rounded-lg"
      onPointerDown={pokeControls}
      onMouseMove={pokeControls}
    >
      <div className="absolute inset-0 h-full w-full">
        <div ref={mountRef} className="h-full w-full" title={title} />
      </div>
      {viewerLocked && <div className="absolute inset-0 z-10" aria-hidden="true" />}

      {!isReady && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black text-white text-sm">
          Loading playlist
        </div>
      )}

      {needsUnmute && (
        <button
          type="button"
          onClick={reconnectPlaylist}
          className="absolute bottom-16 left-1/2 z-40 -translate-x-1/2 flex items-center gap-2 rounded-full bg-pink-300 px-5 py-3 text-sm font-bold text-black shadow-lg animate-pulse"
        >
          🔊 TAP TO UNMUTE
        </button>
      )}

      <div
        className="absolute bottom-3 right-3 z-30 flex items-center gap-2 rounded-md bg-black/75 px-3 py-2 text-white"
        style={{
          opacity: controlsVisible ? 1 : 0,
          pointerEvents: controlsVisible ? 'auto' : 'none',
          transition: 'opacity .25s ease',
        }}
      >
        <button
          type="button"
          onClick={() => {
            if (muted) setNeedsUnmute(false);
            setMuted(!muted);
          }}
          className="min-h-[32px] rounded bg-white/15 px-2 text-xs font-semibold hover:bg-white/25"
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? 'UNMUTE' : 'MUTE'}
        </button>
        <input
          aria-label="Volume"
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={(event) => {
            const nextVolume = Number(event.target.value);
            setVolume(nextVolume);
            if (nextVolume > 0 && muted) setMuted(false);
          }}
          className="hidden sm:block w-24"
        />
        <button
          type="button"
          onClick={toggleFullscreen}
          className="min-h-[32px] rounded bg-white/15 px-2 text-xs font-semibold hover:bg-white/25"
          aria-label="Fullscreen"
        >
          FULL
        </button>
      </div>
    </div>
  );
}

export default function VideoPlayer({
  playbackId,
  token,
  title,
  kind = 'vod',
  isAdmin = false,
  allowAdminBroadcast = isAdmin,
  isHoldScreen = false,
  playoutMode = 'manual',
  playbackState = 'playing',
  playbackPosition = 0,
  playbackUpdatedAt,
  playbackElapsedMs = 0,
  playbackSessionId,
  playbackRevision = 0,
  serverNow,
  playbackPositionSeconds,
  playbackDurationSeconds = null,
  snapshotReceivedAt,
  snapshotRoundTripMs = 0,
  activeSlotId = null,
  sourceType = MUX_SOURCE_TYPE,
  youtubePlaylistId = null,
  captionUrl = null,
  captionLabel = null,
  captionLanguage = null,
  onPlaybackError,
  onStreamRefresh,
  onReconnectReady,
}: VideoPlayerProps) {
  const canBroadcastAdminControls = isAdmin && allowAdminBroadcast;
  const viewerLocked = !canBroadcastAdminControls;
  const playerRef = useRef<MuxPlayerElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  // A phone can stop before metadata or while seeking, before safePlay ever
  // runs. Keep a tap-to-start path available even in those startup states.
  const [needsUnmute, setNeedsUnmute] = useState(viewerLocked && (isHoldScreen || playbackState === 'playing'));
  const [needsStart, setNeedsStart] = useState(viewerLocked && (isHoldScreen || playbackState === 'playing'));
  const realtimeHealth = useRealtimeHealth();
  const [visibleRealtimeHealth, setVisibleRealtimeHealth] = useState<RealtimeHealthStatus>('healthy');

  const isSyncingRef = useRef(false);
  const realtimeUnhealthySinceRef = useRef<number | null>(null);
  const syncRequestInFlightRef = useRef(false);
  const syncControllerRef = useRef<AbortController | null>(null);
  const syncRequestSequenceRef = useRef(0);
  const adminUpdateDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const syncErrorCountRef = useRef<number>(0);
  const errorRetryRef = useRef(0);
  const errorRetryTimerRef = useRef<number | null>(null);
  const sideloadedCaptionTrackRef = useRef<TextTrack | null>(null);
  const endedRequestRef = useRef(false);
  const endedCompletedRef = useRef(false);
  const endedRetryTimerRef = useRef<number | null>(null);
  const endedControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const forceNextSyncRef = useRef(true);
  const anchorRef = useRef<PlaybackAnchor | null>(null);
  const initialStartTimeRef = useRef<number | null>(null);
  const callbacksRef = useRef({ onPlaybackError, onStreamRefresh });

  useEffect(() => {
    callbacksRef.current = { onPlaybackError, onStreamRefresh };
  }, [onPlaybackError, onStreamRefresh]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      syncRequestSequenceRef.current += 1;
      syncControllerRef.current?.abort();
      syncRequestInFlightRef.current = false;
      endedControllerRef.current?.abort();
      if (endedRetryTimerRef.current !== null) window.clearTimeout(endedRetryTimerRef.current);
      if (errorRetryTimerRef.current !== null) window.clearTimeout(errorRetryTimerRef.current);
      if (adminUpdateDebounceRef.current) clearTimeout(adminUpdateDebounceRef.current);
    };
  }, []);

  const refreshStream = useCallback(() => {
    const callbacks = callbacksRef.current;
    (callbacks.onStreamRefresh || callbacks.onPlaybackError)?.();
  }, []);

  if (initialStartTimeRef.current === null && kind !== 'live') {
    const base = playbackPositionSeconds ?? Math.max(0, playbackPosition + playbackElapsedMs / 1000);
    const elapsed = playbackState === 'playing' && snapshotReceivedAt !== undefined
      ? Math.max(0, performance.now() - snapshotReceivedAt) / 1000 + snapshotRoundTripMs / 2000
      : 0;
    const position = Math.max(0, base + elapsed);
    initialStartTimeRef.current = playbackDurationSeconds && playbackDurationSeconds > 0
      ? isHoldScreen ? position % playbackDurationSeconds : Math.min(position, Math.max(0, playbackDurationSeconds - 0.05))
      : position;
  }

  useEffect(() => {
    if (realtimeHealth === 'healthy') {
      realtimeUnhealthySinceRef.current = null;
      setVisibleRealtimeHealth('healthy');
      return;
    }

    if (realtimeUnhealthySinceRef.current === null) {
      realtimeUnhealthySinceRef.current = Date.now();
    }

    const elapsed = Date.now() - realtimeUnhealthySinceRef.current;
    const remainingDelay = Math.max(0, REALTIME_NOTICE_DELAY_MS - elapsed);
    const timer = window.setTimeout(() => {
      setVisibleRealtimeHealth(realtimeHealth);
    }, remainingDelay);

    return () => window.clearTimeout(timer);
  }, [realtimeHealth]);

  // Chrome mobile rejects unmuted play() without a user gesture. Fall back to
  // muted playback (viewers see video immediately) and surface an unmute pill.
  const safePlay = useCallback(async (video: MuxPlayerElement): Promise<boolean> => {
    const playbackWasStopped = () => {
      if (mountedRef.current && (isHoldScreen || anchorRef.current?.playbackState === 'playing')) return false;
      if (!video.paused) video.pause();
      if (mountedRef.current) {
        setNeedsStart(false);
        setNeedsUnmute(false);
      }
      return true;
    };
    if (playbackWasStopped()) return false;
    const playWithDeadline = async () => {
      let timeout: number | undefined;
      try {
        await Promise.race([
          video.play(),
          new Promise<never>((_, reject) => {
            timeout = window.setTimeout(() => reject(new DOMException('Playback did not start', 'TimeoutError')), 5000);
          }),
        ]);
      } finally {
        window.clearTimeout(timeout);
      }
    };
    try {
      await playWithDeadline();
      if (playbackWasStopped()) return false;
      if (mountedRef.current) {
        setNeedsStart(false);
        setNeedsUnmute(video.muted);
      }
      return true;
    } catch (err) {
      if (playbackWasStopped()) return false;
      if ((err as DOMException)?.name !== 'NotAllowedError') {
        if ((err as DOMException)?.name !== 'AbortError') console.error('Failed to play video:', err);
        if (mountedRef.current && (err as DOMException)?.name !== 'AbortError') {
          setNeedsUnmute(true);
          setNeedsStart(true);
        }
        return false;
      }

      try {
        video.muted = true;
        await playWithDeadline();
        if (playbackWasStopped()) return false;
        if (mountedRef.current) {
          setNeedsUnmute(true);
          setNeedsStart(false);
        }
        return true;
      } catch (mutedErr) {
        if (playbackWasStopped()) return false;
        console.error('Muted autoplay also blocked:', mutedErr);
        if (mountedRef.current) {
          setNeedsUnmute(true);
          setNeedsStart(true);
        }
        return false;
      }
    }
  }, [isHoldScreen]);

  const applyPlaybackState = useCallback(async (force = false) => {
    const video = playerRef.current;
    const anchor = anchorRef.current;
    if (!viewerLocked || sourceType !== MUX_SOURCE_TYPE || !video || !anchor) return;
    if (force) forceNextSyncRef.current = true;
    // A new pause must cancel an older pending play() immediately.
    if (anchor.playbackState === 'paused' && !isHoldScreen && !video.paused) video.pause();
    if (isSyncingRef.current) return;

    const seeking = Boolean(video.media?.seeking);
    const correction = getPlaybackCorrection({
      currentTime: video.currentTime, readyState: video.readyState, paused: video.paused,
      ended: video.ended, duration: video.duration, seeking,
    }, anchor, performance.now(), {
      hold: isHoldScreen,
      live: kind === 'live',
      force: forceNextSyncRef.current,
    });
    // A pre-metadata attempt is not success. Keep the force flag until media
    // can actually seek, then repeat against its real currentTime every tick.
    if (video.readyState < 1 || seeking) return;

    isSyncingRef.current = true;
    try {
      if (correction.seekTo !== null) {
        setIsSyncing(true);
      }
      const shouldPlay = applySynchronousPlaybackCorrection(video, correction);
      forceNextSyncRef.current = false;
      if (shouldPlay) await safePlay(video);
      syncErrorCountRef.current = 0;
    } catch (err) {
      forceNextSyncRef.current = true;
      syncErrorCountRef.current += 1;
      console.error('Playback correction will be retried:', err);
    } finally {
      isSyncingRef.current = false;
      if (mountedRef.current) setIsSyncing(false);
    }
  }, [viewerLocked, sourceType, isHoldScreen, kind, safePlay]);

  const loadAndSyncPlaybackState = useCallback(async () => {
    if (syncRequestInFlightRef.current || sourceType !== MUX_SOURCE_TYPE || !mountedRef.current) return;

    syncRequestInFlightRef.current = true;
    const controller = new AbortController();
    syncControllerRef.current = controller;
    const sequence = ++syncRequestSequenceRef.current;
    const startedAt = performance.now();
    const timeout = window.setTimeout(() => {
      controller.abort();
    }, PLAYBACK_SYNC_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch('/api/current', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Playback state request failed with ${response.status}`);
      }

      const data: unknown = await response.json();
      if (!mountedRef.current || sequence !== syncRequestSequenceRef.current) return;
      if (!isPlaybackSnapshot(data)) throw new Error('Incomplete playback clock response');
      if (data.playbackId !== playbackId || (data.sourceType || MUX_SOURCE_TYPE) !== sourceType
        || (playbackSessionId && data.playbackSessionId !== playbackSessionId)) {
        // Never apply the next cue's position to the old mounted video.
        refreshStream();
        return;
      }
      if (!snapshotIsNewer(data, anchorRef.current)) return;
      const receivedAt = performance.now();
      const changed = data.playbackRevision !== anchorRef.current?.playbackRevision;
      anchorRef.current = makePlaybackAnchor(data, receivedAt, receivedAt - startedAt);
      await applyPlaybackState(changed);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      console.error('Failed to load playback state:', err);
      syncErrorCountRef.current += 1;

      if (syncErrorCountRef.current === 5) {
        console.warn('Repeated playback state fetch failures; keeping current playback alive while retrying.');
      }
    } finally {
      window.clearTimeout(timeout);
      if (sequence === syncRequestSequenceRef.current) syncRequestInFlightRef.current = false;
      if (syncControllerRef.current === controller) syncControllerRef.current = null;
    }
  }, [applyPlaybackState, playbackId, playbackSessionId, sourceType, refreshStream]);

  useEffect(() => {
    setError(null);
    errorRetryRef.current = 0;
  }, [playbackId, sourceType]);

  // Seek before starting, and retry when HLS metadata/buffering catches up.
  useEffect(() => {
    const video = playerRef.current;
    if (sourceType !== MUX_SOURCE_TYPE || !video || !viewerLocked) return;

    const syncReady = () => { void applyPlaybackState(true); };
    const syncProgress = () => { void applyPlaybackState(); };
    video.addEventListener('loadedmetadata', syncReady);
    video.addEventListener('canplay', syncProgress);
    video.addEventListener('playing', syncProgress);
    video.addEventListener('seeked', syncProgress);
    const timer = window.setInterval(syncProgress, 500);
    syncReady();

    return () => {
      video.removeEventListener('loadedmetadata', syncReady);
      video.removeEventListener('canplay', syncProgress);
      video.removeEventListener('playing', syncProgress);
      video.removeEventListener('seeked', syncProgress);
      window.clearInterval(timer);
      video.playbackRate = 1;
    };
  }, [sourceType, viewerLocked, playbackId, applyPlaybackState]);

  // Side-load the caption file (public/assets/captions/*) as a text track on
  // the underlying media element, for assets with no embedded subtitles. The
  // requestCaptions effect below flips the track to 'showing' once it exists.
  //
  // Timing matters: appending a <track> while hls.js is still starting up
  // stalls its level loading in production builds (black spinner, manifests
  // fetched but no video). Wait for loadedmetadata before touching the media
  // children, and skip entirely when the manifest already carries subtitles.
  useEffect(() => {
    const player = playerRef.current;
    if (sourceType !== MUX_SOURCE_TYPE || !player || !captionUrl) return;

    let trackEl: HTMLTrackElement | null = null;
    let watchedTracks: TextTrackList | null = null;
    let cancelled = false;

    // The side-loaded VTT is the single caption source. Embedded manifest
    // subtitles are auto-shown by native HLS on iOS (but not by hls.js on
    // desktop), which rendered the same dialogue twice on phones — keep any
    // track that isn't ours disabled, on both engines.
    const suppressEmbedded = () => {
      const media = (player as MuxPlayerElement & { media?: HTMLMediaElement | null }).media;
      if (!media?.textTracks) return;

      for (const t of Array.from(media.textTracks)) {
        if (
          (t.kind === 'subtitles' || t.kind === 'captions') &&
          t.id !== SIDELOADED_CAPTION_TRACK_ID &&
          t.mode !== 'disabled'
        ) {
          t.mode = 'disabled';
        }
      }
    };

    const attach = () => {
      if (cancelled || trackEl) return;

      const media = (player as MuxPlayerElement & { media?: HTMLMediaElement | null }).media;
      if (!media) return;

      trackEl = document.createElement('track');
      trackEl.id = SIDELOADED_CAPTION_TRACK_ID;
      trackEl.kind = 'subtitles';
      trackEl.label = captionLabel || 'English';
      trackEl.srclang = captionLanguage || 'en';
      trackEl.src = captionUrl;
      media.appendChild(trackEl);
      sideloadedCaptionTrackRef.current = trackEl.track;

      watchedTracks = media.textTracks;
      watchedTracks?.addEventListener('addtrack', suppressEmbedded);
      watchedTracks?.addEventListener('change', suppressEmbedded);
      suppressEmbedded();
    };

    if (player.readyState >= 1) {
      attach();
    }
    player.addEventListener('loadedmetadata', attach);

    return () => {
      cancelled = true;
      player.removeEventListener('loadedmetadata', attach);
      watchedTracks?.removeEventListener('addtrack', suppressEmbedded);
      watchedTracks?.removeEventListener('change', suppressEmbedded);
      sideloadedCaptionTrackRef.current = null;
      trackEl?.remove();
    };
  }, [sourceType, playbackId, captionUrl, captionLabel, captionLanguage]);

  useEffect(() => {
    const player = playerRef.current;
    if (sourceType !== MUX_SOURCE_TYPE || !player || isHoldScreen || kind === 'live') return;

    let attempts = 0;
    let timeout: NodeJS.Timeout | null = null;

    const getCaptionTargets = () => {
      const internals = player as MuxPlayerElement & {
        media?: HTMLMediaElement | null;
        mediaController?: HTMLElement | null;
        mediaTheme?: HTMLElement | null;
      };

      return [
        player,
        internals.mediaController,
        internals.mediaTheme,
        player.shadowRoot?.querySelector('media-controller'),
        player.shadowRoot?.querySelector('media-theme'),
      ].filter((target): target is HTMLElement => target instanceof HTMLElement);
    };

    const requestCaptions = () => {
      // With a side-loaded track, manage modes directly — the broadcast
      // "show subtitles" request would also enable the embedded manifest
      // track on iOS native HLS, doubling the captions.
      if (!sideloadedCaptionTrackRef.current) {
        for (const target of getCaptionTargets()) {
          target.setAttribute('defaultsubtitles', '');
          target.dispatchEvent(new CustomEvent('mediashowsubtitlesrequest', {
            bubbles: true,
            composed: true,
            detail: true,
          }));
        }
      }

      const textTracks =
        (player as MuxPlayerElement & { media?: HTMLMediaElement | null }).media?.textTracks ||
        player.textTracks;
      const tracks = textTracks ? Array.from(textTracks) : [];
      const captionTrack =
        tracks.find((track) => track.id === SIDELOADED_CAPTION_TRACK_ID) ||
        tracks.find((track) => track.kind === 'subtitles' || track.kind === 'captions');

      if (captionTrack && captionTrack.mode !== 'showing') {
        captionTrack.mode = 'showing';
      }

      attempts += 1;
      if (attempts < 6) {
        timeout = setTimeout(requestCaptions, 750);
      }
    };

    const handleReady = () => {
      attempts = 0;
      if (timeout) clearTimeout(timeout);
      requestCaptions();
    };

    player.addEventListener('loadstart', handleReady);
    player.addEventListener('loadedmetadata', handleReady);
    player.addEventListener('canplay', handleReady);
    requestCaptions();

    return () => {
      player.removeEventListener('loadstart', handleReady);
      player.removeEventListener('loadedmetadata', handleReady);
      player.removeEventListener('canplay', handleReady);
      if (timeout) clearTimeout(timeout);
    };
  }, [playbackId, isHoldScreen, kind, sourceType]);

  useEffect(() => {
    if (canBroadcastAdminControls || sourceType !== MUX_SOURCE_TYPE) return;
    const snapshot = {
      playbackId,
      sourceType,
      playbackSessionId: playbackSessionId || `legacy:${playbackId}:${activeSlotId || 'manual'}`,
      playbackRevision,
      serverNow: serverNow || playbackUpdatedAt || '1970-01-01T00:00:00.000Z',
      playbackState,
      playbackPositionSeconds: playbackPositionSeconds ?? Math.max(0, playbackPosition + playbackElapsedMs / 1000),
      playbackDurationSeconds,
    };
    if (!isPlaybackSnapshot(snapshot) || !snapshotIsNewer(snapshot, anchorRef.current)) return;
    const changed = snapshot.playbackRevision !== anchorRef.current?.playbackRevision;
    anchorRef.current = makePlaybackAnchor(snapshot, snapshotReceivedAt ?? performance.now(), snapshotRoundTripMs);
    void applyPlaybackState(changed);
  }, [
    canBroadcastAdminControls, sourceType, playbackId, playbackSessionId, activeSlotId,
    playbackRevision, serverNow, playbackState, playbackPositionSeconds, playbackPosition,
    playbackUpdatedAt, playbackElapsedMs, playbackDurationSeconds, snapshotReceivedAt,
    snapshotRoundTripMs, applyPlaybackState,
  ]);

  useEffect(() => {
    if (canBroadcastAdminControls || sourceType !== MUX_SOURCE_TYPE || !playerRef.current) return;

    loadAndSyncPlaybackState();

    const channel = supabase
      .channel(CHANNEL_NAMES.PLAYBACK_SYNC)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: DATABASE_TABLES.CURRENT_STREAM,
          filter: 'id=eq.1',
        },
        // Realtime is a wake-up signal, not a playback clock. Its raw row
        // may already be superseded and cannot resolve schedule/hold cues.
        () => { void loadAndSyncPlaybackState(); }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void loadAndSyncPlaybackState();
      });

    const syncInterval = setInterval(
      loadAndSyncPlaybackState,
      realtimeHealth === 'healthy' ? 10000 : 5000
    );

    return () => {
      supabase.removeChannel(channel);
      clearInterval(syncInterval);
    };
  }, [
    canBroadcastAdminControls,
    sourceType,
    playbackId,
    realtimeHealth,
    loadAndSyncPlaybackState,
  ]);

  useEffect(() => {
    if (canBroadcastAdminControls) return;

    const handleResume = () => {
      if (document.visibilityState === 'visible' && !isSyncingRef.current) {
        void applyPlaybackState(true);
        void loadAndSyncPlaybackState();
        refreshStream();
      }
    };

    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('pageshow', handleResume);
    return () => {
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('pageshow', handleResume);
    };
  }, [canBroadcastAdminControls, applyPlaybackState, loadAndSyncPlaybackState, refreshStream]);

  const sendAdminPlaybackCommand = async (action: string, position?: number) => {
    if (!canBroadcastAdminControls) return;

    try {
      const commandId = crypto.randomUUID();
      const expectedSessionId = playoutMode === 'manual' && playbackSessionId && MANUAL_SESSION_ID_PATTERN.test(playbackSessionId)
        ? playbackSessionId : undefined;
      const response = await fetch('/api/admin/playback-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, position, commandId, expectedSessionId }),
      });

      if (response.status === 409) {
        const data = await response.json();
        console.warn(data.error);
      }
    } catch (err) {
      console.error(`Failed to sync ${action}:`, err);
    }
  };

  const handleSeek = async () => {
    if (!playerRef.current || !canBroadcastAdminControls) return;

    if (adminUpdateDebounceRef.current) {
      clearTimeout(adminUpdateDebounceRef.current);
    }

    adminUpdateDebounceRef.current = setTimeout(() => {
      sendAdminPlaybackCommand(PLAYBACK_ACTIONS.SEEK, playerRef.current?.currentTime || 0);
    }, 500);
  };

  const handlePlay = async () => {
    if (!playerRef.current || !canBroadcastAdminControls) return;
    await sendAdminPlaybackCommand(PLAYBACK_ACTIONS.PLAY, playerRef.current.currentTime);
  };

  const handlePause = async () => {
    if (!playerRef.current || !canBroadcastAdminControls) return;
    await sendAdminPlaybackCommand(PLAYBACK_ACTIONS.PAUSE, playerRef.current.currentTime);
  };

  const handleUnmute = useCallback(() => {
    const video = playerRef.current;
    if (!mountedRef.current || !video) return;

    // The latest server sample is projected synchronously before the tap's
    // play(), preserving browser user activation while joining the live cue.
    const anchor = anchorRef.current;
    forceNextSyncRef.current = true;
    if (anchor && kind !== 'live' && video.readyState >= 1 && !video.media?.seeking) {
      const target = projectPlaybackPosition(anchor, performance.now(), {
        hold: isHoldScreen,
        duration: Number.isFinite(video.duration) ? video.duration : playbackDurationSeconds,
      });
      try {
        if (Math.abs(video.currentTime - target) > 0.15) video.currentTime = target;
      } catch (reason) {
        // Metadata does not guarantee native HLS is seekable yet. Still make
        // the tap's play request; the existing sync loop retries the seek.
        console.warn('Reconnect seek will be retried:', reason);
      }
    }
    if (isHoldScreen || anchor?.playbackState === 'playing') {
      video.muted = false;
      setNeedsUnmute(true);
      setNeedsStart(true);
      // Run synchronously inside the click, before any fetch/await. Calling
      // play again also retries stalled media reporting paused=false.
      void safePlay(video);
    } else {
      setNeedsUnmute(false);
      setNeedsStart(false);
    }
    void loadAndSyncPlaybackState();
  }, [kind, isHoldScreen, playbackDurationSeconds, safePlay, loadAndSyncPlaybackState]);

  useEffect(() => {
    if (sourceType !== MUX_SOURCE_TYPE || !viewerLocked) return;
    onReconnectReady?.(handleUnmute);
    return () => onReconnectReady?.(null);
  }, [sourceType, viewerLocked, handleUnmute, onReconnectReady]);

  useEffect(() => {
    if (!isHoldScreen && playbackState === 'paused') {
      setNeedsUnmute(false);
      setNeedsStart(false);
    }
  }, [isHoldScreen, playbackState]);

  const handlePlayerError = (evt: Event) => {
    console.error('Mux player error:', (evt as CustomEvent).detail);

    if (errorRetryRef.current === 0) {
      errorRetryRef.current = 1;
      // Likely an expired signed token — ask the parent for a fresh one (the
      // tokens prop is reactive, so playback recovers without a remount).
      callbacksRef.current.onPlaybackError?.();
      errorRetryTimerRef.current = window.setTimeout(() => {
        errorRetryTimerRef.current = null;
        if (errorRetryRef.current === 1) errorRetryRef.current = 0;
      }, 30000);
      return;
    }

    setError('Video playback error. Refresh to reconnect.');
  };

  const correctViewerControlAttempt = () => {
    if (canBroadcastAdminControls || isSyncingRef.current || playerRef.current?.ended) return;
    void applyPlaybackState(true);
  };

  const handleEnded = async () => {
    if (isHoldScreen || kind === 'live' || endedRequestRef.current || endedCompletedRef.current) return;
    if (playoutMode === 'schedule' && !activeSlotId) return;
    if (playoutMode !== 'schedule' && playoutMode !== 'manual') return;
    endedRequestRef.current = true;
    const endpoint = playoutMode === 'schedule' ? '/api/playout/slot-ended' : '/api/playout/manual-ended';
    const notify = async (attempt: number) => {
      const controller = new AbortController();
      endedControllerRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 6000);
      let retry = false;
      try {
        const response = await fetch(endpoint, {
          method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slotId: activeSlotId, playbackId, playbackSessionId }),
        });
        if (!response.ok) throw new Error(`Ended notification returned ${response.status}`);
        // A 202 is a timing hint rejected as early, not an accepted advance.
        retry = response.status === 202;
        endedCompletedRef.current = !retry;
      } catch (err) {
        if (mountedRef.current) console.warn('Ended notification will be retried:', err);
        retry = true;
      } finally {
        window.clearTimeout(timeout);
        if (endedControllerRef.current === controller) endedControllerRef.current = null;
        if (!mountedRef.current) return;
        refreshStream();
        void loadAndSyncPlaybackState();
        if (retry && attempt < 3) {
          endedRetryTimerRef.current = window.setTimeout(() => {
            endedRetryTimerRef.current = null;
            void notify(attempt + 1);
          }, 1000 * 2 ** attempt);
        } else {
          endedRequestRef.current = false;
        }
      }
    };
    await notify(0);
  };

  if (sourceType === MUX_SOURCE_TYPE && playbackId === 'demo-playback-id') {
    return (
      <div
        className="relative aspect-video overflow-hidden bg-black"
        style={{ display: 'grid', placeItems: 'center' }}
        role="img"
        aria-label="Waiting for the 2006 program"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/2006/art.png"
          alt=""
          style={{ width: 'min(68%, 620px)', height: 'auto', filter: 'drop-shadow(4px 0 #ff00dc) drop-shadow(-4px 0 #00f4ff)' }}
        />
        <div
          style={{
            position: 'absolute',
            right: 12,
            bottom: 10,
            left: 12,
            color: '#b8b8b8',
            fontFamily: 'Tahoma, Verdana, sans-serif',
            fontSize: 11,
            textAlign: 'center',
          }}
        >
          Waiting for the show. The host will start the program here.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="aspect-video bg-white/30 flex items-center justify-center rounded-xl">
        <div className="text-center p-6 twitch-card">
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="twitch-button"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  if (sourceType === YOUTUBE_PLAYLIST_SOURCE_TYPE) {
    const playlistId = youtubePlaylistId || parseYouTubePlaylistPlaybackId(playbackId);

    if (!playlistId) {
      return (
        <div className="aspect-video bg-black flex items-center justify-center rounded-lg">
          <div className="text-center p-6 twitch-card">
            <p className="text-red-500">Invalid YouTube playlist source.</p>
          </div>
        </div>
      );
    }

    return (
      <YouTubePlaylistPlayer
        playlistId={playlistId}
        title={title}
        viewerLocked={viewerLocked}
        onReconnectReady={onReconnectReady}
      />
    );
  }

  if (sourceType === YOUTUBE_VIDEO_SOURCE_TYPE) {
    const videoId = parseYouTubeVideoPlaybackId(playbackId);
    if (!videoId) {
      return <div className="aspect-video flex items-center justify-center bg-black p-6 text-white" role="alert">Invalid YouTube video source.</div>;
    }
    return (
      <YouTubeVideoPlayer
        key={`${playbackSessionId || activeSlotId || 'manual'}:${videoId}`}
        videoId={videoId}
        title={title}
        snapshot={{
          playbackId, sourceType,
          playbackSessionId: playbackSessionId || `legacy:${playbackId}:${activeSlotId || 'manual'}`,
          playbackRevision,
          serverNow: serverNow || playbackUpdatedAt || '1970-01-01T00:00:00.000Z',
          playbackState,
          playbackPositionSeconds: playbackPositionSeconds ?? Math.max(0, playbackPosition + playbackElapsedMs / 1000),
          playbackDurationSeconds,
        }}
        snapshotReceivedAt={snapshotReceivedAt}
        snapshotRoundTripMs={snapshotRoundTripMs}
        captionLanguage={captionLanguage}
        isHoldScreen={isHoldScreen}
        onStreamRefresh={refreshStream}
        onReconnectReady={onReconnectReady}
      />
    );
  }

  const viewerControlStyle = viewerLocked
    ? ({
        '--play-button': 'none',
        '--center-play-button': 'none',
        '--bottom-play-button': 'none',
        '--top-play-button': 'none',
        '--seek-backward-button': 'none',
        '--center-seek-backward-button': 'none',
        '--bottom-seek-backward-button': 'none',
        '--top-seek-backward-button': 'none',
        '--seek-forward-button': 'none',
        '--center-seek-forward-button': 'none',
        '--bottom-seek-forward-button': 'none',
        '--top-seek-forward-button': 'none',
        '--time-range': 'none',
        '--bottom-time-range': 'none',
        '--top-time-range': 'none',
        '--time-display': 'none',
        '--duration-display': 'none',
        '--playback-rate-button': 'none',
        '--playback-rate-menu-button': 'none',
        '--media-time-range-display': 'none',
        '--media-time-display-display': 'none',
        '--media-duration-display-display': 'none',
        '--media-play-button-display': 'none',
        '--media-seek-backward-button-display': 'none',
        '--media-seek-forward-button-display': 'none',
        '--media-playback-rate-button-display': 'none',
        '--media-playback-rate-menu-button-display': 'none',
      } as React.CSSProperties)
    : undefined;

  return (
    <div className="relative aspect-video bg-black overflow-hidden max-h-screen rounded-lg">
      <MuxPlayer
        ref={playerRef}
        playbackId={playbackId}
        tokens={{ playback: token !== 'placeholder-token' && token !== 'unsigned' ? token : undefined }}
        streamType={kind === 'live' ? 'live' : undefined}
        defaultStreamType={kind === 'live' ? 'live' : 'on-demand'}
        startTime={kind === 'live' ? undefined : initialStartTimeRef.current ?? undefined}
        metadata={{
          video_title: title,
        }}
        defaultShowRemainingTime
        defaultHiddenCaptions={false}
        accentColor="#fbcfe8"
        className={`w-full h-full ${viewerLocked ? 'watch-party-locked' : ''}`}
        style={viewerControlStyle}
        nohotkeys={viewerLocked}
        playsInline
        onPlay={canBroadcastAdminControls ? handlePlay : undefined}
        onPause={canBroadcastAdminControls ? handlePause : correctViewerControlAttempt}
        // Guest seek completion already has a non-forced sync listener.
        // Forcing another seek here chases the moving clock on slow connections.
        onSeeked={canBroadcastAdminControls ? handleSeek : undefined}
        onEnded={handleEnded}
        onError={handlePlayerError}
        loop={isHoldScreen}
        // Viewer autoplay is controlled only after the authoritative seek.
        autoPlay={canBroadcastAdminControls && (isHoldScreen || playbackState === 'playing')}
      />

      {needsUnmute && (
        <button
          type="button"
          onClick={handleUnmute}
          className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 flex items-center gap-2 rounded-full bg-pink-300 px-5 py-3 text-sm font-bold text-black shadow-lg animate-pulse"
        >
          {needsStart ? 'JOIN LIVE SHOW' : '🔊 TAP TO UNMUTE'}
        </button>
      )}

      {isSyncing && viewerLocked && (
        <div className="absolute bottom-4 left-4 bg-black/70 text-white text-xs px-3 py-1 rounded-full z-10">
          Syncing
        </div>
      )}

      {visibleRealtimeHealth !== 'healthy' && (
        <div className={`absolute top-4 right-4 text-casual-dark text-xs px-3 py-1 rounded-full font-medium flex items-center gap-2 z-10 backdrop-blur-sm ${
          visibleRealtimeHealth === 'degraded' ? 'bg-casual-yellow/90' : 'bg-casual-pink/90'
        }`}>
          {visibleRealtimeHealth === 'degraded' ? 'Sync Reconnecting' : 'Sync Delayed'}
        </div>
      )}

      {isHoldScreen && (
        <div className="absolute top-4 left-4 bg-casual-violet/90 backdrop-blur-sm text-casual-dark text-xs px-3 py-1 rounded-full font-bold flex items-center gap-2 z-10">
          <span>Hold Screen</span>
        </div>
      )}
    </div>
  );
}
