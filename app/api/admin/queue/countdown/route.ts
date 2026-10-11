import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { countdownError, type CountdownCue } from '@/lib/countdown';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (session?.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const body = await request.json().catch(() => null);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!body || !uuid.test(body.muxItemId || '') || (body.queueId != null && !uuid.test(body.queueId)) || !body.countdown || !uuid.test(body.commandId || '')) {
    return NextResponse.json({ error: 'Choose a library video and countdown settings.' }, { status: 400, headers });
  }
  const { data: media, error: mediaError } = await supabaseAdmin.from('mux_items').select('duration_seconds').eq('id', body.muxItemId).single();
  if (mediaError || !media) return NextResponse.json({ error: 'Library video not found.' }, { status: 404, headers });
  const cue: CountdownCue = { rank: body.countdown.rank, startSeconds: body.countdown.startSeconds,
    durationSeconds: body.countdown.durationSeconds, bannerUrl: body.countdown.bannerUrl || null };
  const validation = countdownError(cue, Number(media.duration_seconds));
  if (validation) return NextResponse.json({ error: validation }, { status: 400, headers });
  const { data, error } = await supabaseAdmin.rpc('save_countdown_cue', {
    media_id: body.muxItemId, cue, actor: session.userId, queue_id: body.queueId || null, command_id: body.commandId,
  });
  if (error) return NextResponse.json({ error: error.code === 'P0001' ? error.message : 'Could not save countdown cue. Check that the countdown database update is installed.' }, { status: error.code === 'P0001' ? 409 : 500, headers });
  return NextResponse.json({ item: data }, { status: body.queueId ? 200 : 201, headers });
}
