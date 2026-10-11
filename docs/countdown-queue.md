# TRL countdown in the online queue

In `/admin`, choose **Add countdown cue**, select the position and library video, and set the highlight start in seconds. Defaults: #5 = 15 seconds, #4 = 30, #3 = 45, #2 = 60, #1 = the entire original video from zero. #4–#2 lengths are editable. Source duration must be exact and the excerpt must fit inside it. Library durations are never shortened.

Add custom show videos through the existing library queue controls; they still play in full. Select and move countdown cues just like ordinary cues. Moving preserves rank, video, timing and artwork. **Edit** changes an upcoming slot's song/highlight/banner without affecting the active cue. Choose another rank explicitly to change its number. The banner is cleared on a rank change because the number is baked into the artwork. Queue position is the running order, not the countdown rank.

Paste a direct HTTPS MP4/WebM or image URL for the matching numbered footer; `/2006/` asset paths also work. Footer videos loop silently. With no file, or if loading fails, a simple rank appears. Use **Fullscreen with banner** to keep the composition together; a browser that only supports native video fullscreen cannot include an HTML overlay. Banner animation pauses with the program and honors reduced-motion preferences; it is decorative and is not frame-synchronized across viewers. Alpha-video codec compatibility, captions and the actual footer's placement need rehearsal with the real files in the show browsers. No production banner files were supplied during implementation.

**Play Next** starts the next cue. Auto-advance moves to the next cue at the excerpt end. With auto-advance off, the excerpt pauses at its out point. **Restart** restarts at the chosen highlight; #1 restarts at zero. Pauses/holds preserve progress. New arrivals use the shared source position. Clients enforce the excerpt endpoint even if the server becomes unreachable, with the existing periodic media correction tolerance. They never advance the queue themselves.

## Installation and verification

Requires `sql/026_countdown_queue.sql` after 025. Install the database migration before deploying this application version. It adds nullable cue metadata and replaces queue/playback functions; it does not seed media, alter running playback, reorder the queue, change audience doors or deploy anything. Do not rerun older playback migrations after 026 because they replace these functions.

`npm run db:countdown` performs a read-only preflight against the existing 2006 Supabase project. `npm run db:countdown -- --apply` is the explicit install action. The installer locks and compares show/audience state in one transaction and rolls back if existing values change. Missing countdown columns are normalized to null in that comparison, while existing countdown values are preserved and checked on repeat installs.

Run `npm run test:countdown-db`, `npm run test:playback-sync`, `npm run test:mux-seek-recovery`, `npm run test:youtube-player`, and the queue interaction checks. `npm run preview:playout` installs all required migrations into disposable PostgreSQL and serves the app at port 3116. Run `npm run test:countdown-api` only against that fixture; it changes its rehearsal queue.

This is the online shared queue. The independent offline room player is unchanged.
