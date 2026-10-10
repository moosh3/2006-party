import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/session';
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
    playbackId, title, kind = 'vod', sourceType: rawSourceType,
    source_type: rawSourceTypeSnake, youtubePlaylistId,
    youtube_playlist_id: youtubePlaylistIdSnake, sourceUrl,
    source_url: sourceUrlSnake, commandId,
    youtubeVideoId, youtube_video_id: youtubeVideoIdSnake,
  } = body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 500) {
    return NextResponse.json({ error: 'A title of 1–500 characters is required' }, { status: 400, headers: NO_STORE });
  }
  if (!['vod', 'live'].includes(kind)) {
    return NextResponse.json({ error: 'kind must be vod or live' }, { status: 400, headers: NO_STORE });
  }
  if (commandId !== undefined && (typeof commandId !== 'string' || !commandId.trim() || commandId.length > 200)) {
    return NextResponse.json({ error: 'Invalid commandId' }, { status: 400, headers: NO_STORE });
  }
  const sourceType: MediaSourceType = rawSourceType || rawSourceTypeSnake || MUX_SOURCE_TYPE;
  let nextPlaybackId = playbackId;
  let nextKind = kind;
  let nextYoutubePlaylistId: string | null = null;
  let nextSourceUrl: string | null = null;
  if (sourceType === YOUTUBE_PLAYLIST_SOURCE_TYPE) {
    const playbackPlaylistId = typeof playbackId === 'string' ? parseYouTubePlaylistPlaybackId(playbackId) : null;
    const playlistInput = youtubePlaylistId || youtubePlaylistIdSnake || playbackPlaylistId || sourceUrl || sourceUrlSnake || playbackId;
    try {
      nextYoutubePlaylistId = extractYouTubePlaylistId(typeof playlistInput === 'string' ? playlistInput : '');
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid YouTube playlist URL' }, { status: 400, headers: NO_STORE });
    }
    nextPlaybackId = makeYouTubePlaylistPlaybackId(nextYoutubePlaylistId);
    nextKind = 'vod';
    nextSourceUrl = sourceUrl || sourceUrlSnake || `https://www.youtube.com/playlist?list=${nextYoutubePlaylistId}`;
  } else if (sourceType === YOUTUBE_VIDEO_SOURCE_TYPE) {
    if (kind !== 'vod') {
      return NextResponse.json({ error: 'YouTube queue items must be finite videos, not live streams' }, { status: 400, headers: NO_STORE });
    }
    const encodedId = typeof playbackId === 'string' ? parseYouTubeVideoPlaybackId(playbackId) : null;
    const input = youtubeVideoId || youtubeVideoIdSnake || encodedId || sourceUrl || sourceUrlSnake || playbackId;
    try {
      const videoId = extractYouTubeVideoId(typeof input === 'string' ? input : '');
      nextPlaybackId = makeYouTubeVideoPlaybackId(videoId);
      nextSourceUrl = makeYouTubeVideoUrl(videoId);
      nextKind = 'vod';
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid YouTube video URL' }, { status: 400, headers: NO_STORE });
    }
  } else if (sourceType === MUX_SOURCE_TYPE) {
    if (typeof playbackId !== 'string' || !playbackId.trim() || playbackId.length > 256) {
      return NextResponse.json({ error: 'A valid playbackId is required' }, { status: 400, headers: NO_STORE });
    }
  } else {
    return NextResponse.json({ error: 'Invalid sourceType' }, { status: 400, headers: NO_STORE });
  }
  try {
    // Source change, hold reset, session rotation, and audit log commit together.
    const { data, error } = await supabaseAdmin.rpc('set_manual_stream', {
      new_playback_id: nextPlaybackId,
      new_title: title.trim(),
      new_kind: nextKind,
      new_source_type: sourceType,
      new_youtube_playlist_id: nextYoutubePlaylistId,
      new_source_url: nextSourceUrl,
      admin_user_id: session.userId,
      command_id: commandId || randomUUID(),
    });
    if (error) {
      if (error.code === 'P0001' || error.code === '22023') {
        return NextResponse.json({ error: error.message }, { status: 409, headers: NO_STORE });
      }
      console.error('Failed to set manual stream:', error);
      return NextResponse.json({ error: 'Failed to update stream' }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({ success: true, duplicate: Boolean(data.duplicate), updatedAt: data.stream.updated_at, stream: data.stream }, { headers: NO_STORE });
  } catch (error) {
    console.error('Error updating stream:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }
  try {
    const { data, error } = await supabaseAdmin.rpc('get_playout_snapshot');
    if (error || !data?.stream) {
      return NextResponse.json({ error: 'Failed to fetch current stream' }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json(data.stream, { headers: NO_STORE });
  } catch (error) {
    console.error('Error fetching stream:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
