import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/session';
import { getMuxPlaybackDuration, hasMuxApiCredentials, MuxVodTypeError } from '@/lib/mux';
import { fetchYouTubeVideoMetadata, hasYouTubeApiCredentials, YouTubeVideoValidationError } from '@/lib/youtube-video';
import {
  MUX_SOURCE_TYPE,
  YOUTUBE_PLAYLIST_SOURCE_TYPE,
  YOUTUBE_VIDEO_SOURCE_TYPE,
  extractYouTubeVideoId,
  makeYouTubeVideoPlaybackId,
  makeYouTubeVideoUrl,
  parseYouTubeVideoPlaybackId,
  extractYouTubePlaylistId,
  makeYouTubePlaylistPlaybackId,
  parseYouTubePlaylistPlaybackId,
  type MediaSourceType,
} from '@/lib/youtube';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }
  try {
    const { data, error } = await supabaseAdmin.from('mux_items').select('*').order('created_at', { ascending: false });
    if (error) {
      return NextResponse.json({ error: 'Failed to fetch media items' }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({ items: data || [] }, { headers: NO_STORE });
  } catch (error) {
    console.error('Error fetching media items:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'A valid JSON body is required' }, { status: 400, headers: NO_STORE });
  }
  const {
    playbackId, label, kind = 'vod', durationSeconds,
    sourceType: rawSourceType, source_type: rawSourceTypeSnake,
    sourceUrl, source_url: sourceUrlSnake, youtubePlaylistId,
    youtube_playlist_id: youtubePlaylistIdSnake,
    youtubeVideoId, youtube_video_id: youtubeVideoIdSnake,
  } = body || {};
  const sourceType: MediaSourceType = rawSourceType || rawSourceTypeSnake || MUX_SOURCE_TYPE;
  if (!['vod', 'live'].includes(kind)) {
    return NextResponse.json({ error: 'kind must be vod or live' }, { status: 400, headers: NO_STORE });
  }
  if (label !== undefined && (typeof label !== 'string' || !label.trim() || label.length > 500)) {
    return NextResponse.json({ error: 'label must contain 1–500 characters' }, { status: 400, headers: NO_STORE });
  }
  if (durationSeconds !== undefined && durationSeconds !== null && (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0)) {
    return NextResponse.json({ error: 'durationSeconds must be a finite positive number' }, { status: 400, headers: NO_STORE });
  }
  try {
    let newItem;
    let warning: string | null = null;
    let durationSource: 'mux' | 'youtube' | 'operator' | 'unknown' | 'ambient' = 'unknown';
    let captionStatus: 'available' | 'unverified' | null = null;
    let metadataVerified = false;
    if (sourceType === YOUTUBE_PLAYLIST_SOURCE_TYPE) {
      const playbackPlaylistId = typeof playbackId === 'string' ? parseYouTubePlaylistPlaybackId(playbackId) : null;
      const playlistInput = sourceUrl || sourceUrlSnake || youtubePlaylistId || youtubePlaylistIdSnake || playbackPlaylistId;
      let playlistId: string;
      try {
        playlistId = extractYouTubePlaylistId(typeof playlistInput === 'string' ? playlistInput : '');
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid YouTube playlist URL' }, { status: 400, headers: NO_STORE });
      }
      // Ambient hold playlists have no finite end and must not become queue timers.
      newItem = {
        playback_id: makeYouTubePlaylistPlaybackId(playlistId),
        label: label?.trim() || `YouTube Playlist ${playlistId}`,
        kind: 'vod',
        duration_seconds: null,
        source_type: YOUTUBE_PLAYLIST_SOURCE_TYPE,
        youtube_playlist_id: playlistId,
        source_url: sourceUrl || sourceUrlSnake || `https://www.youtube.com/playlist?list=${playlistId}`,
      };
      durationSource = 'ambient';
    } else if (sourceType === YOUTUBE_VIDEO_SOURCE_TYPE) {
      if (kind !== 'vod') {
        return NextResponse.json({ error: 'YouTube queue items must be finite videos, not live streams' }, { status: 400, headers: NO_STORE });
      }
      const encodedId = typeof playbackId === 'string' ? parseYouTubeVideoPlaybackId(playbackId) : null;
      const input = sourceUrl || sourceUrlSnake || youtubeVideoId || youtubeVideoIdSnake || encodedId || playbackId;
      let videoId: string;
      try { videoId = extractYouTubeVideoId(typeof input === 'string' ? input : ''); } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid YouTube video URL' }, { status: 400, headers: NO_STORE });
      }
      let duration: number | null = durationSeconds ?? null;
      let videoTitle = `YouTube video ${videoId}`;
      durationSource = duration ? 'operator' : 'unknown';
      captionStatus = 'unverified';
      if (hasYouTubeApiCredentials()) {
        try {
          const metadata = await fetchYouTubeVideoMetadata(videoId);
          duration = metadata.durationSeconds;
          videoTitle = metadata.title;
          durationSource = 'youtube';
          captionStatus = metadata.captionsAvailable ? 'available' : 'unverified';
          metadataVerified = true;
          warning = metadata.warnings.length ? metadata.warnings.join(' ') : null;
        } catch (error) {
          if (error instanceof YouTubeVideoValidationError) {
            return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE });
          }
          console.warn('YouTube metadata verification unavailable; operator verification required.');
          warning = 'YouTube metadata verification was unavailable. Captions and embed availability are unverified; rehearse this video in the embedded player and confirm the exact full duration before the show.';
        }
      } else {
        warning = 'YouTube API verification is not configured. Captions and embed availability are unverified; rehearse this video in the embedded player and confirm the exact full duration before the show.';
      }
      if (!duration) {
        return NextResponse.json({ error: 'Enter the exact full YouTube video duration in seconds. Automatic duration lookup is unavailable.', warning }, { status: 400, headers: NO_STORE });
      }
      newItem = {
        playback_id: makeYouTubeVideoPlaybackId(videoId), label: label?.trim() || videoTitle,
        kind: 'vod', duration_seconds: duration, source_type: YOUTUBE_VIDEO_SOURCE_TYPE,
        youtube_playlist_id: null, source_url: makeYouTubeVideoUrl(videoId),
      };
    } else if (sourceType === MUX_SOURCE_TYPE) {
      if (typeof playbackId !== 'string' || !playbackId.trim() || playbackId.length > 256) {
        return NextResponse.json({ error: 'A valid playbackId is required' }, { status: 400, headers: NO_STORE });
      }
      let duration = kind === 'vod' ? durationSeconds ?? null : null;
      durationSource = duration ? 'operator' : 'unknown';
      if (kind === 'vod' && hasMuxApiCredentials()) {
        try {
          // Use the asset's own duration even if an operator supplied an estimate.
          duration = await getMuxPlaybackDuration(playbackId.trim());
          durationSource = 'mux';
        } catch (error) {
          if (error instanceof MuxVodTypeError) {
            return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE });
          }
          console.warn('Could not verify Mux VOD duration:', error instanceof Error ? error.message : 'Unknown error');
          warning = duration
            ? 'Mux duration verification was unavailable. Confirm that the entered duration matches the full video before enabling automatic playback.'
            : 'Mux duration could not be verified. This item is available for manual playback only until a positive duration is supplied.';
        }
      } else if (kind === 'vod' && !duration) {
        warning = 'Mux API credentials are not configured. Add the exact video duration in seconds before using this item in automatic playback; manual playback remains available.';
      }
      newItem = {
        playback_id: playbackId.trim(),
        label: label?.trim() || playbackId.trim(),
        kind,
        duration_seconds: duration,
        source_type: MUX_SOURCE_TYPE,
        youtube_playlist_id: null,
        source_url: null,
      };
    } else {
      return NextResponse.json({ error: 'Invalid sourceType' }, { status: 400, headers: NO_STORE });
    }
    const { data, error } = await supabaseAdmin.from('mux_items').insert(newItem).select().single();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'This media item already exists' }, { status: 409, headers: NO_STORE });
      }
      if (error.code === '23514' || error.code === 'P0001') {
        return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE });
      }
      console.error('Failed to add media item:', error);
      return NextResponse.json({ error: 'Failed to add media item' }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({ success: true, item: data, duration_source: durationSource, warning,
      ...(sourceType === YOUTUBE_VIDEO_SOURCE_TYPE ? { caption_status: captionStatus, metadata_verified: metadataVerified } : {}) }, { status: 201, headers: NO_STORE });
  } catch (error) {
    console.error('Error adding media item:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'A valid item ID is required' }, { status: 400, headers: NO_STORE });
    }
    // The safety checks and delete share the queue/timeline lock. A cue cannot
    // become active or queued between checking it and deleting its duration.
    const { error } = await supabaseAdmin.rpc('delete_mux_item', {
      item_id: id,
      admin_user_id: session.userId,
    });
    if (error) {
      if (error.code === 'P0001') {
        return NextResponse.json({ error: error.message }, {
          status: error.message.includes('not found') ? 404 : 409, headers: NO_STORE,
        });
      }
      console.error('Failed to delete media item:', error);
      return NextResponse.json({ error: 'Failed to delete media item' }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({ success: true, message: 'Media item deleted successfully' }, { headers: NO_STORE });
  } catch (error) {
    console.error('Error deleting media item:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
