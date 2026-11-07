import { NextResponse } from 'next/server';
import { advancesTonight } from '@/lib/show-log';
import { scenesAiredSince } from '@/lib/scenes';
import { countdownAiredSince, type ScoresPayload } from '@/lib/scores';
import { publishedEssays } from '@/lib/essays-server';
import { snapshot } from '@/lib/game-server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=10' };
const empty: ScoresPayload = { available: false, superlatives: [], countdown: [], essays: [] };

/** Let's Check Our Scores. Live superlative totals stay private until the
 * Scores scene has started tonight; then everyone (and /stage) sees them. */
export async function GET() {
  try {
    const actions = await advancesTonight();
    if (!actions || !scenesAiredSince(actions).includes('check-our-scores')) return NextResponse.json(empty, { headers });
    const [game, essays] = await Promise.all([
      snapshot(true),
      // Essays are optional: an older database without 029 still shows scores.
      publishedEssays().catch(() => []),
    ]);
    const payload: ScoresPayload = {
      available: true,
      superlatives: game.prompts.filter(p => p.kind === 'superlative' && p.status !== 'draft').map(p => ({
        id: p.id, question: p.question, status: p.status as 'open' | 'closed',
        options: p.options.map(o => ({ label: o.label, count: o.count || 0 })),
      })),
      countdown: countdownAiredSince(actions),
      essays,
    };
    return NextResponse.json(payload, { headers });
  } catch (reason) {
    console.error('Scores unavailable:', reason instanceof Error ? reason.message : 'unknown');
    return NextResponse.json({ error: 'Scores are temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
