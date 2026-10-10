import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { extractYouTubeVideoId } from '@/lib/youtube';
import { fetchYouTubeVideoMetadata, hasYouTubeApiCredentials, YouTubeVideoValidationError } from '@/lib/youtube-video';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

/** Read-only preflight. Never creates a media item or changes the show. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  }
  const input = request.nextUrl.searchParams.get('url');
  if (!input || input.length > 2048) {
    return NextResponse.json({ error: 'A YouTube video URL is required' }, { status: 400, headers: NO_STORE });
  }
  let videoId: string;
  try { videoId = extractYouTubeVideoId(input); } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid YouTube video URL' }, { status: 400, headers: NO_STORE });
  }
  if (!hasYouTubeApiCredentials()) {
    return NextResponse.json({ videoId, title: null, durationSeconds: null, captionsAvailable: null,
      metadataVerified: false, warning: 'YouTube API verification is not configured. Enter the exact full duration and verify captions and embed playback before the show.' }, { headers: NO_STORE });
  }
  try {
    const metadata = await fetchYouTubeVideoMetadata(videoId);
    return NextResponse.json({ ...metadata, metadataVerified: true,
      warning: metadata.warnings.length ? metadata.warnings.join(' ') : null }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof YouTubeVideoValidationError) {
      return NextResponse.json({ error: error.message, videoId }, { status: 400, headers: NO_STORE });
    }
    console.warn('YouTube metadata preflight unavailable; operator verification required.');
    return NextResponse.json({ videoId, title: null, durationSeconds: null, captionsAvailable: null,
      metadataVerified: false, warning: 'YouTube metadata verification is temporarily unavailable. Enter the exact full duration and verify captions and embed playback before the show.' }, { headers: NO_STORE });
  }
}
