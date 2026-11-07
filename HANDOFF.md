# Handoff: MK’s website improvements

Updated November 7, 2026. This document covers the work requested in this chat, its implementation, and the remaining work. It is a handoff snapshot, not proof of the current production deployment or database state.

## Current state

| Request | Tracking | Implementation status |
| --- | --- | --- |
| “Rules Of Life” with interactive cast avatars, catchphrases, profiles, and a polls/superlatives introduction | [Issue #2](https://github.com/moosh3/2006-party/issues/2) | Tracked and scoped; not implemented |
| “And now time for video #N” before videos | [Issue #3](https://github.com/moosh3/2006-party/issues/3) | Brief synchronized title cards implemented, tested, committed, and pushed; migration 027 applied to production November 7; deployed UI activation not verified |
| Clippy/essay improvements: “STUDY BREAK!”, an essay participation prompt, and different things for Clippy to say | [Issue #4](https://github.com/moosh3/2006-party/issues/4) | Implemented, tested, committed, and pushed; MK’s final copy/presentation review and exact show cue timing remain |

All three GitHub issues were checked and remain open as of this handoff. Implementation and verification details were added as issue comments; their original issue-body checklists have not been marked complete.

## Repository and workspace

The application is **`moosh3/2006-party`**, at:

```text
/Users/aleccunningham/Projects/github.com/moosh3/2006-party
```

The adjacent `2006` folder is only the Codex workspace pointer. Work in `2006-party`, read its `AGENTS.md`, and inspect Git status before changing anything. GitHub operations must explicitly target `moosh3/2006-party`; `upstream` points to the separate `moosh3/after-party` repository.

The checked-out branch is `main`. These two commits were pushed to `origin/main` at the user’s request:

| Commit | Work |
| --- | --- |
| [`bdbdbf4`](https://github.com/moosh3/2006-party/commit/bdbdbf4) | Improve Clippy essay invitations and dialogue |
| [`932074e`](https://github.com/moosh3/2006-party/commit/932074e) | Add synchronized countdown title cards |

The feature push was verified at `932074e5532a2e032a2c20fd7d9da1ba3aec96b9`, with `339aa18..932074e main -> main`. Subsequent room-player work is recorded below; do not assume that feature commit remains the latest branch tip.

### Room-player follow-up subsequently authorized for shipping

These five files already had uncommitted room-player changes before the Clippy/title-card work and were excluded from those two feature commits:

- `docs/offline-room-player.md`
- `scripts/test-room-app.mjs`
- `tools/room-player/app.mjs`
- `tools/room-player/index.html`
- `tools/room-player/room.css`

The user subsequently asked to ship these changes. They are now committed separately as [`325a313`](https://github.com/moosh3/2006-party/commit/325a313), **Improve offline room cue reordering and save protection**. This handoff is being included in its own documentation commit.

The room-player changes add pointer dragging and Alt + Arrow cue reordering, stable next-cue selection, automatic saving before switching cues, clear save status, failed/incomplete-save draft protection, holding-file save confirmation, and a leave-page safeguard for unsaved edits. Reordering remains locked during active video or sound playback and does not start a cue.

Verification on November 7, 2026: `npm run test:room` passed all **150 checks** (26 state, 23 server, 65 output, 36 operator). An isolated local Chrome check also passed real pointer dragging, keyboard reordering/focus restoration, saving before switching, failed-save draft/selection retention, and the leave-page safeguard. Temporary settings were used, and the rehearsal server/browser were stopped. Physical display, codec, fullscreen placement and speaker checks still need rehearsal on the show laptop.

The offline tool is excluded from website deployment by `.vercelignore`. Shipping this follow-up means committing and pushing its source, tests, operating guide and this handoff; it does not install a new room rundown or start playback. No production database migration is part of this follow-up.

## What MK requested and what the user decided

The original notes were:

1. A new section called **“Rules Of Life.”** All avatars should line up in the video-player area for a section. Clicking them should expose catchphrases and profiles, and the section should introduce polls and superlatives so guests discover and use them.
2. Attach **“And now time for video #N”** before each video.
3. Improve Clippy and the essay:
   - A pop-up saying **“STUDY BREAK!”**
   - Prompt guests to participate in the essay.
   - Have Clippy say different things.

The source list ended with an empty bullet. No additional requirement was inferred from it.

The user authorized starting with whichever task was most doable, so Clippy/essay came first. They then requested a commit followed by issue #3. When asked how the numbered introduction should appear before each countdown video, they explicitly chose **“A brief on-screen title card.”** The three-second default and adjustable duration are implementation choices, not an approved full production rundown.

## Completed: Clippy and essay improvements (#4)

Commit: `bdbdbf4`.

### Guest experience

- The existing initial essay reminder now says **“STUDY BREAK!”** and offers a direct **Open essay** action. The Mail route remains available.
- Desktop Clippy was moved into the side-column area so the invitation clears the video picture in the checked default layouts.
- Phones receive a dismissible inline invitation below the player rather than the floating desktop assistant.
- The existing initial reminder still uses its 1.2-second delay when audience cues are unarmed and no tracked show interaction has suppressed it. No new production show offsets were invented.
- Timed essay invitations use the same “STUDY BREAK!” wording. When the timed cue system is armed, its invitations take precedence over the initial reminder.
- There are three dialogue lines for each of three contexts: invitation, writing, and saved draft. Guests cycle them with **What else, Clippy?** There is no automatic dialogue-rotation timer.
- Guests choose whether to open the essay. An invitation does not automatically open Mail or TextEdit, change a prompt, or replace writing.
- Drafts and selected prompts retain their existing browser-local, viewer-specific persistence. Dialogue changes and hiding/restoring the helper do not modify them. Saving a draft is not a server submission.
- Dismissing timed desktop Clippy also dismisses the corresponding inline essay invitation through the existing cue ledger. Initial-reminder dismissal suppresses it for the current mounted visit; it is not a promise of cross-reload persistence.
- Original Clippy art, one-shot animations, pause controls, and reduced-motion behavior are retained.

### Files to start with

- `components/2006/MacInteractiveShowcase.tsx`: `CLIPPY_DIALOGUE`, shared dialogue UI, phone invitation, TextEdit helper, and desktop assistant.
- `components/2006/AimExperience.tsx`: reminder visibility, cue integration, dismissal, essay opening, and local draft handling.
- `components/2006/AudienceCueBar.tsx`: timed essay invitation copy.
- `components/2006/experience.css` and `mobile-show.css`: helper placement and responsive presentation.
- `DESIGN.md`: documented behavior.

### Still open

- MK’s review of the new dialogue and presentation.
- Exact production cue timing for “STUDY BREAK!” and the essay activity.
- Whether a later production requirement needs operator-selected dialogue. No new operator dialogue controls were added.

The production audience cue configuration remains disabled/empty in `lib/audience-cue-config.ts`. Existing local rehearsal cues are synthetic and must not be used as the real show’s timings. See `docs/show-cues.md`.

## Completed: numbered title cards (#3)

Commit: `932074e`.

### Guest and operator behavior

- The card reads **“And now time for video #N”**, using the countdown cue’s assigned rank. Queue position is not used as the number.
- New countdown cues default to **3 seconds**. The existing countdown editor exposes **Title card before video (seconds)** from **0 to 10**; zero disables it.
- Existing active and queued cues retain their saved behavior until edited. Pushing the code does not add cards to the existing production queue.
- Card time is added before the complete source excerpt. It does not consume highlight time or change the library’s original media duration. The #1 cue still plays the full original video from zero.
- Each consecutive countdown cue gets its own card and number.
- Mux and individual YouTube countdown sources remain paused during the card. The player stays mounted and is hidden during the card, then becomes visible for the video.
- Late arrivals see only the unconsumed card time. Refresh/reconnect does not start a new introduction.
- Pause/resume, hold/resume, and returning from Schedule preserve remaining intro time. Hold suppresses the title card while the hold screen is active.
- Explicit **Restart** deliberately replays the intro. An explicit source seek skips its remaining time.
- Cards appear in `/event`, `/stage`, and the operator monitor, and remain inside composition fullscreen.
- Text is static, available to assistive technology, readable on large displays, and arranged to clear phone fullscreen controls.
- Ordinary unnumbered clips and ads do not receive invented numbers. There is no recorded spoken introduction or external media upload.

### Scope limit to carry forward

The existing countdown editor and validation support **#5 through #1**. This work did not expand them to #10 through #6, even though the working rundown mentions those earlier ranks. If production expects numbered cards for those videos, extend the numbered-cue model and editor deliberately, with approved media/timing inputs. Do not infer rank from queue position or video titles.

This work applies to the online website/shared queue. It does not add title cards to the independent offline room player.

### How synchronization works

- `CountdownCue.introSeconds` stores the optional configured duration; legacy cues can omit it.
- Migration 027 adds `current_stream.countdown_intro_remaining_seconds`. This is the remaining delay at the stored playback anchor, not a value that a background timer continually decrements.
- Database clock functions calculate current remaining delay and source position. Queue deadlines include the intro plus the complete excerpt.
- `/api/current` exposes `playbackStartDelaySeconds` and the source position sampled by the database.
- `lib/playback-sync.ts` projects that delay from the same monotonic anchor and bounded latency estimate used for source synchronization. Media corrections and reconnect actions respect it.
- The countdown frame shows the card from that snapshot; it does not advance the queue or create another playback authority.
- Source-offset audience tasks are suppressed during the card so an essay/poll cue does not fire before its video starts.
- Command IDs, expected-session guards, transactional queue behavior, and stale-response rejection are retained.

### Files to start with

| Area | Files |
| --- | --- |
| Card and fullscreen presentation | `components/CountdownFrame.tsx`, `components/countdown-introduction.css` |
| Source playback and reconnect handling | `components/VideoPlayer.tsx`, `components/YouTubeVideoPlayer.tsx`, `lib/playback-sync.ts` |
| Cue model, editor, and queue display | `lib/countdown.ts`, `components/admin/CountdownEditor.tsx`, `components/admin/QueueManager.tsx` |
| API and stream contract | `app/api/admin/queue/countdown/route.ts`, `app/api/current/route.ts`, `lib/program-stream.ts` |
| Snapshot propagation | `components/2006/AimExperience.tsx`, `app/stage/page.tsx`, `app/admin/page.tsx` |
| Audience task timing | `lib/audience-cues.ts` |
| Database support and guarded installation | `sql/027_countdown_introductions.sql`, `scripts/apply-countdown-intro-db.ts` |
| Operation and development guidance | `docs/countdown-queue.md`, `DESIGN.md`, `AGENTS.md` |

## Release status and database update

Both feature commits have been pushed. At the user’s subsequent request, migration **027 was applied successfully to the 2006-party production database on November 7, 2026**. No manual Vercel deployment was performed. A Git push may trigger a configured automatic deployment; the deployed website version and guest-facing title-card activation have not been checked. Database installation is verified; full production UI activation is not.

The production preflight confirmed that the 026 countdown prerequisites were installed and 027 was absent. The guarded 027 installation then succeeded, including its before/after show-and-audience state comparison. It preserved the active cue, queue, library, doors, viewers, votes, audit records and command records. Existing cues were not changed to add title cards. The application’s missing-column save error remains a safeguard for other environments.

Installation evidence: migration SHA-256 `4be3985344bcf189e1e4b29fdb5bd0ae3e40314e7b338dc13fb68b07a8029421`. Read-only catalog verification confirmed the new non-null numeric column, exact source-body matches for all ten migration functions, blocked anonymous operation access, and allowed service-role operation access. The installed CLI required updating the runner to use `--remote`, enforced `--read-only` for preflight, and an explicit hosted `--yes` only when `--apply` is supplied. Isolated runner checks verified both modes, the fixed-project restriction and rejection of unknown arguments without executing database writes.

The commands used are retained here for maintenance; 027 has already been applied to production:

```sh
# Read-only preflight against the configured 2006 database
npm run db:countdown-intro

# Explicit installation, when carrying out the release
npm run db:countdown-intro -- --apply
```

Read the installer and `AGENTS.md` first. It is restricted to the existing project and wraps installation plus state checks in one transaction. It compares show/audience state, normalizes the new field for comparison, and rolls back if existing state changes. It does not seed media, reorder the queue, open doors, reset votes, or deploy the website.

**Do not replay 022, 025, or 026 after 027.** Those migrations replace timing functions needed by title cards.

For a release, verify the current Vercel project and database compatibility, then check deployment readiness, aliases, basic health, and the changed behavior. A local CLI deployment uploads uncommitted source, so inspect any new working-tree changes and preserve the exclusions for room-player tools, local settings and media. Follow `AGENTS.md` rather than treating this document as a deployment command.

## Verification already performed

These checks passed during implementation. They were not rerun just to write this document, and local rehearsal is not production verification.

### Code and committed regression checks

```sh
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm run test:countdown-intro
npm run test:countdown-db
npm run test:playback-sync
npm run test:mux-seek-recovery
npm run test:youtube-player
npm run test:audience-cues
npm run test:audience-cue-delivery
npm run test:audience-cue-hook
npm run test:audience-cue-config
npm run test:show-art
node --import tsx scripts/test-queue-interactions.ts
node --import tsx scripts/test-admin-playback-stability.ts
```

The title-card database test includes validation, idempotent retries, source freeze, pause/resume, finite YouTube hold, restart/session guards, seek, mode changes, excerpt boundaries, consecutive intros, auto-advance deadlines, unchanged library durations, installation over active/queued legacy cues, repeat installation, and permissions. Mux and YouTube component regressions cover silence during the intro and reconnect not skipping it.

The builds emitted existing browser-compatibility-data age notices; compilation, lint, and type checks passed. Dependencies were not upgraded as part of these requests.

### Isolated API and browser rehearsal

Used `npm run preview:playout` and `npm run preview:audience-cues`, which create disposable local PostgreSQL fixtures and skip production credentials. The preview now includes migration 027. `npm run test:countdown-api` passed against that fixture; it mutates rehearsal state and must not target production. Do not run builds and the preview server concurrently against the same `.next` output.

Clippy rehearsal covered keyboard dialogue changes, desktop and phone invitations, 320px layouts, 44px touch targets, draft/prompt preservation, save and reload restoration, helper hide/restore, reduced motion, a continuously mounted player, and no vote/admin mutations. Timed-cue rehearsal checked passive invitations, no duplicate phone reminder, draft retention, and dismissal persistence.

Title-card rehearsal covered the real operator form and saved metadata without starting playback; stage and phone rendering; paused cards; one mounted source; pause/hold/resume; late arrival; restart; consecutive #4/#1 cues; full #1 duration; composition fullscreen; phone text/control separation; and larger stage typography. No application page errors were observed in the checked flows. Local Chrome checks do not replace rehearsal in the actual show browsers and display setup.

Temporary browser scripts/screenshots were kept outside the repository under `/private/tmp`; they are not durable project test assets. The committed regression tests and preview scripts are the reproducible starting point. The rehearsal servers and browser instances started for this work were stopped.

## Remaining: “Rules Of Life” (#2)

No feature implementation has started. The issue preserves MK’s original note and a proposed acceptance checklist.

Existing pieces to reuse:

- `components/2006/ShowBuddyStrip.tsx`: cast lineup and avatar interactions.
- `components/2006/AimExperience.tsx`: AIM Buddy Info, profiles, and participation navigation.
- `lib/run-of-show.ts`: working show sequence; not approval of production timing.
- `docs/show-cues.md` and the audience cue system: timed invitations, currently unarmed in production configuration.
- Existing game UI and administration for polls and cast superlatives.

Production/product inputs still needed:

1. Where the segment belongs in the show and what starts/ends it.
2. Whether “in the video player” means an interactive scene, a video overlay, or a different player-area presentation.
3. Approved catchphrases, completed profile copy, avatar order, and any intro script/media.
4. Whether catchphrases are text, audio, or both.
5. Which polls/superlatives to open and what to show while voting is closed.

Keep captions and controls usable, support phones and keyboards, preserve original cast artwork and reduced-motion behavior, and do not alter playback or cast votes through decorative interactions.

## Suggested continuation

1. Read this handoff and `AGENTS.md`, check the working tree, and preserve any new unrelated edits. The five room-player files listed above are now included in the separate authorized follow-up commit.
2. Verify the actual deployed website version and guest-facing behavior before claiming either feature is live. Migration 027 is now installed and catalog-verified; verify deployment and any deliberately edited countdown cues without using production votes or playback as test fixtures.
3. Have MK review Clippy copy, the meaning and timing of “STUDY BREAK!”, and the title-card presentation/duration. Decide whether the earlier countdown ranks also need support.
4. Use issue #2 to resolve the “Rules Of Life” content and presentation decisions, then implement it using the existing cast/profile/game foundations.
5. Keep the GitHub issues updated and close them when their remaining acceptance/release work is satisfied.
