import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { readAudienceDoors } from '@/lib/audience-doors';
import { scenesAiredSince } from '@/lib/scenes';

export const dynamic = 'force-dynamic';
// Many viewers poll this; a short shared cache keeps it off the database.
// Browsers must revalidate (max-age=0) so a stale "not aired" never sticks.
const headers = { 'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=30' };

/** Which scenes have started since the doors last opened, so latecomers can
 * reopen them. Reads the queue audit log; never changes show state. */
export async function GET() {
  try {
    const doors = await readAudienceDoors();
    if (!doors.doorsOpen) {
      return NextResponse.json({ aired: [] }, { headers });
    }
    const { data, error } = await supabaseAdmin.from('admin_actions').select('details')
      .eq('action_type', 'queue_advance').gte('created_at', doors.changedAt)
      .order('created_at', { ascending: false }).limit(500);
    if (error) throw new Error(error.code || 'admin_actions');
    return NextResponse.json({ aired: scenesAiredSince(data || []) }, { headers });
  } catch (reason) {
    console.error('Scene status unavailable:', reason instanceof Error ? reason.message : 'unknown');
    return NextResponse.json({ error: 'Scene status unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
