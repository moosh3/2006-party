import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }
  try {
    const { data: snapshot, error } = await supabaseAdmin.rpc('get_playout_snapshot');
    if (error || !snapshot?.stream) {
      console.error('Error fetching hold screen config:', error);
      return NextResponse.json({ error: 'Failed to fetch hold screen configuration' }, { status: 500, headers: NO_STORE });
    }
    const stream = snapshot.stream;
    let muxItem = null;
    if (stream.hold_screen_mux_item_id) {
      const { data, error: itemError } = await supabaseAdmin.from('mux_items')
        .select('id, playback_id, label, kind, duration_seconds, source_type, youtube_playlist_id, source_url')
        .eq('id', stream.hold_screen_mux_item_id).maybeSingle();
      if (itemError) {
        console.error('Error fetching hold screen item:', itemError);
        return NextResponse.json({ error: 'Failed to fetch hold screen item' }, { status: 500, headers: NO_STORE });
      }
      muxItem = data;
    }
    return NextResponse.json({
      hold_screen_enabled: Boolean(stream.hold_screen_enabled),
      hold_screen_mux_item_id: stream.hold_screen_mux_item_id || null,
      mux_item: muxItem,
    }, { headers: NO_STORE });
  } catch (error) {
    console.error('Error fetching hold screen config:', error);
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
  const { action, muxItemId, commandId } = body || {};
  if (!['enable', 'disable', 'set_item'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action. Must be enable, disable, or set_item' }, { status: 400, headers: NO_STORE });
  }
  if (action === 'set_item' && (typeof muxItemId !== 'string' || !UUID.test(muxItemId))) {
    return NextResponse.json({ error: 'A muxItemId UUID is required for set_item' }, { status: 400, headers: NO_STORE });
  }
  if (commandId !== undefined && (typeof commandId !== 'string' || !commandId.trim() || commandId.length > 200)) {
    return NextResponse.json({ error: 'Invalid commandId' }, { status: 400, headers: NO_STORE });
  }
  try {
    // Saving/resuming the exact elapsed program position occurs under one lock.
    const { data, error } = await supabaseAdmin.rpc('toggle_hold', {
      action,
      mux_item_id: action === 'set_item' ? muxItemId : null,
      admin_user_id: session.userId,
      command_id: commandId || randomUUID(),
    });
    if (error) {
      if (error.code === 'P0001' || error.code === '22023') {
        return NextResponse.json({ error: error.message }, { status: error.message.includes('not found') ? 404 : 409, headers: NO_STORE });
      }
      console.error('Failed to update hold screen:', error);
      return NextResponse.json({ error: 'Failed to update hold screen' }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({
      success: true,
      duplicate: Boolean(data.duplicate),
      hold_screen_mux_item_id: data.stream.hold_screen_mux_item_id,
      hold_screen_enabled: Boolean(data.stream.hold_screen_enabled),
      playback_session_id: data.stream.playback_session_id,
      message: action === 'set_item' ? 'Hold screen item saved' : `Hold screen ${action === 'enable' ? 'enabled' : 'disabled'}`,
    }, { headers: NO_STORE });
  } catch (error) {
    console.error('Error updating hold screen:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
