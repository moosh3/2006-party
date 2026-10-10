# Audience cue foundation

## Production state

`lib/audience-cue-config.ts` is disabled with an empty show ID and cue list in production. It adds no cue timers, listeners or browser storage access while disabled. Existing Clippy and trivia reminder behavior is preserved; an armed cue sheet suppresses those older automatic reminders so they cannot compete with timed invitations.

`lib/show-media.ts` contains public metadata for the five supplied Mux videos. All five ready assets were verified with the after-party server credentials and imported into the 2006 media library on October 9. Exact API durations, not rounded dashboard times, are stored. All five public streaming manifests returned HTTP 200. No secrets were copied, no Mux assets were edited, and the current feed and queue were unchanged. The captioned titles refer to the supplied videos; no separate selectable caption tracks were added.

## Cue contract

- Configure a unique ID for the actual show run, explicit enabled cues, exact media playback ID (or scheduled asset/slot IDs), and finite start/end offsets in seconds. Window start is inclusive, end exclusive. Multiple selectors must all match; titles do not match cues.
- Version one supports Mux VOD only. Holds, live sources, YouTube, placeholder media, invalid IDs/windows and snapshots older than ten seconds fail closed. The hook observes the existing authoritative stream using its monotonic position, never native browser `ended`, wall-clock time, or another subscription.
- Actions: `poll` with an exact existing prompt ID/kind; `essay` with optional prompt index; `feedback` with a safe HTTPS or relative form URL; `commercial` layout state; `awards` results invitation.
- Invitations default to once per show/cue, surviving reload, seeks, restart and hold/resume. Use `repeat: 'occurrence'` only if a repeat is intended. `lateJoin: 'skip'` suppresses a missed notification; current task availability remains separate. No backlog of expired cues is replayed.
- Consumption and dismissal persist separately in a bounded, viewer/show-scoped local ledger. Blocked storage falls back to memory. Dismissing an invitation does not close a poll, discard a draft, or remove the underlying assignment. Storage fallback cannot preserve dismissal across a full reload.
- Poll category changes and navigation happen only after a click, and only when the exact prompt is open in the existing game state. Cues never open/close global polls, answer a question, submit feedback, alter scores, start media, or advance the queue. Game administration remains authoritative.
- Essay cue entry may invite through desktop Clippy, but never opens Mail/editor or replaces a draft. Phones use the inline invitation. Feedback opens a validated link only after a click. Awards do not bypass the host’s existing result-reveal controls.
- The video player remains keyed only by playback session. A commercial state is exposed as `data-audience-layout`; actual reflow and video-adjacent answering are follow-up layout work, not implemented by this foundation.

## Safe rehearsal

Run `npm run preview:audience-cues` from the repo, then visit `http://127.0.0.1:3116/event`. The fixture uses a fresh embedded PostgreSQL database, dummy credentials and an official public Mux example. It skips `.env.local`, starts paused at 41 seconds, and seeds one test-only superlative.

Synthetic windows: essay 40–60s, commercial + superlative 80–100s, feedback 120–140s, awards 160–180s. These offsets are not the show’s actual timings. The test fixture clock can be changed through its loopback/key-protected query endpoint. Production refuses these rehearsal cues even if the rehearsal environment flag is accidentally set.

Tests: `test:audience-cues`, `test:audience-cue-delivery`, `test:audience-cue-hook`, `test:audience-cue-config`, plus existing playback and sprite regressions. Browser verification covers the passive invitation, explicit correct-category navigation, no modal/focus/scroll on cue entry, persistent dismissal, mobile touch targets and one player.

## Inputs needed to activate

The real rundown/order, exact video offsets for each interaction (especially within the combined Clippy clip), corresponding game prompt IDs and open/close plan, the actual feedback URL/questions, and approved sound clips. Manual production cue/clear controls, layout reflow, soundboard, drag/slime and animated awards remain future work. Do not enable a guessed or synthetic cue sheet for a show.

## Media import

`npm run media:import -- --mux-env /absolute/path/to/after-party/.env.local` verifies and plans missing additions. Add `--apply` to insert only missing library rows. The script uses the current repo’s server-side database credentials, preserves existing labels, handles simultaneous duplicate insertion, and never queues/starts a video. Credential values are neither printed nor placed in the public metadata registry.
