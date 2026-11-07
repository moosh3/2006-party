import { NextRequest, NextResponse } from 'next/server';
import { gameViewer, sameOrigin, throttle } from '@/lib/game-server';
import { supabaseAdmin as db } from '@/lib/supabase-admin';
import { ESSAY_PROMPTS, essayError, isEssayPromptIndex } from '@/lib/essays';
import { missingEssayTable, publishedEssays } from '@/lib/essays-server';

export const dynamic = 'force-dynamic';
const publicHeaders = { 'Cache-Control': 'public, max-age=0, s-maxage=10, stale-while-revalidate=20' };
const privateHeaders = { 'Cache-Control': 'private, no-store' };

/** Tonight's published essays, oldest first. Hidden essays are left out. */
export async function GET() {
  try {
    return NextResponse.json({ essays: await publishedEssays() }, { headers: publicHeaders });
  } catch (reason) {
    console.error('Essays unavailable:', reason instanceof Error ? reason.message : 'unknown');
    return NextResponse.json({ error: 'Essays are temporarily unavailable.' }, { status: 503, headers: privateHeaders });
  }
}

/** Submitting publishes immediately with the guest's screen name and is final. */
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
  } catch {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403, headers: privateHeaders });
  }
  const viewer = await gameViewer().catch(() => null);
  if (!viewer || viewer.blocked) {
    return NextResponse.json({ error: 'Sign on to submit, or contact the host if participation is unavailable.' }, { status: 403, headers: privateHeaders });
  }
  const body = await request.json().catch(() => null);
  if (!body || !isEssayPromptIndex(body.promptIndex)) {
    return NextResponse.json({ error: 'Choose an essay prompt.' }, { status: 400, headers: privateHeaders });
  }
  const invalid = essayError(body.essay);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400, headers: privateHeaders });
  try {
    await throttle(`essay:${viewer.id}`, 5);
  } catch {
    return NextResponse.json({ error: 'Please wait a moment and try again.' }, { status: 429, headers: privateHeaders });
  }
  const { data, error } = await db.rpc('essay_submit', {
    v: viewer.id, prompt_idx: body.promptIndex, prompt_text: ESSAY_PROMPTS[body.promptIndex], essay: body.essay.trim(),
  });
  if (error) {
    return NextResponse.json({
      error: error.code === 'P0001' ? error.message
        : missingEssayTable(error.code) ? 'Essay submissions are not available yet.' : 'Could not submit your essay. Try again.',
    }, { status: error.code === 'P0001' ? 409 : missingEssayTable(error.code) ? 503 : 500, headers: privateHeaders });
  }
  return NextResponse.json({ essay: data }, { status: 201, headers: privateHeaders });
}
