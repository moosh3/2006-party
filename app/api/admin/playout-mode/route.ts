import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/session';
import { resolveShowtimePlayout } from '@/lib/showtime';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const { data, error } = await supabaseAdmin.rpc('get_playout_snapshot');
  if (error || !data?.stream) return NextResponse.json({ error: 'Program feed unavailable' }, { status: 503, headers });
  return NextResponse.json({
    mode: data.stream.playout_mode || 'manual',
    schedule: resolveShowtimePlayout(new Date(data.server_now), data.stream.schedule_early_ended_slot, data.stream.schedule_early_ended_at),
  }, { headers });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'A valid JSON body is required' }, { status: 400, headers });
  }
  const { mode, commandId } = body || {};
  if (!['manual', 'schedule'].includes(mode) || (commandId !== undefined && (typeof commandId !== 'string' || !commandId.trim() || commandId.length > 200))) {
    return NextResponse.json({ error: 'Invalid mode or commandId' }, { status: 400, headers });
  }
  const id = commandId || randomUUID();
  const { data, error } = await supabaseAdmin.rpc('set_playout_mode', { mode, command_id: id, admin_user_id: session.userId });
  if (error) return NextResponse.json({ error: 'Failed to change playout mode' }, { status: error.code === 'P0001' ? 409 : 500, headers });
  return NextResponse.json({ success: true, duplicate: Boolean(data.duplicate), mode: data.stream.playout_mode, commandId: id,
    schedule: resolveShowtimePlayout(new Date(), data.stream.schedule_early_ended_slot, data.stream.schedule_early_ended_at),
  }, { headers });
}
