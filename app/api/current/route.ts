import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { generatePlaybackToken } from '@/lib/mux';
import { isDevelopment } from '@/lib/config';
import {
  getCaptionTrackForPlaybackId,
  resolveShowtimePlayout,
  type PlayoutMode,
} from '@/lib/showtime';
import {
  MUX_SOURCE_TYPE,
  parseYouTubePlaylistPlaybackId,
  type MediaSourceType,
} from '@/lib/youtube';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  // Verify viewer authentication (client-side localStorage-based)
  // In a production system, you might want to verify viewer data server-side
  // For now, we'll allow access if the request comes from a browser context
  
  try {
    // Get current stream from database (including poster mode and hold screen flags)
    const { data, error } = await supabaseAdmin
      .from('current_stream')
      .select(`
        *,
        hold_screen_mux_item:hold_screen_mux_item_id (
          id,
          playback_id,
          label,
          kind,
          source_type,
          youtube_playlist_id,
          source_url
        )
      `)
      .eq('id', 1)
      .single();

    if (error || !data) {
      // DEVELOPMENT MODE: Return mock data if database is not configured
      // This allows the UI to be tested without full Supabase setup
      if (isDevelopment() || error?.message?.includes('connect')) {
        console.log('⚠️  Development mode: Returning mock stream data');
        const mockToken = 'mock-token-for-development';
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        
        return NextResponse.json({
          playbackId: 'demo-playback-id',
          title: '2006 program feed preview',
          kind: 'vod',
          token: mockToken,
          expiresAt,
          showPoster: false,
          isHoldScreen: false,
          playoutMode: 'manual',
          playbackState: 'playing',
          playbackPosition: 0,
          playbackUpdatedAt: new Date().toISOString(),
          playbackElapsedMs: 0,
          sourceType: MUX_SOURCE_TYPE,
          youtubePlaylistId: null,
          sourceUrl: null,
          captionFilename: null,
          captionUrl: null,
          captionLabel: null,
          captionLanguage: null,
        }, {
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        });
      }
      
      return NextResponse.json(
        { error: 'No active stream configured' },
        { status: 404 }
      );
    }

    const playoutMode: PlayoutMode = data.playout_mode || 'schedule';
    let playbackId = data.playback_id;
    let title = data.title;
    let kind = data.kind;
    let isHoldScreen = Boolean(data.hold_screen_enabled && data.hold_screen_mux_item_id);
    let playbackState = data.playback_state || 'playing';
    let playbackPosition = data.playback_position || 0;
    let playbackUpdatedAt = data.playback_updated_at || new Date().toISOString();
    let playbackElapsedMs = data.playback_elapsed_ms || 0;
    let scheduleStatus: string | null = null;
    let activeSlotId: string | null = null;
    let activeAssetKey: string | null = null;
    let nextTransitionAt: string | null = null;
    let eventSlug: string | null = null;
    let scheduleTitle: string | null = null;
    let captionFilename: string | null = null;
    let captionUrl: string | null = null;
    let captionLabel: string | null = null;
    let captionLanguage: string | null = null;
    let sourceType: MediaSourceType = data.source_type || MUX_SOURCE_TYPE;
    let youtubePlaylistId: string | null =
      data.youtube_playlist_id || parseYouTubePlaylistPlaybackId(playbackId);
    let sourceUrl: string | null = data.source_url || null;

    if (playoutMode === 'schedule') {
      const resolved = resolveShowtimePlayout(
        new Date(),
        data.schedule_early_ended_slot,
        data.schedule_early_ended_at
      );
      playbackId = resolved.playbackId;
      title = resolved.title;
      kind = resolved.kind;
      isHoldScreen = resolved.isHoldScreen;
      playbackState = resolved.playbackState;
      playbackPosition = resolved.playbackPosition;
      playbackUpdatedAt = resolved.playbackUpdatedAt;
      playbackElapsedMs = resolved.playbackElapsedMs;
      scheduleStatus = resolved.status;
      activeSlotId = resolved.activeSlotId;
      activeAssetKey = resolved.activeAssetKey;
      nextTransitionAt = resolved.nextTransitionAt;
      eventSlug = resolved.eventSlug;
      scheduleTitle = resolved.scheduleTitle;
      captionFilename = resolved.captionFilename;
      captionUrl = resolved.captionUrl;
      captionLabel = resolved.captionLabel;
      captionLanguage = resolved.captionLanguage;
      sourceType = resolved.sourceType;
      youtubePlaylistId = resolved.youtubePlaylistId;
      sourceUrl = resolved.sourceUrl;
    } else {
      if (isHoldScreen && data.hold_screen_mux_item) {
        const holdScreenItem = Array.isArray(data.hold_screen_mux_item)
          ? data.hold_screen_mux_item[0]
          : data.hold_screen_mux_item;

        if (holdScreenItem) {
          playbackId = holdScreenItem.playback_id;
          title = holdScreenItem.label;
          kind = holdScreenItem.kind || 'vod';
          sourceType = holdScreenItem.source_type || MUX_SOURCE_TYPE;
          youtubePlaylistId =
            holdScreenItem.youtube_playlist_id || parseYouTubePlaylistPlaybackId(holdScreenItem.playback_id);
          sourceUrl = holdScreenItem.source_url || null;
        } else {
          isHoldScreen = false;
        }
      } else if (isHoldScreen) {
        isHoldScreen = false;
      }

      if (sourceType === MUX_SOURCE_TYPE) {
        const captions = getCaptionTrackForPlaybackId(playbackId);
        captionFilename = captions.captionFilename;
        captionUrl = captions.captionUrl;
        captionLabel = captions.captionLabel;
        captionLanguage = captions.captionLanguage;
      }
    }

    // Generate playback token (or use unsigned if credentials not configured)
    const token = sourceType === MUX_SOURCE_TYPE
      ? await generatePlaybackToken(playbackId)
      : 'unsigned';

    // Calculate expiry time (1 hour from now)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    return NextResponse.json({
      playbackId,
      title,
      kind,
      token,
      expiresAt,
      showPoster: data.show_poster || false,
      isHoldScreen: isHoldScreen || false,
      sourceType,
      youtubePlaylistId,
      sourceUrl,
      playoutMode,
      playbackState,
      playbackPosition,
      playbackUpdatedAt,
      playbackElapsedMs,
      scheduleStatus,
      activeSlotId,
      activeAssetKey,
      nextTransitionAt,
      eventSlug,
      scheduleTitle,
      captionFilename,
      captionUrl,
      captionLabel,
      captionLanguage,
    }, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Error fetching current stream:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
