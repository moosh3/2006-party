import { NextResponse } from 'next/server';
import { gameViewer } from '@/lib/game-server';
import { supabaseAdmin as db } from '@/lib/supabase-admin';
import { toEssay, tonight } from '@/lib/essays-server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

/** Whether this guest already submitted tonight, so TextEdit shows it as final. */
export async function GET() {
  try {
    const viewer = await gameViewer();
    const since = await tonight();
    if (!viewer || !since) return NextResponse.json({ essay: null }, { headers });
    const { data, error } = await db.from('essay_submissions').select('id,screen_name,prompt,body,created_at')
      .eq('viewer_id', viewer.id).gte('created_at', since).order('created_at', { ascending: false }).limit(1);
    if (error) throw new Error(error.code || 'essay_submissions');
    return NextResponse.json({ essay: data?.[0] ? toEssay(data[0]) : null }, { headers });
  } catch (reason) {
    console.error('Essay status unavailable:', reason instanceof Error ? reason.message : 'unknown');
    return NextResponse.json({ error: 'Essay status unavailable' }, { status: 503, headers });
  }
}
