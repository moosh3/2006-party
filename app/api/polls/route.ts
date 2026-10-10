import { NextRequest, NextResponse } from 'next/server';
import { getAllPolls } from '@/lib/polls';
import { gameViewer } from '@/lib/game-server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const room = searchParams.get('room') || 'event';
    const userId = (await gameViewer())?.id;

    const polls = await getAllPolls(room, userId);

    return NextResponse.json({ polls });
  } catch (error) {
    console.error('Error fetching polls:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
