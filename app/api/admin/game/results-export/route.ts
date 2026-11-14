import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/session';
import { snapshot } from '@/lib/game-server';
import { partyResults } from '@/lib/party-results';
import { supabaseAdmin as db } from '@/lib/supabase-admin';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest) {
 if ((await getAdminSession())?.role!=='admin') return NextResponse.json({error:'Unauthorized'},{status:401});
 try {
  let showId = req.nextUrl.searchParams.get('show');
  if (req.nextUrl.searchParams.get('active') === '1') {
    const active = await db.from('game_shows').select('id').eq('status','active').limit(2);
    if (active.error) throw active.error;
    if (active.data?.length !== 1) return NextResponse.json({error:'Choose one active night in the game desk before getting results.'},{status:409});
    showId = active.data[0].id;
  }
  const game=await snapshot(true,showId);
  if (req.nextUrl.searchParams.get('active') === '1' && !game.prompts.some(p=>['trivia','superlative'].includes(p.kind) && p.status==='closed'))
    return NextResponse.json({error:'No closed results yet. Close trivia and cast voting in the game desk first.'},{status:409});
  if (!game.show) return NextResponse.json({error:'Choose a show first.'},{status:404});
  return NextResponse.json(partyResults(game),{headers:{'Cache-Control':'private, no-store','Content-Disposition':'attachment; filename="2006-results.json"'}});
 } catch {return NextResponse.json({error:'Results could not be exported.'},{status:503});}
}
