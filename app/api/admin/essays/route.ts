import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { supabaseAdmin as db } from '@/lib/supabase-admin';
import { sameOrigin } from '@/lib/game-server';
import { missingEssayTable, toEssay } from '@/lib/essays-server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Recent essays, newest first, including hidden ones. */
export async function GET() {
  const session = await getSession();
  if (session?.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const { data, error } = await db.from('essay_submissions').select('id,screen_name,prompt,body,created_at,hidden')
    .order('created_at', { ascending: false }).limit(300);
  if (error) {
    return NextResponse.json({ error: missingEssayTable(error.code) ? 'Install essay submissions (database update 029).' : 'Could not load essays.' },
      { status: missingEssayTable(error.code) ? 503 : 500, headers });
  }
  return NextResponse.json({ essays: (data || []).map(row => ({ ...toEssay(row), hidden: row.hidden === true })) }, { headers });
}

/** Hide or restore one published essay. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (session?.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  try { sameOrigin(request); } catch { return NextResponse.json({ error: 'Invalid request origin' }, { status: 403, headers }); }
  const body = await request.json().catch(() => null);
  if (!body || !uuid.test(body.id || '') || typeof body.hidden !== 'boolean') {
    return NextResponse.json({ error: 'Choose an essay to hide or restore.' }, { status: 400, headers });
  }
  const { data, error } = await db.rpc('essay_set_hidden', { essay_id: body.id, hide: body.hidden, actor: session.userId });
  if (error) return NextResponse.json({ error: error.code === 'P0001' ? error.message : 'Could not update the essay.' }, { status: error.code === 'P0001' ? 404 : 500, headers });
  return NextResponse.json({ essay: data }, { headers });
}
