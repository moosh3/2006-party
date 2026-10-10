import { NextResponse } from 'next/server';

export async function POST() {
  // The old route published viewer text immediately. All audience suggestions
  // now belong in the private, moderated game inbox.
  return NextResponse.json({ error: 'Submit suggestions in the Superlatives tab for host approval.' }, { status: 410 });
}
