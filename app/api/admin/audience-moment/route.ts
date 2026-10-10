import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/session';
import {
  AUDIENCE_MOMENT_MAX_LENGTH,
  defaultActionLabel,
  isAudienceMomentAction,
  parseAudienceMoment,
  type AudienceMoment,
} from '@/lib/audience-moments';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== 'admin') return null;
  return session;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('current_stream')
    .select('audience_moment')
    .eq('id', 1)
    .single();

  if (error) {
    console.error('Failed to load audience moment:', error);
    return NextResponse.json({ error: 'Failed to load audience moment. Has sql/021 been run?' }, { status: 500 });
  }

  const moment = parseAudienceMoment(data?.audience_moment);
  return NextResponse.json({ moment: moment && !moment.cleared ? moment : null });
}

// POST { message, action, actionLabel?, autoOpen? } sends a moment.
// POST { clear: true } removes the current one (and hides it for viewers).
export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  let moment: AudienceMoment;

  if (body.clear === true) {
    moment = {
      id: randomUUID(), message: '', action: 'none', actionLabel: null, autoOpen: false,
      sentAt: new Date().toISOString(), cleared: true,
    };
  } else {
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }
    if (message.length > AUDIENCE_MOMENT_MAX_LENGTH) {
      return NextResponse.json({ error: `Message must be ${AUDIENCE_MOMENT_MAX_LENGTH} characters or fewer` }, { status: 400 });
    }
    const action = isAudienceMomentAction(body.action) ? body.action : 'none';
    const actionLabel = typeof body.actionLabel === 'string' && body.actionLabel.trim()
      ? body.actionLabel.trim().slice(0, 40)
      : defaultActionLabel(action);

    moment = {
      id: randomUUID(),
      message,
      action,
      actionLabel,
      autoOpen: body.autoOpen === true && action !== 'none',
      sentAt: new Date().toISOString(),
    };
  }

  const { error } = await supabaseAdmin
    .from('current_stream')
    .update({ audience_moment: moment })
    .eq('id', 1);

  if (error) {
    console.error('Failed to update audience moment:', error);
    return NextResponse.json({ error: 'Failed to send. Has sql/021 been run?' }, { status: 500 });
  }

  await supabaseAdmin.from('admin_actions').insert({
    action_type: moment.cleared ? 'clear_audience_moment' : 'send_audience_moment',
    admin_user: session.userId,
    details: moment,
  });

  return NextResponse.json({ success: true, moment: moment.cleared ? null : moment });
}
