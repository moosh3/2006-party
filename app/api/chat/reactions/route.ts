import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { audienceViewer } from '@/lib/audience-sign-on';
import { sameOrigin } from '@/lib/game-server';
import {
  MESSAGE_REACTIONS,
  isMessageReaction,
  type MessageReaction,
  type MessageReactionSummary,
} from '@/lib/reactions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const privateHeaders = { 'Cache-Control': 'private, no-store' };
const json = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: privateHeaders });

type ReactionRow = {
  user_id: string;
  reaction: string;
};

function summarizeReactions(rows: ReactionRow[], viewerId: string) {
  const counts = new Map<MessageReaction, number>();
  let viewerReaction: MessageReaction | null = null;

  for (const row of rows) {
    if (!isMessageReaction(row.reaction)) continue;

    counts.set(row.reaction, (counts.get(row.reaction) || 0) + 1);
    if (row.user_id === viewerId) {
      viewerReaction = row.reaction;
    }
  }

  const reactions: MessageReactionSummary[] = MESSAGE_REACTIONS
    .map((reaction) => ({
      reaction,
      count: counts.get(reaction) || 0,
      viewerReacted: viewerReaction === reaction,
    }))
    .filter((reaction) => reaction.count > 0);

  return { reactions, viewerReaction };
}

export async function POST(request: NextRequest) {
  try {
    try {
      sameOrigin(request);
    } catch {
      return json({ error: 'Invalid request origin' }, 403);
    }
    // Use the same cookie-backed identity as Mac sign-on and chat send. A
    // submitted label must not let a viewer add or remove another user's vote.
    const viewer = await audienceViewer();
    if (!viewer || viewer.blocked) {
      return json({ error: 'Sign on to participate, or contact the host if participation is unavailable.' }, 403);
    }
    const userId = viewer.id;
    const userName = viewer.name;
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return json({ error: 'messageId is required' }, 400);
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return json({ error: 'messageId is required' }, 400);
    }
    const { messageId, reaction } = input as { messageId?: unknown; reaction?: unknown };
    const numericMessageId = Number(messageId);

    if (!Number.isInteger(numericMessageId) || numericMessageId <= 0) {
      return json({ error: 'messageId is required' }, 400);
    }

    if (!isMessageReaction(reaction)) {
      return json({ error: 'Invalid reaction' }, 400);
    }

    const { data: message, error: messageError } = await supabaseAdmin
      .from('messages')
      .select('id, kind, deleted_at')
      .eq('id', numericMessageId)
      .single();

    if (messageError || !message || message.deleted_at) {
      return json({ error: 'Message not found' }, 404);
    }

    if (message.kind !== 'user') {
      return json({ error: 'Only chat messages can be reacted to' }, 400);
    }

    const { data: existingReaction, error: existingError } = await supabaseAdmin
      .from('message_reactions')
      .select('reaction')
      .eq('message_id', numericMessageId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingError) {
      console.error('Failed to load existing reaction:', existingError);
      return json({ error: 'Reactions are not set up yet' }, 500);
    }

    if (existingReaction?.reaction === reaction) {
      const { error: deleteError } = await supabaseAdmin
        .from('message_reactions')
        .delete()
        .eq('message_id', numericMessageId)
        .eq('user_id', userId);

      if (deleteError) {
        console.error('Failed to delete reaction:', deleteError);
        return json({ error: 'Failed to remove reaction' }, 500);
      }
    } else {
      const { error: upsertError } = await supabaseAdmin
        .from('message_reactions')
        .upsert(
          {
            message_id: numericMessageId,
            user_id: userId,
            user_name: userName,
            reaction,
          },
          { onConflict: 'message_id,user_id' }
        );

      if (upsertError) {
        console.error('Failed to save reaction:', upsertError);
        return json({ error: 'Failed to save reaction' }, 500);
      }
    }

    const { data: rows, error: rowsError } = await supabaseAdmin
      .from('message_reactions')
      .select('user_id, reaction')
      .eq('message_id', numericMessageId);

    if (rowsError) {
      console.error('Failed to load reaction summary:', rowsError);
      return json({ error: 'Reaction saved, but failed to refresh counts' }, 500);
    }

    return json({
      success: true,
      messageId: numericMessageId,
      ...summarizeReactions(rows || [], userId),
    });
  } catch (error) {
    console.error('Chat reactions are temporarily unavailable');
    return json({ error: 'Reactions are temporarily unavailable. Please try again.' }, 503);
  }
}
