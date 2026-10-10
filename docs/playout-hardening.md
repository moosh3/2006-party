# Reliable show playout

## Running a show

1. In the operator console, use **Manual** cue mode for the video queue.
2. Add each video to the library as a Mux VOD or an individual YouTube video. The corresponding provider API fetches its duration when configured; otherwise enter the exact positive duration in seconds (fractions supported). For YouTube, use **Check Video** first to check caption/embedding availability, then **Add**. Live feeds and YouTube playlists are not finite, synchronized queue cues. See [YouTube queue guide](youtube-queue.md) for caption and advertising limitations.
3. Select an optional looping hold video. Without one, queue exhaustion displays the branded waiting screen.
4. Arrange the queue, turn **Auto-advance** on, then press **Next** to start the first cue. If a video is already playing, enabling automation follows its existing clock; it does not restart it.
5. Keep an eye on the automation status and next transition shown beside the queue. Missing/invalid media duration blocks automation with an actionable error, preserving the queued item.

Pause freezes the shared position. Play resumes it. Hold saves the live position and returns to that position when disabled. Restart deliberately creates a fresh playback occurrence. Next remains a deliberate operator override; retrying a failed Next request reuses its command ID so it cannot consume two cues.

Switching to Schedule freezes the manual cue. Returning to Manual leaves that cue paused so it cannot unexpectedly restart or jump ahead. Scheduled show times and optional exact `durationSeconds` come from the configured showtime YAML; verify those dates and assets before choosing Schedule. The queue is a Manual-mode feature.

## What keeps viewers aligned

- PostgreSQL owns the cue clock, duration, playback occurrence ID, and revision. Browser-ended notifications are hints, never permission to advance early.
- A Supabase database job checks the manual queue every two seconds, including when no viewer or operator page is open. `/api/current` also reconciles overdue transitions. Late checks retain the original due times and catch up through already elapsed cues rather than starting each missed clip from zero.
- Queue changes and playback commands share transactional locks. Unique command IDs make retries idempotent; session guards reject stale operator commands. Public clients cannot write the timeline or invoke privileged queue functions.
- Audience, stage, and operator previews read uncached snapshots every three seconds. Realtime is a faster hint, not a dependency. Older revisions are ignored, metadata-ready seeks are retried, and the player continuously corrects drift using the sampled server clock and a monotonic local timer.
- A late viewer seeks to the current point before autoplay. Browser rules may require **Join** or **Tap to unmute**; audio cannot be forced on without a viewer gesture. Slow networks and buffering mean this is practical synchronization, not a frame-perfect broadcast guarantee.
- YouTube playlists remain ambient hold content: YouTube does not expose the server-authoritative playlist manifest/durations used by this queue. Use a Mux VOD hold if loop position must be shared precisely.

## Deployment and monitoring

Apply `sql/022_playout_hardening.sql`, then `sql/023_playout_clock.sql` to the linked Supabase database before promoting the matching application build. Both files are transactional and repeatable. The migrations preserve the current waiting state, queue, library, and automation setting.

Individual YouTube support additionally requires `sql/025_youtube_video_queue.sql`. `npm run db:youtube-video` performs a read-only preflight; `npm run db:youtube-video -- --apply` runs the migration inside a state-preservation guard against the existing configured project. It does not import a video, start playback, alter admission or change votes.

Check `cron.job` for active `2006-playout-clock` and `2006-playout-clock-history` jobs, and `cron.job_run_details` for recent successful tick runs. The history job retains three days of these two jobs only; it does not change other cron jobs or instance-wide logging. A paused cue, Schedule mode, or hold disables queue advancement. Database unavailability produces HTTP 503 rather than a fresh fallback video; clients keep their last good snapshot and reconnect.

Do not run the historical live-database sync mutation script against production as a test. These regressions are isolated:

```sh
npm run test:playout-db
npm run test:playback-sync
npm run test:mux-seek-recovery
node --import tsx scripts/test-playback-tokens.ts
node --import tsx scripts/test-showtime.ts
npm run preview:playout
# In a second terminal, with the local fixture running:
npm run test:playout-api
```

The local fixture uses real PostgreSQL and a real Next server with test-only credentials, never `.env.local`. Its default browser rehearsal uses Mux's public documentation sample. The October 9 rehearsal below also covers two actual, public-policy event assets. Signed-policy event media still needs a separate rehearsal if introduced.

Application rollback should retain the hardened service-only database permissions. Disabling the `2006-playout-clock` job stops the unattended ticker; disabling Auto-advance also prevents snapshot-driven queue transitions. Do not restore the old public-write policies as a rollback shortcut.

## Verification on October 8, 2026

- Database, API, 21 player synchronization checks, schedule tests, lint, type checking, and the production build passed. API checks included 16 concurrent ended notifications consuming exactly one cue, duplicate/stale operator commands, catalog-deletion races, reorder/removal, unknown durations, holds, and an unavailable database returning 503.
- Real browser rehearsal used two independently opened viewers of the full 249.86667-second official Mux sample. The late viewer started around 156 seconds, not zero. Both native videos were observed within 0.004 seconds of each other. Both paused at exactly 209.396 seconds, resumed within 0.02 seconds, and automatically changed to the branded waiting screen at queue exhaustion. Polling kept this working despite the fixture intentionally lacking a realtime WebSocket server. These are rehearsal measurements, not promised tolerances on every network.
- Generated ephemeral-key tests verified identical signed URLs in a separate cold process, Mux's required `aud: v`, actual expiry, safe bucket renewal, long-video expiry, public-policy unsigned playback, and cached/deduplicated policy lookup. No real signed event asset was added or played.
- Live migrations retained the paused Manual waiting screen with automation off, zero library items, and zero queue items. Both application cron jobs were active; recent clock runs succeeded roughly two seconds apart. Public write/advance permissions were denied, and service-role access remained available.
- Deployment `dpl_H4PdjywbdDizouBK8rCbsa4cxru9` reached READY and was promoted to `https://2006-party.vercel.app`. The public current API returned HTTP 200 with `Cache-Control: no-store`, server clock, session identity, and disabled automation; protected controls returned 401. Viewer/operator pages returned 200 and the stage browser rendered the retained Manual waiting state. The bounded ten-minute release error-log query returned no error entries. This project has no configured log drains, so no continuous external logging/alerting coverage is claimed.

## Live event-media rehearsal on October 9, 2026

- The library now contains five ready, public-policy Mux event videos with exact positive durations. All five HLS manifests returned HTTP 200. No signed-policy event asset was exercised.
- With explicit user authorization, queued xanga followed by Clippy, enabled Auto-advance, and started the first cue once from the operator console. No later Next, Hold, Play or Pause command was sent.
- xanga started at 4:19:40.515431 PM Chicago. The server advanced naturally to Clippy at 4:22:07.243522 PM, retaining the original due-time anchor of 4:22:07.098764 PM. Queue exhaustion returned to the branded waiting screen at 4:24:39.779988 PM, retaining the 4:24:39.765431 PM anchor. Both transitions were audited as `system:clock`; this does not distinguish the database ticker from snapshot reconciliation.
- The existing audience page switched from waiting to xanga automatically. A fresh audience tab joined around 83 seconds, rather than zero; the other independently opened player was within approximately 0.02 seconds at that sample. Reloading joined around 114.5 seconds. Both then switched to Clippy without interaction. A separate in-app stage browser joined Clippy around 76.4 seconds. Native video elements were playing with ready state 4 and no media error at the checked samples.
- Muted autoplay worked; clicking Tap to unmute enabled audio on the checked audience player. All three checked views returned automatically to waiting. This is browser rehearsal evidence, not a frame-perfect or all-device guarantee, and does not certify the remaining three videos or the complete rundown.
- Left audience doors OPEN, Manual mode, Auto-advance ON, hold/waiting active and queue empty. No production game participation or chat was submitted. Recent clock runs succeeded; the bounded ten-minute application error scan returned no entries. The project had zero configured log drains at inspection; continuous monitoring is not claimed.
- Browser proofs: `/private/tmp/2006-live-playback-rehearsal.png`, `/private/tmp/2006-clippy-autoplay-live.png`, `/private/tmp/2006-live-rehearsal-complete.png`.

Rehearse the complete running order, audio and caption presentation before show day. Repeat a signed-policy rehearsal if those assets are added.

## Local mobile recovery investigation on October 9, 2026

- Reproduced a guest-only seek feedback loop in the actual component and synchronization helper source: every completed seek was treated as viewer interference and forced another correction whenever its latency exceeded the 150 ms forced-sync tolerance. Slow seeks could therefore chase the moving show clock without settling.
- Guest seek completion now uses the existing non-forced synchronization listener. Large drift and explicit server changes still correct playback; operator seek controls are unchanged. `test:mux-seek-recovery` exercises the component with deterministic media events and reconstructs the previous handler in memory to prove that the regression detects the old loop.
- All eight actual-component seek regressions, all 21 playback-clock checks, lint, and type checking passed locally. In the 300 ms seek model, the previous binding produced 11 seeks and zero uninterrupted playback over three seconds; the fixed binding produced one seek and 2.7 seconds of playback.
- The original `after-party` player enabled guest autoplay and attempted startup after 1.5 seconds even before metadata or during a seek. This fork instead waits for metadata and seek completion before attempting playback. That is a confirmed behavioral difference, not proof of the reported iPhone's media state.
- An isolated in-app-browser sign-on with an open trivia question reproduced the immediate native dialog. The public Mux sample continued playing while it was open and after dismissal (observed media times approximately 66.7 and 96.5 seconds, both unpaused with ready state 4). The modal blocks the rest of the page's controls while open, but this desktop/MSE rehearsal does not certify iPhone/native-HLS behavior or prove that trivia causes the phone's freeze. Proof: `/private/tmp/2006-mobile-local-popup-check.png`.
- These tests do not certify native iPhone playback. The frozen-phone startup cause remains unconfirmed; the local seek-loop fix alone does not justify a live deployment under the confirmed-cause-only restriction. No production queue, admission, or playback state was changed during this investigation.

### Local Reconnect recovery follow-up

- The affected viewer reported that the video stayed frozen after dismissing trivia. This rules out the dialog merely blocking the controls; it does not establish native media readiness or the initial freeze's cause.
- Confirmed that the audience's Reconnect and Safari Reload buttons only fetched a fresh cue snapshot and retained the same media instance. They now invoke the active player's local recovery handler synchronously, then refresh the cue. The original tap's playback permission is not deferred behind a network request.
- Mux recovery projects the authoritative position when metadata is available and no seek is already in progress. Unavailable metadata, an unresolved seek, or a native seek exception no longer prevent the explicit tap from requesting playback. A playing cue retains a visible Join control from startup; failed, pending, or aborted play attempts cannot silently remove that route back in. Guest automatic playback remains gated by synchronization.
- Recovery respects the current server pause. Delayed play completion and muted fallback re-check the latest anchor, so a pending request cannot restart a newly paused cue. This is a local media operation: it sends no operator playback commands and does not advance the queue.
- Individual YouTube recovery reuses its synchronized tap-to-join path, retains captions, and retries failed embeds. Legacy playlists reuse their existing local unmute/play path; they remain unsynchronized ambient content.
- An isolated full audience sign-on and Safari Reload rehearsal used the public Mux documentation sample. Media time advanced from approximately 97.06 to 97.69 seconds across the first recovery tap and was still playing at approximately 193.62 seconds after the final handler update (ready state 4, unpaused). This desktop/MSE rehearsal does not certify native iPhone behavior. Proof: `/private/tmp/2006-local-reconnect-proof.png`.
- The test fixture, sample viewer, and browser tab were discarded after rehearsal. The user's live stage remained open; no production state was changed or release promoted.
- Local verification passed 19 actual-component Mux recovery scenarios, 25 YouTube player scenarios, all 21 shared-clock checks, and TypeScript checking. The production build also completed successfully. The Mux scenarios include deferred first-play and muted-fallback promises resolving/rejecting after a host pause, unmount cleanup, and a failing provider callback still allowing a cue refresh.

The existing dependency audit is a separate unresolved maintenance issue: the production dependency tree reports seven vulnerable packages, including critical advisories in the installed Next.js 14.2.33. The audit's complete recommended Next.js fix is a major-version upgrade. These playback changes do not resolve those advisories or constitute a general security audit; plan and verify a framework/dependency upgrade separately.
