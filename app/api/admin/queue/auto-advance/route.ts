import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }
  try {
    const { data: snapshot, error } = await supabaseAdmin.rpc('get_playout_snapshot');
    if (error || !snapshot?.stream) {
      console.error('Error fetching auto-advance status:', error);
      return NextResponse.json({ error: 'Failed to fetch auto-advance status' }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({
      auto_advance_enabled: Boolean(snapshot.stream.auto_advance_enabled),
      automation_status: snapshot.automation_status,
      automation_error: snapshot.automation_error,
      next_transition_at: snapshot.next_transition_at,
      playback_session_id: snapshot.stream.playback_session_id,
      server_now: snapshot.server_now,
    }, { headers: NO_STORE });
  } catch (error) {
    console.error('Error fetching auto-advance status:', error);
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
  const { enabled, commandId } = body || {};
  if (typeof enabled !== 'boolean' || (commandId !== undefined && (typeof commandId !== 'string' || !commandId.trim() || commandId.length > 200))) {
    return NextResponse.json({ error: 'enabled (boolean) and a valid optional commandId are required' }, { status: 400, headers: NO_STORE });
  }
  try {
    // Arming validates the current and queued durations in the same transaction.
    // Re-arming clears an old automation fault only after validation succeeds.
    const { data, error } = await supabaseAdmin.rpc('set_auto_advance', {
      enabled,
      admin_user_id: session.userId,
      command_id: commandId || randomUUID(),
    });
    if (error) {
      if (error.code === 'P0001' || error.code === '22023') {
        return NextResponse.json({ error: error.message }, { status: 409, headers: NO_STORE });
      }
      console.error('Error updating auto-advance:', error);
      return NextResponse.json({ error: 'Failed to update auto-advance setting' }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({
      success: true,
      duplicate: Boolean(data.duplicate),
      auto_advance_enabled: Boolean(data.stream.auto_advance_enabled),
      automation_error: data.stream.automation_error || null,
      stream: data.stream,
    }, { headers: NO_STORE });
  } catch (error) {
    console.error('Error toggling auto-advance:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
