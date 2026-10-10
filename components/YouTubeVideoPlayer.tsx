'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isPlaybackSnapshot, makePlaybackAnchor, projectPlaybackPosition, snapshotIsNewer,
  type PlaybackAnchor, type PlaybackSnapshot,
} from '@/lib/playback-sync';
import { loadYouTubeIframeApi, type YouTubePlayer } from '@/lib/youtube-iframe';
import { getYouTubePlaybackCorrection, getYouTubePlaybackError } from '@/lib/youtube-playback';

interface YouTubeVideoPlayerProps {
  videoId: string;
  title: string;
  snapshot: PlaybackSnapshot;
  snapshotReceivedAt?: number;
  snapshotRoundTripMs?: number;
  captionLanguage?: string | null;
  isHoldScreen?: boolean;
  onStreamRefresh?: () => void;
  onReconnectReady?: (reconnect: (() => void) | null) => void;
}

const SNAPSHOT_TIMEOUT_MS = 10000;
const PLAYER_READY_TIMEOUT_MS = 15000;
// Browser-only writes (effects/user interaction), never persisted or broadcast.
// Retain sound choice when React mounts the next authoritative YouTube cue.
let rememberedMuted = true;

export default function YouTubeVideoPlayer({
  videoId, title, snapshot, snapshotReceivedAt, snapshotRoundTripMs = 0,
  captionLanguage = 'en', isHoldScreen = false, onStreamRefresh, onReconnectReady,
}: YouTubeVideoPlayerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const anchorRef = useRef<PlaybackAnchor | null>(null);
  const forceSyncRef = useRef(true);
  const readyRef = useRef(false);
  const disposedRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const refreshAtRef = useRef(-Infinity);
  const callbackRef = useRef(onStreamRefresh);
  const autoplayDeadlineRef = useRef<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsStart, setNeedsStart] = useState(false);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => { callbackRef.current = onStreamRefresh; }, [onStreamRefresh]);

  const refreshStream = useCallback(() => {
    // Ended/errors are wake-up hints, never commands that advance the queue.
    const now = performance.now();
    if (now - refreshAtRef.current < 1000) return;
    refreshAtRef.current = now;
    callbackRef.current?.();
  }, []);

  const applyPlayback = useCallback((force = false) => {
    const player = playerRef.current;
    const anchor = anchorRef.current;
    if (disposedRef.current || !readyRef.current || !player || !anchor) return;
    if (force) forceSyncRef.current = true;

    try {
      // A new server pause must stop a previously issued load/play promptly,
      // even if YouTube has not yet exposed its duration.
      const wantsPause = anchor.playbackState === 'paused' && !isHoldScreen;
      const stateBeforeCorrection = player.getPlayerState();
      if (wantsPause && stateBeforeCorrection !== 2 && stateBeforeCorrection !== 5) player.pauseVideo();
      const correction = getYouTubePlaybackCorrection(player, anchor, performance.now(), {
        hold: isHoldScreen, force: forceSyncRef.current,
      });
      if (correction.metadataReady) {
        if (correction.seekTo !== null) player.seekTo(correction.seekTo, true);
        // seekTo() may start a cued video. Enforce pause after every seek too.
        if (wantsPause && player.getPlayerState() !== 2) player.pauseVideo();
        else if (!wantsPause && correction.action === 'play') player.playVideo();
        forceSyncRef.current = false;
      } else if (!wantsPause && (stateBeforeCorrection === 5 || stateBeforeCorrection === 2 || stateBeforeCorrection === -1)) {
        // A paused initial cue intentionally requests no media. getDuration()
        // therefore stays 0 until playVideo() is called; waiting for metadata
        // before honoring a later server resume would deadlock the player.
        // The cue already contains startSeconds. Retain the forced seek until
        // metadata arrives, then project the latest server anchor again.
        player.playVideo();
      }
      // The native controls remain available, including CC and volume. A
      // native unmute also dismisses our transient, non-overlapping prompt.
      const muted = player.isMuted();
      rememberedMuted = muted;
      setNeedsUnmute(muted);
      if (player.getPlayerState() === 1) {
        setNeedsStart(false);
        if (autoplayDeadlineRef.current !== null) window.clearTimeout(autoplayDeadlineRef.current);
        autoplayDeadlineRef.current = null;
      }
    } catch {
      // An API seek accepted before metadata can be ignored; retain the force
      // flag until a later state change/tick can retry against actual media.
      forceSyncRef.current = true;
    }
  }, [isHoldScreen]);

  useEffect(() => {
    if (!isPlaybackSnapshot(snapshot) || !snapshotIsNewer(snapshot, anchorRef.current)) return;
    const revisionChanged = snapshot.playbackRevision !== anchorRef.current?.playbackRevision;
    anchorRef.current = makePlaybackAnchor(snapshot, snapshotReceivedAt ?? performance.now(), snapshotRoundTripMs);
    applyPlayback(revisionChanged);
  }, [snapshot, snapshotReceivedAt, snapshotRoundTripMs, applyPlayback]);

  const refreshSnapshot = useCallback(async () => {
    if (disposedRef.current || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    const startedAt = performance.now();
    const timeout = window.setTimeout(() => controller.abort(), SNAPSHOT_TIMEOUT_MS);
    try {
      const response = await fetch('/api/current', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Playback clock unavailable');
      const data: unknown = await response.json();
      if (disposedRef.current || sequence !== requestSequenceRef.current) return;
      if (!isPlaybackSnapshot(data)) throw new Error('Incomplete playback clock');
      if (data.playbackId !== snapshot.playbackId || data.playbackSessionId !== snapshot.playbackSessionId
        || data.sourceType !== 'youtube_video') {
        refreshStream();
        return;
      }
      if (!snapshotIsNewer(data, anchorRef.current)) return;
      const revisionChanged = data.playbackRevision !== anchorRef.current?.playbackRevision;
      const receivedAt = performance.now();
      anchorRef.current = makePlaybackAnchor(data, receivedAt, receivedAt - startedAt);
      applyPlayback(revisionChanged);
    } catch {
      // Preserve the last good anchor while the existing program poll retries.
      // A failed clock request must not reset the video to its beginning.
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [snapshot.playbackId, snapshot.playbackSessionId, refreshStream, applyPlayback]);

  useEffect(() => {
    disposedRef.current = false;
    let disposed = false;
    let player: YouTubePlayer | null = null;
    let readyTimeout: number | null = null;
    let syncInterval: number | null = null;
    let snapshotInterval: number | null = null;
    readyRef.current = false;
    forceSyncRef.current = true;
    setLoadError(null);
    setIsReady(false);
    setNeedsStart(false);
    setNeedsUnmute(false);

    loadYouTubeIframeApi().then((YT) => {
      if (disposed || !mountRef.current) return;
      // The API replaces its mount with an iframe; React owns the outer mount
      // only, so StrictMode/retry can always create a fresh child safely.
      const target = document.createElement('iframe');
      const playerVars = {
        autoplay: 0, controls: 1, playsinline: 1, enablejsapi: 1,
        cc_load_policy: 1, cc_lang_pref: captionLanguage || 'en',
        origin: window.location.origin,
      };
      const params = new URLSearchParams(Object.entries(playerVars).map(([name, value]) => [name, String(value)]));
      target.src = `https://www.youtube.com/embed/${videoId}?${params}`;
      target.title = title;
      target.referrerPolicy = 'strict-origin-when-cross-origin';
      target.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
      target.setAttribute('allowfullscreen', '');
      target.style.width = '100%';
      target.style.height = '100%';
      target.style.border = '0';
      mountRef.current.replaceChildren(target);
      readyTimeout = window.setTimeout(() => {
        if (disposed || readyRef.current) return;
        setLoadError('YouTube is taking too long to load. Check the connection and retry.');
        refreshStream();
      }, PLAYER_READY_TIMEOUT_MS);
      player = new YT.Player(target, {
        width: '100%', height: '100%', videoId,
        playerVars,
        events: {
          onReady: ({ target: readyPlayer }) => {
            if (disposed) return;
            if (readyTimeout !== null) window.clearTimeout(readyTimeout);
            readyTimeout = null;
            readyRef.current = true;
            playerRef.current = readyPlayer;
            const iframe = readyPlayer.getIframe();
            iframe.title = title;
            iframe.referrerPolicy = 'strict-origin-when-cross-origin';
            iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
            setLoadError(null);
            setIsReady(true);
            const anchor = anchorRef.current;
            const startSeconds = anchor ? projectPlaybackPosition(anchor, performance.now(), { hold: isHoldScreen }) : 0;
            // First entry is muted. After a viewer enables sound, subsequent
            // queued videos retain that choice, with a muted policy fallback.
            if (rememberedMuted) readyPlayer.mute();
            else readyPlayer.unMute();
            setNeedsUnmute(rememberedMuted);
            if (anchor?.playbackState === 'paused' && !isHoldScreen) {
              readyPlayer.cueVideoById({ videoId, startSeconds });
              readyPlayer.pauseVideo();
            } else {
              readyPlayer.loadVideoById({ videoId, startSeconds });
              autoplayDeadlineRef.current = window.setTimeout(() => {
                autoplayDeadlineRef.current = null;
                if (disposed || (!isHoldScreen && anchorRef.current?.playbackState !== 'playing')
                  || readyPlayer.getPlayerState() === YT.PlayerState.PLAYING) return;
                if (!readyPlayer.isMuted()) {
                  readyPlayer.mute();
                  setNeedsUnmute(true);
                  readyPlayer.playVideo();
                }
                setNeedsStart(true);
              }, 4000);
            }
            applyPlayback(true);
            void refreshSnapshot();
          },
          onStateChange: ({ data }) => {
            if (disposed) return;
            if (data === YT.PlayerState.ENDED && !isHoldScreen) {
              refreshStream();
              void refreshSnapshot();
              return;
            }
            // Correct native seeks/pauses to the shared show clock, without
            // blocking native captions, keyboard, branding, or volume controls.
            applyPlayback();
          },
          onAutoplayBlocked: ({ target: blockedPlayer }) => {
            if (disposed || anchorRef.current?.playbackState === 'paused') return;
            if (!blockedPlayer.isMuted()) {
              blockedPlayer.mute();
              setNeedsUnmute(true);
              blockedPlayer.playVideo();
            }
            setNeedsStart(true);
          },
          onError: ({ data }) => {
            if (disposed) return;
            setLoadError(getYouTubePlaybackError(data));
            refreshStream();
            void refreshSnapshot();
          },
        },
      });
      playerRef.current = player;
      syncInterval = window.setInterval(() => applyPlayback(), 500);
      snapshotInterval = window.setInterval(() => { void refreshSnapshot(); }, 10000);
    }).catch((error: unknown) => {
      if (!disposed) {
        setLoadError(error instanceof Error ? error.message : 'Unable to load YouTube. Retry to reconnect.');
        refreshStream();
      }
    });

    const onResume = () => {
      if (document.visibilityState !== 'visible') return;
      applyPlayback(true);
      void refreshSnapshot();
      refreshStream();
    };
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('pageshow', onResume);
    return () => {
      disposed = true;
      disposedRef.current = true;
      readyRef.current = false;
      requestSequenceRef.current += 1;
      requestRef.current?.abort();
      requestRef.current = null;
      if (readyTimeout !== null) window.clearTimeout(readyTimeout);
      if (syncInterval !== null) window.clearInterval(syncInterval);
      if (snapshotInterval !== null) window.clearInterval(snapshotInterval);
      if (autoplayDeadlineRef.current !== null) window.clearTimeout(autoplayDeadlineRef.current);
      autoplayDeadlineRef.current = null;
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('pageshow', onResume);
      try { player?.destroy(); } catch { /* A failed iframe can already be gone. */ }
      playerRef.current = null;
    };
  }, [videoId, snapshot.playbackSessionId, captionLanguage, retry, title, isHoldScreen, applyPlayback, refreshSnapshot, refreshStream]);

  const joinWithSound = useCallback(() => {
    const player = playerRef.current;
    const anchor = anchorRef.current;
    if (!player || !anchor || !readyRef.current) return;
    try {
      // Keep seek + play in the tap's synchronous user-activation scope.
      player.seekTo(projectPlaybackPosition(anchor, performance.now(), { hold: isHoldScreen }), true);
      player.unMute();
      rememberedMuted = false;
      setNeedsUnmute(false);
      if (anchor.playbackState === 'playing' || isHoldScreen) {
        player.playVideo();
      } else {
        player.pauseVideo();
        setNeedsStart(false);
      }
      void refreshSnapshot();
    } catch { setNeedsStart(true); }
  }, [isHoldScreen, refreshSnapshot]);

  const reconnect = useCallback(() => {
    if (disposedRef.current) return;
    if (loadError) {
      setRetry(value => value + 1);
      return;
    }
    // Called directly by the audience's Reconnect tap, not a later effect:
    // keep seek, sound, and play inside the original user-activation scope.
    joinWithSound();
  }, [joinWithSound, loadError]);

  useEffect(() => {
    onReconnectReady?.(reconnect);
    return () => onReconnectReady?.(null);
  }, [onReconnectReady, reconnect]);

  const showPrompt = isReady && (needsStart || needsUnmute) && !loadError;
  return (
    <div className="relative aspect-video bg-black text-white overflow-hidden max-h-screen rounded-lg" style={{ display: 'grid', minHeight: showPrompt || loadError ? 252 : 200, gridTemplateRows: showPrompt || loadError ? 'minmax(200px, 1fr) auto' : 'minmax(200px, 1fr)' }}>
      <div ref={mountRef} className="h-full w-full min-h-0" />
      <p className="sr-only" role="status" aria-live="polite">
        {loadError || (isReady ? 'YouTube captions are requested on. Caption availability depends on this video; use the player CC controls.' : 'Loading YouTube video.')}
      </p>
      {loadError ? (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-black px-4 py-3 text-sm" role="alert">
          <p>{loadError}</p>
          <button type="button" className="rounded bg-pink-300 px-4 py-2 font-bold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" onClick={() => setRetry(value => value + 1)}>Retry YouTube</button>
        </div>
      ) : showPrompt ? (
        <div className="flex items-center justify-center bg-black px-3 py-2">
          <button type="button" onClick={joinWithSound} className="rounded-full bg-pink-300 px-5 py-2 text-sm font-bold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            {needsStart ? 'Join live show' : 'Turn on sound'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
