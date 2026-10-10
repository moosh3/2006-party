# Working on 2006

## Project purpose

2006 is a live performance by Artistic Accessibility Collective with a synchronized online audience experience. It began as a fork of `moosh3/after-party` and retains its playback, chat and polling foundations.

The main online experience is watching the shared program and voting in the TRL music-video competition. Trivia and cast superlatives provide participation between the main votes. The production operator needs clear, dependable controls while running a live show.

Read `PRODUCT.md` and `DESIGN.md` before design work. Preserve the AIM, Windows XP and 2006 Mac desktop character. Keep video central, controls readable, captions available, and keyboard/touch interactions usable. Do not turn the audience site into a generic dashboard or let games and decorative motion obstruct playback.

## Find the right checkout

The application repository is `2006-party`. On the current development machine it lives at `/Users/aleccunningham/Projects/github.com/moosh3/2006-party`. Some Codex chats start in the adjacent `2006` folder, which is only a workspace pointer, not the application. Check the working directory and Git status before editing or running commands. Do not initialize a replacement app in the pointer folder.

GitHub operations must target `moosh3/2006-party` explicitly (for example, `gh pr view 1 --repo moosh3/2006-party`). The `upstream` remote is `moosh3/after-party`; its PR numbers and history are different. Verify the repository before reporting PR state or merging.

Existing uncommitted and untracked files may contain substantial work from other chats. Preserve them, inspect the relevant changes, and do not reset or overwrite unrelated work.

## Two independent show systems

### Online website

- Next.js 14 App Router, React 18, TypeScript and Tailwind; Node.js 22 on Vercel. Use `package.json` and the lockfile for exact installed versions.
- Supabase PostgreSQL owns show state, queue, chat, polls, audience identity, doors and game results. Realtime notifications supplement polling.
- Mux is the primary video provider. Individual YouTube videos can be timed queue cues; YouTube playlists are ambient content.
- `/event`: online audience desktop, synchronized video, AIM chat and participation.
- `/stage`: online program display sharing the same authoritative feed. It requires the online services; it is not the offline player.
- `/admin`: media library, queue, playback, audience doors and legacy polls.
- `/admin/game`: trivia, TRL rounds, cast superlatives, suggestion moderation and results.
- `/game`: standalone audience game, subject to audience admission.
- `/login`: screen-name sign-on; `/admin/login`: separate operator authentication.
- `/schedule`: working rundown from `lib/run-of-show.ts`; not proof that production schedule timings are approved.

### Independent offline room player

`tools/room-player/` is a separate, loopback-only Node application. Run `npm run room`, then use the printed local URL (default `http://127.0.0.1:2007`). It uses original local videos/images/audio and a separate audience window, with manual GO, optional auto-follow, hold, blackout and a soundboard.

It must remain independent of Supabase, Mux, the website's queue, cloud credentials and internet access. Selecting a cue must not start it. Runtime playback is not automatically resumed after restart. Local settings live in `.room-player/`; settings and the room-player tool are excluded from website deployment. See `docs/offline-room-player.md` for operation and physical rehearsal requirements.

## Playback terminology and invariants

- The operator-facing modes are **Queue** and **Schedule**. The stored/API value for Queue remains `manual`; do not rename this protocol value just to change a label.
- Queue mode and auto-advance are separate settings. Queue works with auto-advance on or off. Display the actual Playing, Paused or Holding status, and explain what triggers the next transition.
- Schedule uses the configured showtime YAML. The checked-in schedule originated as an upstream fixture; do not activate it without confirming the show's approved dates, timezone, timings and media.
- PostgreSQL owns the online clock, playback session ID and revision. Preserve command IDs, expected-session guards, transactional queue operations and rejection of stale snapshots.
- Viewer media-ended events are refresh hints, not authority to skip or advance cues. Keep periodic snapshot recovery working when realtime disconnects.
- Queued media needs a finite, exact positive duration, including fractional seconds. Do not guess durations, enqueue live feeds or treat a YouTube playlist as a synchronized finite cue.
- Pause preserves position; hold preserves resumable program state. Queue exhaustion uses the configured hold or branded waiting screen. Preserve these behaviors when changing controls.
- Selecting/reordering cues never starts playback. Keep selected IDs stable through refreshes, preserve group order, and invalidate undo when the authoritative queue changes.
- Audience doors control admission, independently of playback. Opening doors does not start a cue. Deployment must not reset doors, votes, scores, library or queue.
- Audience screen names are lightweight cookie-backed identities, not unique accounts. Doors are a presentation gate, not ticket authorization or media DRM.

## Code map

| Concern | Start here |
| --- | --- |
| Operator queue and playback | `components/admin/QueueManager.tsx`, `PlaybackControls.tsx`, `StreamControl.tsx`, `app/admin/page.tsx` |
| Program snapshots and recovery | `app/api/current/route.ts`, `lib/program-stream.ts`, `hooks/useProgramStream.ts`, `lib/playback-sync.ts` |
| Video renderers | `components/VideoPlayer.tsx`, `components/YouTubeVideoPlayer.tsx` |
| Schedule and working rundown | `lib/showtime.ts`, `showtime.yaml`, `lib/run-of-show.ts` |
| Privileged playback mutations | `app/api/admin/`, `sql/022_playout_hardening.sql`, `sql/023_playout_clock.sql`, `sql/025_youtube_video_queue.sql` |
| Audience shell, art and chat | `components/2006/`, `components/Chat.tsx`, `hooks/useChatMessages.ts`, `lib/chat-message-state.ts` |
| Admission and identity | `lib/audience-*.ts`, `hooks/useAudienceDoors.ts`, `app/api/audience/`, `sql/024_audience_doors.sql` |
| Games and awards | `components/game/`, `lib/game-server.ts`, `lib/game-types.ts`, `app/api/game/`, `app/api/admin/game/`, `sql/021_show_game.sql` |
| Offline room | `tools/room-player/server.mjs`, `state.mjs`, `app.mjs`, `output.mjs` |

## Development and verification

Normal development: `npm install`, then `npm run dev`. A normal checkout may have real service credentials in `.env.local`; localhost alone does not mean the backend is disposable. Never print or commit secrets, cookies, tokens or local environment files.

For browser/API rehearsal use `npm run preview:playout`. It starts a disposable in-memory PostgreSQL fixture and a real Next server at port 3116, with test credentials printed by the script. It does not load production credentials. Game rehearsal uses `npm run preview:game` at port 3106. Read the fixture and relevant guide before tests that mutate its state; run shared-fixture API tests serially. Stop only processes you started. Do not run dev and production builds concurrently against the same `.next` output.

Run checks appropriate to the change:

- General application: `npm run lint`, `npx tsc --noEmit --incremental false`, `npm run build`.
- Queue UX: `node --import tsx scripts/test-queue-interactions.ts`.
- Operator reliability: `node --import tsx scripts/test-admin-playback-stability.ts`.
- Playback: `npm run test:playout-db`, `npm run test:playback-sync`, `npm run test:mux-seek-recovery`, `npm run test:youtube-player`.
- Queue media/library: `npm run test:youtube-admin`, `npm run test:youtube-queue-db`.
- Games: `npm run test:game`; game API checks require their local fixture.
- Admission: `npm run test:audience-access`, `npm run test:audience-doors-hook`, `npm run test:audience-doors-db`.
- Chat: `npm run test:chat-message-state`, `npm run test:chat-messages-hook`.
- Offline player: `npm run test:room`; actual display placement, codecs, speakers and fullscreen still need rehearsal on the show laptop.

Inspect scripts before running database setup, seed, migration, import or provider integration commands. Do not use production playback, votes or chat as test fixtures. `db:*` commands differ: some are read-only preflights until `--apply`, others can write. Follow the relevant script and guide rather than assuming all are safe reads.

## Deployment

The website deploys to Vercel project `2006-party` in `moosh3s-projects`. Production aliases include `https://2006theyeartheshow.live` and `https://2006-party.vercel.app`. Confirm the current target with `.vercel/project.json` and Vercel before release; do not copy credentials into documentation.

When deployment is requested, validate the intended working-tree changes and build, then deploy the authorized scope. A local Vercel CLI upload includes uncommitted source; report that accurately rather than presenting the base Git commit as the complete release. Respect `.vercelignore`, especially local media/settings exclusions. Check database compatibility before releasing code that requires a migration; do not blindly replay historical seeds or migrations.

Verify READY status, production aliases, basic HTTP health and the changed behavior/assets after deployment. Distinguish local verification from production verification. A short error-log check is not continuous monitoring. Documentation-only edits do not require a website deployment.

## Further context

- `docs/playout-hardening.md`: playback guarantees, migration sequence and rehearsal evidence. Historical references to Manual mean the current Queue mode.
- `docs/youtube-queue.md`: finite YouTube cues, duration and caption limitations.
- `docs/show-access.md`: audience identity, doors and access boundaries.
- `docs/show-game.md`: scoring, moderation, TRL and end-of-show results.
- `docs/aim-chat.md`, `docs/show-cues.md`, `docs/show-interactions.md`: audience interactions.
- `docs/offline-room-player.md`: independent room setup, operation and soundboard.
- `public/2006/SHOW-ART.md`: show-art provenance; preserve original media and reduced-motion behavior.

Treat dated verification notes as historical evidence, not the current live state. Check the code, configuration and service state when those details matter.
