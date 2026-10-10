import { NextResponse } from 'next/server';
import { AUDIENCE_DOORS_HEADERS, readAudienceDoors } from '@/lib/audience-doors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json(await readAudienceDoors(), { headers: AUDIENCE_DOORS_HEADERS });
  } catch (error) {
    console.error('Audience doors read failed');
    return NextResponse.json({ error: 'Audience doors are temporarily unavailable. Please try again.' },
      { status: 503, headers: AUDIENCE_DOORS_HEADERS });
  }
}
