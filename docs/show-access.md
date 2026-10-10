# Mac audience sign-on and doors

## Running the show

1. Share `/` or `/login`. New viewers choose a screen name (2–20 characters, no password) in an old Mac-style login.
2. Signed-in viewers wait on `/event` until an administrator opens the doors. They can leave the page open; entry happens automatically, usually within three seconds.
3. In `/admin`, use **Audience doors → Open doors**. This admits viewers; it does not start, pause, advance, or restart the program. Cue playback separately using the existing controls.
4. **Close doors** asks for confirmation because it returns current audience viewers to the waiting screen. Playback and scores continue to exist unchanged. Reopening requests a fresh current feed, not the clip remembered before closure.
5. Close the doors explicitly before the next event. Door state persists; it does not automatically reset after a show or deployment.

## Identity and limits

- The login name becomes the AIM chat name and game scoreboard name. This is a themed screen name, not an actual AOL account or password-based authentication.
- The existing seven-day, HTTP-only game session is the source of truth. Returning viewers retain the original identity, scores, votes, and moderation even if they type a replacement name. Back to login / sign-off does not reset that cookie.
- Existing cookie-backed game participants are recognized on direct `/event` visits. A legacy browser label alone is not admission: choose/confirm the name at login once. Same-name private essay drafts migrate to the canonical identity without deleting or overwriting drafts.
- Screen names are display labels, not globally unique reservations. Clearing cookies or using another browser creates a new participant; there is no cross-device account recovery in this lightweight flow.
- Blocking a participant disables messages, reactions, and game participation. The desktop checks identity again on resume and every 30 seconds while visible; write routes enforce the current cookie identity immediately.
- Waiting viewers mount no video, chat, presence, or voting board. Both `/event` and standalone `/game` follow the doors. Admin and stage views remain independent.
- The doors are an audience presentation gate, **not ticket authorization or video DRM**. Public video URLs and existing public read APIs are not made private by this feature.

## Reliability

The singleton `audience_doors` starts closed on first installation and preserves state when the migration is reapplied. Only the server service role can read or change it in the database. Admin mutations require an authenticated session and same-origin request, use an explicit desired state, compare revisions atomically, and audit each actual change. Competing/stale commands fail safely rather than toggling twice.

Public status is uncached. First entry fails closed if identity or door status is unavailable. After a confirmed admission, a transient connection problem retains the last confirmed state rather than kicking viewers out mid-video. Polling and resume checks reconnect. A later confirmed close still takes effect. No client check is a new playback clock.

Admin reads time out after eight seconds, changes after ten. A timeout may have an uncertain outcome: use **Refresh doors** to confirm; never blindly repeat a toggle.

## Verification and installation

- `npm run test:audience-access`: pure contracts, monotonic door responses, isolated browser-storage fallbacks, and private essay preservation.
- `npm run test:audience-doors-hook`: actual hook lifecycle, stale/aborted replies, disable/restore, timeouts, resume events, and StrictMode cleanup in an isolated deterministic harness.
- `npm run test:audience-doors-db`: isolated SQL/CAS/audit/RLS regressions.
- `npm run preview:playout`: local Next + in-memory PostgreSQL rehearsal, explicitly excluding `.env.local` and live credentials.
- Run `npm run test:audience-doors-api` and `npm run test:audience-sign-on` **serially** against that fixture. These deliberately simulate outages and alter only its temporary database.
- `npm run db:audience-doors` is a read-only schema preflight. Add `-- --apply` only to install the reviewed admission migration on the configured hosted Supabase project. It uses the CLI's existing login and a transaction that proves current playback, queue, viewers, and votes were not changed. No credentials or viewer rows are printed.

Implementation follows the existing Next 14 dynamic/no-cache routes and Supabase service-role boundary; see [Next Route Handler caching](https://nextjs.org/docs/14/app/building-your-application/routing/route-handlers#opting-out-of-caching) and [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
