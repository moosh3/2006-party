# 2006 show game

Audience: `/event` (under the video) or `/game` (standalone).
Operator: `/admin/game`, using the existing admin login.

## Live database verification — September 12, 2026

Migration 021 has been applied to the configured Supabase project. All seven game tables and the scoring function passed verification. Public access to private tables and execution of private functions are blocked. A transactional smoke test under `service_role` verified locked trivia answers, correct scoring, private suggestion approval, vote replacement, and show closure. The transaction was rolled back; all game tables remain empty and the original stream/chat data is unchanged.

The application was deployed and promoted to production on September 12, 2026: deployment `dpl_FTUCLCmTJGuQJsCU3sqrzFer4iYo`. The production `/game`, `/admin/game`, and `/api/game` endpoints returned HTTP 200; `/api/admin/game` returned HTTP 401 without a session, as expected. The initial deployment error-log scan returned no entries. No live show has been created yet. Deployment used the local working tree; these changes have not been committed or pushed to GitHub.

The repeatable smoke test is `sql/verify_show_game.sql`. It refuses to run during an active show and rolls back all fixture records.

## Before the first deployment

1. Sign in with `npx supabase login`. Application service keys cannot create tables.
2. From this repository, run `npm run db:game:apply`. This applies **only** `sql/021_show_game.sql` to the project named by `.env.local`. It refuses to reapply when game tables already exist. It does not reset the database or seed a live show.
3. Run `npm run db:game:verify`. This reads table counts, checks public access is blocked, and exercises the read-only scoring function. It never submits votes.
4. Ensure the deployment has the existing `ADMIN_PASSWORD_HASH`, a `SESSION_SECRET` of at least 32 characters, and the Supabase URL, anonymous key, and service-role key. This checkout’s local environment did not contain admin credentials during implementation; the deployed environment may differ.
5. Deploy the application after the migration. Rehearse signing in and opening/closing a test question on the actual deployment before showtime.

The migration creates private game tables and functions and removes permissive public write policies on the original poll tables. Original polling routes still use the server service key; their reads/realtime remain intact. Pending suggestions, answer keys, and private results never enter the public realtime channel. The old instant-publication answer endpoint now returns 410 and directs viewers to moderated suggestions.

## Running a show

1. Create a show with a unique title/date. Only one show can be active. Earlier nights remain available in the admin show selector.
2. Save the cast roster, one name per line (2–30 people). Suggested names are taken from the existing AIM cast list; edit them to match tonight’s eligible cast. Creating the first superlative locks that night’s roster.
3. Prepare TRL polls and trivia questions with choices, and select each trivia question’s correct answer. All new rounds start as private drafts; edit or discard them before opening. Cast superlatives automatically use the saved roster. Each show supports up to 200 rounds.
4. Mark the decisive video round **Use for TRL Winner**. Earlier video rounds do not decide the final title.
5. Open a draft on cue. Opening trivia triggers a dismissible popup for participating viewers; the question also remains in the Trivia tab. Only one trivia question may be open. Submitted trivia answers lock immediately; TRL and cast votes can change until closing.
6. Close trivia to calculate scores. Reveal its answer afterward if desired. For TRL and superlatives, totals can be shown during voting or kept hidden. Changes reach viewers within roughly five seconds, and their own submissions refresh immediately.
7. Review the private suggestion inbox. Edit, approve as a draft, or reject. Approval never publishes immediately; open the resulting draft to start voting. Only cast choices are used. Viewers can submit at most ten suggestions per night, at least 30 seconds apart. Basic profanity and link filtering also applies to suggestions and new game names; human review is the primary protection.
8. End the show to close all open rounds, then reveal the final awards when ready. Ending a show is intentionally irreversible; start a new show for the next performance.

## Awards and ties

- **TRL Winner:** the leading video(s) in the designated final TRL round. Zero votes yields no winner. Ties display all joint winners.
- **Most 2006er:** one point for each closed superlative won. Every tied category winner gets one point. Zero-vote categories award none. Overall ties share the title.
- **SuperFan:** one point per correct answer on a closed trivia question. Ties share the title; there is no speed bonus. A night with no correct answers has no SuperFan.

The host can see scores throughout; public final scoreboards are hidden until the finished show is revealed. Individual viewers see their own score as questions close. Names may repeat; the database tracks distinct viewer IDs and the admin moderation control selects those IDs.

## Identity and moderation

A seven-day, HttpOnly browser cookie carries a random server-issued session token. The database stores only its hash. A viewer cannot choose another viewer’s ID in a voting request. Rejoining with the cookie preserves the same identity even if the AIM sign-on name changes. A different browser, cleared cookies, or an expired cookie creates a new identity; this is appropriate for a casual show, not verified-person prize eligibility.

Blocking a game viewer prevents new participation and excludes their existing game votes/scores. Use Restore viewer with the same viewer ID to undo a block and restore their votes. Renaming changes the name used for game results. This does not ban the viewer from the separate AIM chat. Existing chat moderation remains separate. Blocked votes are retained for review.

New show rounds use the game desk. Legacy polls remain readable/votable underneath when present, but their results are not included in the new show’s three awards. Create the final TRL round in the game desk to include it in the results.

## Verification and local rehearsal

`npm run test:game` applies the actual schema to isolated PostgreSQL (PGlite) and tests locked trivia, vote replacement, permissions, moderation, large vote counts, ties, and show isolation.

`npm run preview:game` starts a disposable local PostgreSQL-backed fixture and Next.js at `http://127.0.0.1:3106`. It uses a small test-only REST adapter, never the live database. Its admin password is printed to the terminal. Keep that process running, then run `npm run test:game-api` once to exercise real Next.js endpoints and leave an active rehearsal show for browser checks. Restart the fixture before repeating API tests. Stop it with Ctrl-C; fixture data is discarded.

`npm run lint`, `npx tsc --noEmit`, and `npm run build` verify the application. The fixture verifies application behavior but does not replace a smoke test against actual Supabase/PostgREST after migration.
