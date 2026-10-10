import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/session';
import { moderateRateLimit } from '@/lib/rate-limit-enhanced';
import { resolveShowtimePlayout, type PlayoutMode } from '@/lib/showtime';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  return moderateRateLimit()(request, async (req: NextRequest) => {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }

    let body;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'A valid JSON body is required' }, { status: 400, headers: NO_STORE });
    }
    const { action, position, commandId, expectedSessionId } = body || {};
    if (!['play', 'pause', 'seek', 'restart'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Must be play, pause, seek, or restart' }, { status: 400, headers: NO_STORE });
    }
    if ((position !== undefined && (typeof position !== 'number' || !Number.isFinite(position) || position < 0)) || (action === 'seek' && position === undefined)) {
      return NextResponse.json({ error: 'Position must be a finite number >= 0, and is required for seek' }, { status: 400, headers: NO_STORE });
    }
    if ((commandId !== undefined && (typeof commandId !== 'string' || !commandId.trim() || commandId.length > 200)) || (expectedSessionId !== undefined && (typeof expectedSessionId !== 'string' || !UUID.test(expectedSessionId)))) {
      return NextResponse.json({ error: 'Invalid commandId or expectedSessionId' }, { status: 400, headers: NO_STORE });
    }

    try {
      const finalCommandId = commandId || randomUUID();
      // Lock and derive the elapsed position inside the transaction, never from a stale GET.
      const { data, error } = await supabaseAdmin.rpc('playback_command', {
        command_action: action,
        command_position: position ?? null,
        command_id: finalCommandId,
        admin_user_id: session.userId,
        expected_session_id: expectedSessionId ?? null,
      });
      if (error) {
        if (error.code === 'P0001' || error.code === '22023') {
          return NextResponse.json({ error: error.message }, { status: error.message.includes('Position') ? 400 : 409, headers: NO_STORE });
        }
        console.error('Failed to control playback:', error);
        return NextResponse.json({ error: 'Failed to update playback state' }, { status: 500, headers: NO_STORE });
      }
      const stream = data.stream;
      return NextResponse.json({
        success: true,
        duplicate: Boolean(data.duplicate),
        playback_state: stream.playback_state,
        playback_position: stream.playback_position,
        playback_elapsed_ms: stream.playback_elapsed_ms || 0,
        playback_updated_at: stream.playback_updated_at,
        playback_session_id: stream.playback_session_id,
        command_id: finalCommandId,
        message: `Playback ${action} command sent to all viewers`,
      }, { headers: NO_STORE });
    } catch (error) {
      console.error('Error controlling playback:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
    }
  });
}

export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }
  try {
    const { data: snapshot, error } = await supabaseAdmin.rpc('get_playout_snapshot');
    if (error || !snapshot?.stream) {
      console.error('Failed to fetch playback state:', error);
      return NextResponse.json({ error: 'Failed to fetch playback state' }, { status: 500, headers: NO_STORE });
    }
    const data = snapshot.stream;
    const playoutMode: PlayoutMode = data.playout_mode || 'schedule';
    if (playoutMode === 'schedule') {
      const resolved = resolveShowtimePlayout(new Date(snapshot.server_now), data.schedule_early_ended_slot, data.schedule_early_ended_at);
      return NextResponse.json({
        playout_mode: playoutMode,
        playback_state: resolved.playbackState,
        playback_position: resolved.playbackPosition,
        playback_updated_at: resolved.playbackUpdatedAt,
        playback_elapsed_ms: resolved.playbackElapsedMs,
        last_playback_command: data.last_playback_command,
        last_command_id: data.last_command_id,
        playback_session_id: data.playback_session_id,
        schedule_status: resolved.status,
        active_slot_id: resolved.activeSlotId,
        active_asset_key: resolved.activeAssetKey,
        next_transition_at: resolved.nextTransitionAt,
        title: resolved.title,
        is_hold_screen: resolved.isHoldScreen,
        server_now: snapshot.server_now,
      }, { headers: NO_STORE });
    }
    return NextResponse.json({
      ...data,
      playout_mode: playoutMode,
      playback_duration_seconds: snapshot.playback_duration_seconds,
      next_transition_at: snapshot.next_transition_at,
      automation_status: snapshot.automation_status,
      automation_error: snapshot.automation_error,
      server_now: snapshot.server_now,
    }, { headers: NO_STORE });
  } catch (error) {
    console.error('Error fetching playback state:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
