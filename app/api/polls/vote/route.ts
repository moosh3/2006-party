import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { gameViewer, sameOrigin, throttle } from '@/lib/game-server';

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { pollId, optionId } = await request.json();
    const viewer = await gameViewer();
    if (!viewer || viewer.blocked) return NextResponse.json({ error: 'Join the game before voting' }, { status: 403 });
    const userId = viewer.id;
    const userName = viewer.name;
    await throttle(`legacy-vote:${userId}`, 1);

    // Validate required fields
    if (!pollId || !optionId || !userId) {
      return NextResponse.json(
        { error: 'pollId, optionId, and userId are required' },
        { status: 400 }
      );
    }

    if (!userName) {
      return NextResponse.json(
        { error: 'userName is required' },
        { status: 400 }
      );
    }

    // Check if poll exists and is open
    const { data: poll, error: pollError } = await supabaseAdmin
      .from('polls')
      .select('is_open')
      .eq('id', pollId)
      .single();

    if (pollError || !poll) {
      return NextResponse.json(
        { error: 'Poll not found' },
        { status: 404 }
      );
    }

    if (!poll.is_open) {
      return NextResponse.json(
        { error: 'Poll is closed' },
        { status: 400 }
      );
    }

    // Verify option belongs to this poll
    const { data: option, error: optionError } = await supabaseAdmin
      .from('poll_options')
      .select('id')
      .eq('id', optionId)
      .eq('poll_id', pollId)
      .single();

    if (optionError || !option) {
      return NextResponse.json(
        { error: 'Invalid option for this poll' },
        { status: 400 }
      );
    }

    // Upsert vote (allows changing vote)
    const { error: voteError } = await supabaseAdmin
      .from('poll_votes')
      .upsert(
        {
          poll_id: pollId,
          option_id: optionId,
          user_id: userId,
          user_name: userName,
          voted_at: new Date().toISOString(),
        },
        {
          onConflict: 'poll_id,user_id',
        }
      );

    if (voteError) {
      console.error('Failed to record vote:', voteError);
      return NextResponse.json(
        { error: 'Failed to record vote' },
        { status: 500 }
      );
    }

    // Get updated vote count for this option
    const { data: votes, error: countError } = await supabaseAdmin
      .from('poll_votes')
      .select('option_id')
      .eq('poll_id', pollId);

    if (countError) {
      console.error('Failed to count votes:', countError);
    }

    const voteCount = votes?.filter((v) => v.option_id === optionId).length || 0;

    return NextResponse.json({
      success: true,
      vote_count: voteCount,
      total_votes: votes?.length || 0,
    });
  } catch (error) {
    console.error('Error recording vote:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
