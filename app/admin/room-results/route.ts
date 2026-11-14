import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Public handshake shell. Results and sign-in use the existing guarded APIs.
 * The bridge verifies the opener's exact loopback origin before fetching data. */
export async function GET() {
  return new NextResponse(`<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>2006 · Get room results</title>
    <link rel="stylesheet" href="/2006/results/room-sync.css">
    <script type="module" src="/2006/results/room-sync.mjs"></script>
    </head><body><main>
    <p class="eyebrow">2006 · ROOM PLAYER</p><h1>Get tonight’s results</h1>
    <p id="status" role="status" aria-live="polite">Connecting to your local player…</p>
    <form id="sign-in" hidden><label for="password">Operator password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in &amp; get results</button></form>
    <button id="retry" hidden>Try again</button>
    <p class="hint">Close trivia and cast voting in the game desk first. Only closed rounds from the active night are copied. Your projector stays on the local player.</p>
    </main></body></html>`, { headers: {
      'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'private, no-store',
      'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff',
    } });
}
