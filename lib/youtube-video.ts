import { normalizeYouTubeVideoId } from './youtube';

/** A known unsuitable video must never be accepted via the offline fallback. */
export class YouTubeVideoValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'YouTubeVideoValidationError'; }
}

export interface YouTubeVideoMetadata {
  videoId: string;
  title: string;
  durationSeconds: number;
  /** API-confirmed availability, or unknown (not proof that player tracks are absent). */
  captionsAvailable: true | null;
  warnings: string[];
}

export function hasYouTubeApiCredentials() {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim());
}

// YouTube duration uses ISO 8601 days/hours/minutes/seconds. Months and years
// have no exact seconds and are deliberately not accepted as queue timers.
export function parseYouTubeDuration(value: string): number | null {
  const match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match || value.endsWith('T') || !match.slice(1).some((part) => part !== undefined)) return null;
  const seconds = Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600
    + Number(match[3] || 0) * 60 + Number(match[4] || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

type ApiVideo = {
  id?: string;
  snippet?: { title?: string; liveBroadcastContent?: string };
  status?: { privacyStatus?: string; embeddable?: boolean; uploadStatus?: string };
  contentDetails?: {
    duration?: string; caption?: string;
    regionRestriction?: { allowed?: string[]; blocked?: string[] };
    contentRating?: { ytRating?: string };
  };
};

/** Official videos.list only; no scraping, download, or browser cookies. */
export async function fetchYouTubeVideoMetadata(input: string): Promise<YouTubeVideoMetadata> {
  const videoId = normalizeYouTubeVideoId(input);
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) throw new Error('YouTube metadata verification is not configured');
  const query = new URLSearchParams({ id: videoId, key: apiKey, part: 'snippet,contentDetails,status' });
  let response: Response;
  try {
    response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${query}`, {
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
  } catch { throw new Error('YouTube metadata verification is temporarily unavailable'); }
  // Do not surface an upstream message/URL: either may contain the API key.
  if (!response.ok) throw new Error(`YouTube metadata verification was unavailable (${response.status})`);
  let data: { items?: ApiVideo[] };
  try { data = await response.json(); } catch { throw new Error('YouTube returned an invalid metadata response'); }
  if (!Array.isArray(data.items)) throw new Error('YouTube returned an invalid metadata response');
  const item = data.items.find((entry) => entry.id === videoId);
  if (!item) throw new YouTubeVideoValidationError('YouTube video is unavailable or private. Choose an accessible captioned video.');
  if (item.status?.privacyStatus === 'private' || item.status?.embeddable === false) {
    throw new YouTubeVideoValidationError('This YouTube video cannot be embedded for viewers.');
  }
  if (item.snippet?.liveBroadcastContent === 'live' || item.snippet?.liveBroadcastContent === 'upcoming') {
    throw new YouTubeVideoValidationError('Live or upcoming YouTube streams cannot use the finite show queue.');
  }
  if (item.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted') {
    throw new YouTubeVideoValidationError('Age-restricted YouTube videos cannot reliably play in the embedded show.');
  }
  if (item.status?.uploadStatus && item.status.uploadStatus !== 'processed') {
    throw new YouTubeVideoValidationError('This YouTube video is not ready for playback.');
  }
  const durationSeconds = parseYouTubeDuration(item.contentDetails?.duration || '');
  if (!durationSeconds) throw new YouTubeVideoValidationError('YouTube did not provide a finite positive video duration.');
  const warnings: string[] = [];
  if (item.status?.embeddable !== true) warnings.push('YouTube did not confirm embed availability. Rehearse this video before the show.');
  // The metadata flag can be false while the player offers automatic captions.
  // Only a positive flag confirms availability; a negative/missing flag warns.
  const captionsAvailable = item.contentDetails?.caption === 'true' ? true : null;
  if (captionsAvailable === null) warnings.push('Caption availability is unverified. Auto-generated captions may still work; confirm captions in the embedded player before the show.');
  if (item.contentDetails?.regionRestriction?.allowed || item.contentDetails?.regionRestriction?.blocked?.length) {
    warnings.push('This video has regional viewing restrictions; it may not play for every viewer.');
  }
  return { videoId, title: item.snippet?.title?.trim() || `YouTube video ${videoId}`,
    durationSeconds, captionsAvailable, warnings };
}
