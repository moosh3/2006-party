import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getSession } from '@/lib/session';
import { MUX_SOURCE_TYPE, YOUTUBE_VIDEO_SOURCE_TYPE } from '@/lib/youtube';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

// GET - Fetch entire queue with video details
export async function GET(request: NextRequest) {
  const session = await getSession();
  
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('video_queue')
      .select(`
        id,
        position,
        created_at,
        countdown,
        mux_item_id,
        mux_items (
          id,
          playback_id,
          label,
          kind,
          duration_seconds,
          source_type,
          source_url,
          youtube_playlist_id
        )
      `)
      .order('position', { ascending: true });

    if (error) {
      console.error('Error fetching queue:', error);
      return NextResponse.json(
        { error: 'Failed to fetch queue' },
        { status: 500, headers: NO_STORE }
      );
    }

    return NextResponse.json({ queue: data || [] }, { headers: NO_STORE });
  } catch (error) {
    console.error('Error fetching queue:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: NO_STORE }
    );
  }
}

// POST - Add video to queue
export async function POST(request: NextRequest) {
  const session = await getSession();
  
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }

  try {
    const { muxItemId } = await request.json();

    if (!muxItemId) {
      return NextResponse.json(
        { error: 'muxItemId is required' },
        { status: 400, headers: NO_STORE }
      );
    }

    const { data: muxItem, error: muxItemError } = await supabaseAdmin
      .from('mux_items')
      .select('source_type,kind,duration_seconds')
      .eq('id', muxItemId)
      .single();

    if (muxItemError || !muxItem) {
      return NextResponse.json(
        { error: 'Media item not found' },
        { status: 404, headers: NO_STORE }
      );
    }

    if (![MUX_SOURCE_TYPE, YOUTUBE_VIDEO_SOURCE_TYPE].includes(muxItem.source_type || MUX_SOURCE_TYPE)) {
      return NextResponse.json(
        { error: 'Only finite Mux or individual YouTube videos can be queued; playlists are ambient-only' },
        { status: 400, headers: NO_STORE }
      );
    }

    if (muxItem.kind === 'live' || !Number.isFinite(Number(muxItem.duration_seconds)) || Number(muxItem.duration_seconds) <= 0) {
      return NextResponse.json({ error: 'Queue videos must be on-demand Mux or individual YouTube videos with an exact positive duration. Add the duration in the library first.' }, { status: 400, headers: NO_STORE });
    }

    const { data, error } = await supabaseAdmin
      .rpc('enqueue_video', {
        mux_item_id: muxItemId,
        admin_user_id: session.userId,
      });

    if (error) {
      if (error.message.includes('Mux item not found') || error.message.includes('Media item not found')) {
        return NextResponse.json(
          { error: 'Media item not found' },
          { status: 404, headers: NO_STORE }
        );
      }

      if (error.code === 'P0001' || error.code === '23514') {
        return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE });
      }

      console.error('Error adding to queue:', error);
      return NextResponse.json(
        { error: 'Failed to add to queue' },
        { status: 500, headers: NO_STORE }
      );
    }

    return NextResponse.json({ success: true, item: data }, { status: 201, headers: NO_STORE });
  } catch (error) {
    console.error('Error adding to queue:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: NO_STORE }
    );
  }
}

// PATCH - Reorder queue items
// ISSUE #3: Now uses atomic database function for transaction safety
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }

  try {
    const { items } = await request.json();

    if (!Array.isArray(items)) {
      return NextResponse.json(
        { error: 'items array is required' },
        { status: 400, headers: NO_STORE }
      );
    }

    // Validate that each item has id and position
    for (const item of items) {
      if (typeof item.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.id) || !Number.isSafeInteger(item.position) || item.position < 1) {
        return NextResponse.json(
          { error: 'Each item must have id and position' },
          { status: 400, headers: NO_STORE }
        );
      }
    }

    // ISSUE #3: Use atomic database function for transaction safety
    const { error } = await supabaseAdmin.rpc('reorder_queue', {
      items,
      admin_user_id: session.userId,
    });

    if (error) {
      console.error('Error reordering queue:', error);
      return NextResponse.json(
        { error: 'Failed to reorder queue' },
        { status: 500, headers: NO_STORE }
      );
    }

    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (error) {
    console.error('Error reordering queue:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: NO_STORE }
    );
  }
}
