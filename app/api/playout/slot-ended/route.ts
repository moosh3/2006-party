import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { resolveShowtimePlayout } from '@/lib/showtime';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Browser notifications are hints only. The authored schedule and known asset
// duration determine when to enter hold, not an anonymous viewer's ended event.
export async function POST(request: NextRequest) {
  try {
    const { slotId, playbackId } = await request.json();
    if (typeof slotId !== 'string' || typeof playbackId !== 'string') {
      return NextResponse.json({ error: 'slotId and playbackId are required' }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.rpc('get_playout_snapshot');
    if (error || !data?.stream) return NextResponse.json({ error: 'Program feed unavailable' }, { status: 503 });
    if (data.stream.playout_mode !== 'schedule') return NextResponse.json({ success: true, ignored: true, reason: 'manual-mode' });
    const resolved = resolveShowtimePlayout(new Date(data.server_now), data.stream.schedule_early_ended_slot, data.stream.schedule_early_ended_at);
    return NextResponse.json({
      success: true, ignored: true,
      reason: resolved.activeSlotId !== slotId || resolved.playbackId !== playbackId ? 'not-active-slot' : 'server-clock-authoritative',
      isHoldScreen: resolved.isHoldScreen,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Invalid end notification' }, { status: 400 });
  }
}
