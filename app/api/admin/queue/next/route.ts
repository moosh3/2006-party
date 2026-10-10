import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'A commandId UUID is required for advancing the queue' }, { status: 400, headers: NO_STORE });
  }
  const { commandId, expectedSessionId } = body || {};
  if (typeof commandId !== 'string' || !UUID.test(commandId) || (expectedSessionId !== undefined && (typeof expectedSessionId !== 'string' || !UUID.test(expectedSessionId)))) {
    return NextResponse.json({ error: 'A commandId UUID and valid optional expectedSessionId are required' }, { status: 400, headers: NO_STORE });
  }
  try {
    // The caller may replay this ID after a lost response without skipping another item.
    const { data, error } = await supabaseAdmin.rpc('advance_queue_command', {
      admin_user_id: session.userId,
      command_id: commandId,
      expected_session_id: expectedSessionId ?? null,
    });
    if (error) {
      if (error.message.includes('No videos in queue')) {
        return NextResponse.json({ error: 'No videos in queue', empty: true }, { status: 404, headers: NO_STORE });
      }
      if (error.code === 'P0001' || error.code === '22023') {
        return NextResponse.json({ error: error.message }, { status: 409, headers: NO_STORE });
      }
      console.error('Error advancing queue:', error);
      return NextResponse.json({ error: 'Failed to advance to next video' }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({
      success: true,
      duplicate: Boolean(data.duplicate),
      command_id: commandId,
      stream: data.stream,
      advanced_to: { playback_id: data.playback_id, title: data.title, kind: data.kind },
    }, { headers: NO_STORE });
  } catch (error) {
    console.error('Error advancing queue:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
