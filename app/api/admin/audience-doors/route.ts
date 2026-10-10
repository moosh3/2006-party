import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  AUDIENCE_DOORS_HEADERS, AudienceDoorsError, readAudienceDoors, setAudienceDoors,
} from '@/lib/audience-doors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: AUDIENCE_DOORS_HEADERS });
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  if (!origin) return true;
  try {
    // Match the request Host, including loopback/custom hosts normalized by Next.
    return new URL(origin).origin === `${request.nextUrl.protocol}//${request.headers.get('host')}`;
  } catch {
    return false;
  }
}

function failure(error: unknown) {
  if (error instanceof AudienceDoorsError) return json({ error: error.message }, error.status);
  console.error('Admin audience doors request failed');
  return json({ error: 'Audience doors are temporarily unavailable. Please try again.' }, 503);
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'admin') return json({ error: 'Unauthorized' }, 401);
  try {
    return json(await readAudienceDoors());
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') return json({ error: 'Unauthorized' }, 401);
  if (!sameOrigin(request)) return json({ error: 'Invalid request origin' }, 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'A valid JSON body is required' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Use doorsOpen and expectedRevision' }, 400);
  }
  const { doorsOpen, expectedRevision } = body as Record<string, unknown>;
  if (typeof doorsOpen !== 'boolean' || typeof expectedRevision !== 'number'
    || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0
    || Object.keys(body).some((key) => !['doorsOpen', 'expectedRevision'].includes(key))) {
    return json({ error: 'Use a boolean doorsOpen and a nonnegative integer expectedRevision' }, 400);
  }
  try {
    return json(await setAudienceDoors(doorsOpen, expectedRevision, session.userId));
  } catch (error) {
    return failure(error);
  }
}
