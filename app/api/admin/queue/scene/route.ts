import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isSceneId, sceneLengthError } from '@/lib/scenes';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (session?.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const body = await request.json().catch(() => null);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!body || !isSceneId(body.sceneId) || !uuid.test(body.commandId || '')) {
    return NextResponse.json({ error: 'Choose a scene and its length.' }, { status: 400, headers });
  }
  const lengthError = sceneLengthError(body.lengthSeconds);
  if (lengthError) return NextResponse.json({ error: lengthError }, { status: 400, headers });
  const { data, error } = await supabaseAdmin.rpc('queue_scene_cue', {
    scene_id: body.sceneId, length_seconds: body.lengthSeconds, actor: session.userId, command_id: body.commandId,
  });
  if (error) {
    // An older database has no scene function; nothing was written.
    const missing = error.code === '42883' || error.code === 'PGRST202';
    return NextResponse.json({
      error: error.code === 'P0001' ? error.message
        : missing ? 'Install scene cue support (database update 028) before queuing scenes.'
        : 'Could not queue the scene.',
    }, { status: error.code === 'P0001' ? 409 : missing ? 503 : 500, headers });
  }
  return NextResponse.json({ item: data }, { status: 201, headers });
}
