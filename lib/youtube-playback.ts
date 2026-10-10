import { getPlaybackCorrection, type PlaybackAnchor } from './playback-sync';
import type { YouTubePlayer } from './youtube-iframe';

/** YouTube has no metadata-ready event. Duration becomes positive after loading. */
export function getYouTubePlaybackCorrection(
  player: YouTubePlayer,
  anchor: PlaybackAnchor,
  now: number,
  options: { hold?: boolean; force?: boolean } = {},
) {
  const state = player.getPlayerState();
  const duration = player.getDuration();
  const metadataReady = Number.isFinite(duration) && duration > 0;
  const correction = getPlaybackCorrection({
    currentTime: player.getCurrentTime(),
    duration,
    readyState: metadataReady ? 1 : 0,
    paused: state !== 1 && state !== 3,
    ended: state === 0,
    seeking: false,
  }, anchor, now, options);
  // The IFrame API only accepts the video's advertised playback rates, not
  // Mux's gentle 0.97/1.03 correction. Use the shared hard-seek threshold.
  correction.playbackRate = 1;
  return { ...correction, metadataReady };
}

export function getYouTubePlaybackError(code?: number) {
  switch (code) {
    case 2: return 'This YouTube video link is invalid.';
    case 5: return 'YouTube could not play this video in this browser. Retry, or ask the host to use a Mux version.';
    case 100: return 'This YouTube video is private, deleted, or unavailable.';
    case 101:
    case 150: return 'The owner does not allow this YouTube video to play on other websites. Ask the host to use a different video.';
    case 153: return 'YouTube could not identify this embedded player. Check browser privacy settings, or ask the host to use a Mux version.';
    default: return 'This YouTube video could not be played. Retry, or ask the host to check the video.';
  }
}
