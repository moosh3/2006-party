import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getProgramPlaybackToken } from '@/lib/mux';
import { getCaptionTrackForPlaybackId, resolveShowtimePlayout } from '@/lib/showtime';
import { MUX_SOURCE_TYPE, YOUTUBE_VIDEO_SOURCE_TYPE, parseYouTubePlaylistPlaybackId, parseYouTubeVideoPlaybackId } from '@/lib/youtube';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const headers = { 'Cache-Control': 'no-store, max-age=0', 'Vercel-CDN-Cache-Control': 'no-store' };

/** One database-clock snapshot is the only authority for the queue and time.
 * Never substitute a development clip when the actual database fails. */
export async function GET() {
  try {
    const { data: snapshot, error } = await supabaseAdmin.rpc('get_playout_snapshot');
    if (error || !snapshot?.stream) {
      console.error('Program snapshot unavailable:', error?.code || 'missing-state');
      return NextResponse.json({ error: 'Program feed unavailable' }, { status: 503, headers });
    }
    const data = snapshot.stream;
    const serverNow = snapshot.server_now;
    const nowMs = Date.parse(serverNow);
    if (!Number.isFinite(nowMs)) throw new Error('Invalid program clock');
    const mode = data.playout_mode || 'manual';
    const resolved = mode === 'schedule' ? resolveShowtimePlayout(
      new Date(nowMs), data.schedule_early_ended_slot, data.schedule_early_ended_at,
    ) : null;
    let playbackId = resolved?.playbackId || data.playback_id;
    let title = resolved?.title || data.title;
    let kind = resolved?.kind || data.kind || 'vod';
    const isHoldScreen = resolved ? resolved.isHoldScreen : Boolean(data.hold_screen_enabled);
    let sourceType = resolved?.sourceType || data.source_type || MUX_SOURCE_TYPE;
    let youtubePlaylistId = resolved?.youtubePlaylistId || data.youtube_playlist_id || null;
    let sourceUrl = resolved?.sourceUrl || data.source_url || null;
    let duration = resolved || snapshot.playback_duration_seconds == null ? null : Number(snapshot.playback_duration_seconds);
    if (duration !== null && (!Number.isFinite(duration) || duration <= 0)) duration = null;
    if (!resolved && isHoldScreen) {
      if (data.hold_screen_mux_item_id) {
        const { data: hold, error: holdError } = await supabaseAdmin.from('mux_items')
          .select('playback_id,label,kind,source_type,youtube_playlist_id,source_url,duration_seconds')
          .eq('id', data.hold_screen_mux_item_id).single();
        if (holdError || !hold) throw new Error('Configured hold asset unavailable');
        playbackId = hold.playback_id;
        title = hold.label || '2006 — hold screen';
        kind = hold.kind || 'vod';
        sourceType = hold.source_type || MUX_SOURCE_TYPE;
        youtubePlaylistId = hold.youtube_playlist_id;
        sourceUrl = hold.source_url;
        duration = hold.duration_seconds === null ? null : Number(hold.duration_seconds);
      } else {
        playbackId = 'demo-playback-id';
        title = '2006 — waiting for the program';
        kind = 'vod'; sourceType = MUX_SOURCE_TYPE;
        youtubePlaylistId = null; sourceUrl = null; duration = null;
      }
    }
    const playbackState = isHoldScreen ? 'playing' : resolved?.playbackState || data.playback_state || 'paused';
    const anchor = resolved?.playbackUpdatedAt || data.playback_updated_at;
    const basePosition = Number(resolved?.playbackPosition ?? data.playback_position ?? 0);
    // Scheduled resolver has already calculated the position at this instant.
    const elapsed = resolved ? 0 : playbackState === 'playing'
      ? Math.max(0, (nowMs - Date.parse(anchor)) / 1000) : 0;
    let position = Math.max(0, basePosition + (Number.isFinite(elapsed) ? elapsed : 0));
    if (duration && duration > 0 && kind !== 'live') position = isHoldScreen ? position % duration : Math.min(position, duration);
    if (resolved) duration = null;
    const captions = resolved || (sourceType === MUX_SOURCE_TYPE ? getCaptionTrackForPlaybackId(playbackId) : null);
    const access = sourceType === MUX_SOURCE_TYPE ? await getProgramPlaybackToken(playbackId, duration)
      : { token: 'unsigned', expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    const sessionId = resolved
      ? `schedule:${resolved.activeSlotId || resolved.status}:${playbackId}:${isHoldScreen ? 'hold' : 'show'}`
      : data.playback_session_id;
    return NextResponse.json({
      playbackId, title, kind, ...access,
      showPoster: Boolean(data.show_poster), isHoldScreen,
      sourceType, youtubePlaylistId: youtubePlaylistId || parseYouTubePlaylistPlaybackId(playbackId), sourceUrl,
      youtubeVideoId: sourceType === YOUTUBE_VIDEO_SOURCE_TYPE ? parseYouTubeVideoPlaybackId(playbackId) : null,
      playoutMode: mode, playbackState,
      countdown: !resolved && !isHoldScreen ? data.countdown || null : null,
      clipEndSeconds: !resolved && !isHoldScreen && data.countdown ? Number(data.countdown.startSeconds) + Number(data.countdown.durationSeconds) : null,
      autoAdvanceEnabled: data.auto_advance_enabled === true,
      playbackPosition: resolved?.playbackPosition ?? Number(data.playback_position || 0),
      playbackUpdatedAt: anchor, playbackElapsedMs: 0,
      serverNow, playbackSessionId: sessionId, playbackRevision: Number(data.playback_revision || 0),
      playbackPositionSeconds: position, playbackDurationSeconds: duration,
      scheduleStatus: resolved?.status || null, activeSlotId: resolved?.activeSlotId || null,
      activeAssetKey: resolved?.activeAssetKey || null,
      nextTransitionAt: resolved?.nextTransitionAt || snapshot.next_transition_at || null,
      eventSlug: resolved?.eventSlug || '2006', scheduleTitle: resolved?.scheduleTitle || null,
      captionFilename: captions?.captionFilename || null, captionUrl: captions?.captionUrl || null,
      captionLabel: captions?.captionLabel || null,
      captionLanguage: sourceType === YOUTUBE_VIDEO_SOURCE_TYPE ? 'en' : captions?.captionLanguage || null,
      automationStatus: snapshot.automation_status, automationError: snapshot.automation_error || null,
    }, { headers });
  } catch (reason) {
    console.error('Program feed error:', reason instanceof Error ? reason.message : 'Unknown error');
    return NextResponse.json({ error: 'Program feed unavailable' }, { status: 503, headers });
  }
}
