# AIM message recovery

AIM uses the signed-on viewer identity. A successful send returns an explicit
public message row so the sender sees it without waiting for a websocket echo.
HTTP history remains authoritative; realtime INSERT/UPDATE/DELETE events make
changes arrive sooner. Duplicate deliveries share a database ID and appear once.

When realtime is interrupted, visible clients refresh every 3 seconds. Healthy
connections still repair history every 30 seconds. Resume, page restoration,
network restoration and the retry button refresh immediately. Requests time out
after 12 seconds and are cancelled when the room/viewer lifecycle ends.

History is bounded to 100 chronological messages. Missing rows disappear from
authoritative snapshots, while events received during an in-flight fetch overlay
that snapshot. Deletion tombstones prevent a delayed echo from restoring a
moderated message. Reaction summaries survive raw realtime rows.

The status is Online only after both a successful HTTP fetch and a joined live
channel. Reconnecting means backup refresh is active. Offline means HTTP or the
browser network is unavailable. Failures preserve confirmed history and show a
retry control; no fake messages or development-only successful sends are added.

## Verification

- `npm run test:chat-message-state`: 18 pure reconciliation checks.
- `npm run test:chat-messages-hook`: 30 actual-source lifecycle/race checks.
- With `npm run preview:playout`, `npm run test:audience-sign-on` verifies real
  identity, send, reaction, throttle, blocked-session and outage routes locally.
- Browser rehearsal: accepted send, second-viewer backup delivery, real admin
  soft deletion of newest/all rows, preserved history during outage and automatic
  recovery, all without reloading the page or writing to the production chat.

No database migration or live show/queue change is required for this release.
