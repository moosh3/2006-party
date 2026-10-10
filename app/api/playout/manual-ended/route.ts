import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { MUX_SOURCE_TYPE } from '@/lib/youtube';
import { moderateRateLimit } from '@/lib/rate-limit-enhanced';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

export async function POST(request: NextRequest) {
  return moderateRateLimit()(request, async (req: NextRequest) => {
    let body;
    try { body = await req.json(); } catch {
      return NextResponse.json({ error: 'A valid JSON body is required' }, { status: 400, headers: NO_STORE });
    }
    const { playbackId, playbackSessionId } = body || {};
    if (typeof playbackId !== 'string' || !playbackId || playbackId.length > 256 || (playbackSessionId !== undefined && (typeof playbackSessionId !== 'string' || playbackSessionId.length > 100))) {
      return NextResponse.json({ error: 'A valid playbackId and optional playbackSessionId are required' }, { status: 400, headers: NO_STORE });
    }
    try {
      // Browser ended events are wake-up hints only. The server's clock and stored
      // duration decide whether a transition is due, never an untrusted duration.
      const { data: snapshot, error } = await supabaseAdmin.rpc('get_playout_snapshot');
      if (error || !snapshot?.stream) {
        console.error('Failed to reconcile manual playout:', error);
        return NextResponse.json({ error: 'Failed to read playout state' }, { status: 500, headers: NO_STORE });
      }
      const current = snapshot.stream;
      let reason = 'server-deadline-not-due';
      if ((current.playout_mode || 'schedule') !== 'manual') reason = 'schedule-mode';
      else if (current.hold_screen_enabled) reason = 'hold-screen';
      else if ((current.source_type || MUX_SOURCE_TYPE) !== MUX_SOURCE_TYPE) reason = 'non-mux-source';
      else if (!current.auto_advance_enabled) reason = 'auto-advance-disabled';
      else if (current.playback_id !== playbackId || (playbackSessionId !== undefined && current.playback_session_id !== playbackSessionId)) reason = 'playback-changed';
      else if (snapshot.automation_error) reason = 'automation-blocked';
      else if (current.playback_state !== 'playing') reason = 'not-playing';

      return NextResponse.json({
        success: true,
        ignored: true,
        reason,
        playback_id: current.playback_id,
        playback_session_id: current.playback_session_id,
        playback_state: current.playback_state,
        playback_position: current.playback_position,
        playback_updated_at: current.playback_updated_at,
        is_hold_screen: Boolean(current.hold_screen_enabled),
        server_now: snapshot.server_now,
        next_transition_at: snapshot.next_transition_at,
        automation_status: snapshot.automation_status,
      }, { headers: NO_STORE });
    } catch (error) {
      console.error('Error handling manual ended notification:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
    }
  });
}
