import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { audienceViewer } from '@/lib/audience-sign-on';
import { sameOrigin } from '@/lib/game-server';

export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store' };
const json = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: privateHeaders });

export async function POST(request: NextRequest) {
  try {
    try {
      sameOrigin(request);
    } catch {
      return json({ error: 'Invalid request origin' }, 403);
    }
    // The Mac sign-on cookie is canonical. Submitted names and IDs are labels,
    // not credentials, and must never let a viewer impersonate someone else.
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
      return json({ error: 'Message body is required' }, 400);
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return json({ error: 'Message body is required' }, 400);
    }
    const { room = 'event', body } = input as { room?: unknown; body?: unknown };

    // Preserve existing message limits and escaping after identity validation.
    if (typeof body !== 'string' || !body) {
      return json({ error: 'Message body is required' }, 400);
    }

    if (body.length > 600) {
      return json({ error: 'Message too long (max 600 characters)' }, 400);
    }

    // Check rate limit
    const { data: throttle } = await supabaseAdmin
      .from('chat_throttle')
      .select('last_msg_at')
      .eq('user_id', userId)
      .single();

    if (throttle) {
      const lastMessageTime = new Date(throttle.last_msg_at).getTime();
      const now = Date.now();
      const timeSinceLastMessage = now - lastMessageTime;
      const rateLimitMs = 2000; // 2 seconds

      if (timeSinceLastMessage < rateLimitMs) {
        const waitTime = Math.ceil((rateLimitMs - timeSinceLastMessage) / 1000);
        return json({ error: `Please wait ${waitTime} seconds before sending another message` }, 429);
      }
    }

    // Sanitize message (basic HTML escaping)
    const sanitizedBody = body
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .trim();

    if (!sanitizedBody) {
      return json({ error: 'Message cannot be empty' }, 400);
    }

    // Insert message
    const { data: message, error } = await supabaseAdmin
      .from('messages')
      .insert({
        room,
        user_id: userId,
        user_name: userName,
        kind: 'user',
        body: sanitizedBody,
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to insert message:', error);
      return json({ error: 'Failed to send message' }, 500);
    }

    // Update rate limit
    await supabaseAdmin
      .from('chat_throttle')
      .upsert({
        user_id: userId,
        last_msg_at: new Date().toISOString(),
      });

    return json({
      success: true,
      id: message.id,
      createdAt: message.created_at,
      // Explicit public fields only: accepted-message rendering must not wait
      // for a websocket echo, nor expose a viewer's private session data.
      message: {
        id: message.id,
        room: message.room,
        user_id: message.user_id,
        user_name: message.user_name,
        body: message.body,
        kind: message.kind,
        created_at: message.created_at,
        reactions: [],
        viewerReaction: null,
      },
    }, 201);
  } catch (error) {
    console.error('Chat send is temporarily unavailable');
    return json({ error: 'Chat is temporarily unavailable. Please try again.' }, 503);
  }
}
