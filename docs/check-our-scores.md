# Let’s Check Our Scores

Segment 7 of MK’s run of show. A timed scene, queued like Rules of the Game: in `/admin`, **Add scene** → **Let’s Check Our Scores**, enter the length, and add it after video #2. Adding it never starts it.

While it plays, `/event`, `/stage` and the operator monitor show one scoreboard:

- **Superlatives:** live vote totals for every open or closed superlative in the current game show, top three per category, leader highlighted.
- **The countdown so far:** each countdown video that has started tonight (#5 first), then “#1 is still to come…”.
- **Essays:** tonight’s published essays. Guests can open each one; the stage lists screen names only so the room’s reader isn’t competing with the screen.

The board refreshes every 5 seconds while the scene is on.

## Privacy and timing

- `GET /api/scores` returns `available: false` and no totals until a Let’s Check Our Scores cue has started since the doors last opened. Starting the scene reveals live superlative totals to everyone, even for rounds whose results are hidden on the game desk.
- “Tonight” means since the doors last opened. Countdown entries come from the queue log, which records each cue’s countdown metadata from migration 030 onward; videos played before 030 was installed are not listed.
- Responses are CDN-cached for 5 seconds.

## Installation

`sql/030_check_our_scores.sql` (after 028) adds the scene and countdown logging. It replaces `queue_scene_cue` and `playout_advance_at` with copies of their 028 versions plus one change each. `npm run db:scores` is a read-only preflight; `npm run db:scores -- --apply` installs. Never replay 022 or 025–028 afterwards.

Tests: `npm run test:scores`, `npm run test:scores-db`.
