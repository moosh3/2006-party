# Invitations alongside the online show

In `/admin/game`, the default **Show time** view has an **On screen** area:

- **Jen: voting closed** after music-video voting closes on the other website. Jen simply says “Voting is closed.” Guests can dismiss it with Keep watching; there is no game invitation or voting button. This announces closure; it does not control the other website.
- **Clippy: study break** during the Clippy video. Viewers can open their essay without interrupting the player.
- **Essays: last call** before Let’s Check Our Scores. This reminds unfinished writers that Save Draft keeps a local copy; Submit essay publishes it under their screen name.
- **Clear message** before the next video. Invitations stay available until cleared/replaced or the show ends. Resend lets a previously dismissed invitation appear again.

Changes reach viewers through the existing game refresh, normally within five seconds. These controls do not change playback, audience doors, votes or scores. People We Know remains a video and has no added interactive scene.

Each guest can choose **Keep watching**. Dismissal survives reloads for that viewer and show. Invitations never move keyboard focus, and essay reminders stay hidden while TextEdit is open or an essay is already submitted. Timed scenes and stream errors take precedence. Paused/reduced-motion settings still apply to Clippy; sprite catchphrases remain available on click. The six-step Rules of the Game tour can still be replayed.

The channel uses the existing private `admin_actions` table, scoped by show ID. Only invitation ID, show ID, kind and actual TRL state reach audience clients. No new migration is required. Starting a new night does not inherit the previous night's invitation.

Verification: `node --import tsx scripts/test-show-invitations.ts`; `npm run test:game-api` against `npm run preview:game` only. Use the disposable playout fixture for audience browser rehearsal.
