# Interface polish verification

## October 9, 2026: Admin connection stability and clean fullscreen

- The installed Supabase client reuses identical channel topics. The operator preview and playback sidebar were sharing a health topic and could interfere during cleanup/reconnect. Health monitors now own separate topics and retry generations, retire ownership before unsubscribe, ignore retired callbacks, and cancel pending retries after recovery.
- Playback status stays in one compact mounted area. Brief degraded signals do not flash warnings; sustained warnings and confirmed offline remain visible. Removed the decorative pulsing dot. A failed or malformed API status read still immediately clears the cue identity and disables unsafe commands; smoothing affects presentation only.
- Stage Fullscreen now expands only the program section, excluding the persistent cue footer. Escape restores the windowed operator information. The player, session identity, synchronization and native volume/caption controls are unchanged.
- Passed 15 actual-source, isolated admin regressions, 21 playback-sync checks, disposable Next/PostgreSQL API regressions, scoped ESLint, full TypeScript and diff checks. Independent read-only review found no actionable issue.
- Local Chrome native-click verification confirmed `.stage-program:fullscreen` at the full 1579×909 viewport, with no cue footer in the fullscreen accessibility tree; Escape restored cue information. The local-only xanga cue loaded and rendered inside that section. Screenshot: `/private/tmp/2006-video-only-fullscreen-pass.png`. The fixture does not provide realtime WebSockets; its sync warning is not a live-event result. A development hot-refresh hook-order error while editing the hook was cleared by a fresh page load; production verification uses a fresh build.
- The live event-media autoplay rehearsal completed separately: xanga → Clippy → waiting with one initial operator start, late join/reload seeking to current time and no further manual commands. See `docs/playout-hardening.md` for measurements and limits. Live was left with doors open, automatic advancement on and an empty queue.

### Deploy result

- Live URL: https://2006-party.vercel.app; target production, project `2006-party`, team `moosh3s-projects`. Deployment `dpl_EAsWVGcBP4qfWDRLqqp3cDQzwzW6` reached READY, staged at https://2006-party-l3mfgc8bq-moosh3s-projects.vercel.app and promoted unchanged after staged health/stage HTTP 200 and a valid current waiting snapshot.
- Framework Next.js 14.2.33, Node.js 22; build duration 1m 40s. Source is the preserved dirty working tree based on `b1c1978`, not a clean release commit. No dependency or credential settings changed.
- Fresh live Chrome stage verified program-only fullscreen at the browser's existing 90% zoom, with only the program region in the fullscreen accessibility tree. Escape restored the cue footer. Screenshot: `/private/tmp/2006-clean-fullscreen-live.png`. The in-app stage was refreshed and left open for the user.
- Fresh authenticated admin showed `Playback status current` across checked background refresh cycles, doors open, automation holding and zero queue entries; captured browser warning/error logs were empty. No production playback command or game/chat participation was sent during this display fix. Regression coverage handles simulated network loss; this short live observation does not guarantee every network will remain healthy.
- The bounded ten-minute runtime error query (up to 50 entries) returned no entries. Earlier same-session drain inspection found zero configured drains, so continuous monitoring is not claimed. Existing install audit warnings remain: 29 vulnerabilities, including one critical; no framework/dependency upgrade was made.
- Disposable preview server stopped and agent-created rehearsal tabs closed. User tabs preserved; no temporary viewport overrides applied in this pass.

## October 9, 2026: Mac sign-on and host-controlled audience doors

- Added a Mac Aqua-style sign-on and waiting screen. Viewers choose a screen name without a password; the server-issued browser identity supplies the AIM name and game identity. Returning cookie identities retain their name, votes, moderation status and scores. This is not an actual AOL account, globally unique username or cross-device account recovery.
- Added Audience doors in admin with explicit Open doors and confirmed Close doors. Admission is independent of program playback, queue, poster mode and game state. Waiting viewers enter automatically after the host opens; closing unmounts the show, and reopening fetches the current program afresh. Direct `/event` and `/game` visits are also gated.
- Added service-role-only admission storage, revision-checked atomic updates and admin audit records. Missing schema, unavailable initial checks and blocked identities fail closed. Transient failures retain a previously confirmed admission state; uncertain admin writes require a refresh. This is a presentation/admission gate, not ticket security or media DRM. See `docs/show-access.md` for the operator workflow and identity limits.
- Passed 19 audience-access tests, 16 actual-door-hook lifecycle checks, six database scenario groups, real isolated Next.js door/sign-on/chat API checks, 21 playback-sync tests, existing playout API and game database regressions, full TypeScript, ESLint and diff whitespace checks. Coverage includes stale responses, disable/unmount cleanup, revision conflicts, row-level access, outages, cookie/name reuse, spoofed chat labels and preservation of unrelated show state.
- Isolated browser rehearsal: sign on as `runThru2006`, wait without player/chat/game/presence mounting, open from admin, enter automatically, answer trivia correctly, close with confirmation, then reopen with the same identity and score. Back-to-login with a different submitted name did not replace the cookie identity. Direct game access and initial database outage remained gated; restore/retry recovered. No production participation or playback commands were submitted.
- Production admission migration applied transactionally with guards confirming current stream, queue, viewers and votes unchanged. Default remains closed at revision 0. RLS is enabled; public roles cannot read the table or operate its setter. Migration SHA-256: `5eb94144cb30555fb886ceb9a65a23f821a146b93e1fe4d716e0eadd5eee4257`.
- Live browser verified the Mac login, 46px input, 44px action target, no page overflow and no player at 1280px. Screenshot: `/private/tmp/2006-mac-login-live.jpg`; isolated waiting proof: `/private/tmp/2006-show-waiting.jpg`. Responsive CSS and touch sizing were reviewed, but this pass's viewport override did not change the actual browser layout width, so phone reflow was not visually certified. Physical devices, assistive technology and event-length streaming still need rehearsal. Agent-created tabs and disposable preview servers were closed.

### Deploy result

- Live sign-on: https://2006-party.vercel.app/login; operator controls: https://2006-party.vercel.app/admin.
- Target: production, project `2006-party`, team `moosh3s-projects`. Final deployment `dpl_92hsFPn7qfMGrCPvcNZf6sBgfVdA`, staged at https://2006-party-3nsj2v36v-moosh3s-projects.vercel.app, READY; the exact verified build was promoted unchanged.
- Source: dirty working tree based on `b1c1978`, with existing cumulative edits preserved; no clean release commit or Git push was created. Twenty final deployment file hashes matched the reviewed local sources. Framework Next.js 14.2.33, Node.js 22; build 1m 58s, post-build 22s. An earlier candidate failed on a type-only test assertion; it was corrected before the final successful build.
- Staged health, login and gated event returned HTTP 200. Doors returned HTTP 200 with `doorsOpen: false`, revision 0 and no-store cache headers. Unauthenticated sign-on GET returned null identity with private/no-store; admin doors GET returned HTTP 401. After promotion the live doors endpoint again confirmed closed revision 0 with no-store and a cache MISS. No production test viewer was created.
- Bounded final runtime error scan returned no entries in ten minutes/up to 50 entries; this is not continuous monitoring. A read-only project drain check returned zero configured drains, so a monitoring gap remains. No monitoring configuration changed.
- Existing dependency warnings remain unchanged: 29 vulnerabilities (4 moderate, 24 high, 1 critical), plus outdated compatibility-data warnings. Dependency upgrades were not part of this feature.

## October 9, 2026: TRL trailing whitespace

- Removed the desktop game panel's forced `min-height: 100%`. It now follows the actual board and footer height, rather than leaving a blue-white block beneath shorter TRL rounds. Fixed window dimensions, floating/expanded controls, video geometry and voting logic are unchanged.
- Reproduced with a joined viewer and the existing demo polls in the isolated playout database only. At 1780×1180, the panel was 971.5px with 684.539px of content before the fix; after it matched the content exactly, removing 286.961px of trailing whitespace. Switching to Trivia and Superlatives also matched each tab's content height. Floating TRL ended at the scrollport bottom within 0.1px.
- At 390×844, mobile TRL matched its 822.688px content height, with zero horizontal page overflow and one video region. TypeScript, ESLint and diff whitespace checks passed. No production game participants, votes, scores, chat, queue or current stream were changed.
- Browser proof: `/private/tmp/2006-trl-spacing-fixed.jpg` (isolated joined-viewer rehearsal). Temporary browser viewport, agent-created tab and preview server were cleaned up.

### Deploy result

- URL: https://2006-party.vercel.app/event
- Target: production, project `2006-party`, team `moosh3s-projects`.
- Status: READY; deployment `dpl_7yumdK4wVbviYZg8FhDyfun3BXNy`, staged as https://2006-party-erns83b78-moosh3s-projects.vercel.app and promoted unchanged after health and `/event` both returned HTTP 200.
- Source: dirty working tree based on `b1c1978`; this pass changes one CSS declaration and verification documentation. Existing edits preserved; no new clean release commit.
- Framework: Next.js 14.2.33, Node.js 22. Build duration: 1m 39s.
- Live browser confirmed `min-height: 0px`, 906.438px panel equal to its contents, zero horizontal overflow, and the existing TRL data. No production participation was submitted. Screenshot: `/private/tmp/2006-trl-spacing-live.jpg`.
- Error scan: no entries returned in the bounded ten-minute scan (up to 50 entries), not continuous monitoring. Drains remain unverified through the unavailable connector; monitoring gaps remain. Existing dependency warnings unchanged, including one critical vulnerability; no dependency upgrades were made.

## October 9, 2026: Mux media and inactive audience cue foundation

- Imported the five supplied ready/public Mux assets into the production media library: Corn Castle, Gorillaz, When You Were Young, xanga and Clippy All Clips. SDK-verified titles, public playback IDs and exact durations match all five database rows; all five HLS manifests returned HTTP 200. No Mux assets or credential settings were changed. No separate caption tracks were added.
- Import plan/apply both confirmed the current stream and video queue were unchanged. Existing library metadata is never overwritten. The waiting-screen message now describes the host starting the program, not missing Mux credentials.
- Implemented the explicit cue engine, bounded consumption/dismissal ledger, existing-stream observer, inline invitation and click-only links to the existing game/essay/results. Production is disabled/empty. Commercial layout state is exposed but actual reflow, inline answering, manual production cue controls, sounds, slime and finale animation are not implemented.
- Passed 86 isolated checks (33 engine, 30 delivery, 18 actual-hook lifecycle and 5 production/rehearsal guards), 21 playback-sync checks, 30 original cast interaction checks, original art/Photos byte checks, full ESLint, TypeScript and diff whitespace checks. Production cannot enable synthetic cues even with an accidental rehearsal flag.
- Isolated browser rehearsal at 1280px, 390px and 320px: passive cue entry did not switch the current game tab, open a modal/editor, change the phone panel or scroll the page. Explicit poll click selected the exact open prompt category; mobile changed to the game panel only after clicking. Commercial + poll overlap did not hide the poll invitation. Feedback stayed an explicit safe new-tab link. Dismissal survived reload. Cue buttons measured 44px, with no page overflow and one Mux player. The embedded fixture does not supply Supabase realtime; its connection status is not a real-event sync certification.
- Production browser verified the compact 97px header and no active audience cue before final waiting-copy correction. The host still needs the real rundown, interaction offsets, poll IDs/open-close plan, feedback URL and approved audio before cues can be enabled. See `docs/show-cues.md`.

### Deploy result

- Initial inactive foundation build: `dpl_7hE9B8SCZwV3GBNzXyahmPHS77s5`, production READY, 1m 57s, staged `/api/health` and `/event` HTTP 200; exact build promoted unchanged to https://2006-party.vercel.app/event.
- Final release (waiting-copy correction): https://2006-party-i3gnny659-moosh3s-projects.vercel.app, deployment `dpl_7PQdPtdTETZjmJq371DFt6EzDiFC`; production READY for project `2006-party` / team `moosh3s-projects`. Framework Next.js 14.2.33, Node.js 22, build duration 2m 14s. Protected staged health and audience page both HTTP 200; the exact tested production build was promoted unchanged to https://2006-party.vercel.app/event.
- Final live browser proof: corrected waiting message, 97px cast header, zero active invitations, `program` layout and no page overflow at the normal 1280px viewport. Existing chat and game loaded; no votes/messages were submitted. Saved screenshot `/private/tmp/2006-show-cue-foundation-live.jpg`. Temporary viewport overrides, agent-created tabs and isolated test server were cleaned up.
- Source: dirty working tree based on `b1c1978`; existing unrelated edits preserved. No clean committed release was created.
- Bounded runtime scan: no error entries returned for the initial foundation build in ten minutes/up to 50 entries, not continuous monitoring. Drain recheck remains unavailable; no monitoring configuration changed.
- Final release error scan also returned no entries in ten minutes/up to 50 entries. Drains remain unverified through the unavailable connector, so monitoring gaps remain; a clean short scan is not an event-length production certification.
- Existing dependency warnings remain: 29 vulnerabilities including 1 critical. No dependency upgrade was made in this pass.

## October 9, 2026: Compact cast header

- Reduced the desktop cast strip from 163px to 97px at 1280px viewport width. At 920px it remains 97px instead of wrapping. Narrow rosters scroll horizontally within the strip, not the page.
- Kept original idle portraits at 48px and the calibrated full running canvases at their existing sizes. Every original GIF frame, timing and transparent pixel remains intact. All-frame visible bounds fit the 64px portrait lane plus 6px overhead clearance; transparent padding does not determine header height.
- Kept desktop names separate from run buttons, 44px mobile name targets, source attribution, focus styles, screen-reader run announcements and accurate pause/reduced-motion hints.
- Browser checks at 1280×900, 920×760, 390×844 and 320×720: no page overflow, one player, unchanged video geometry while Lip runs, full Lip canvas still 98.617px on desktop and phone, 64px sprite targets and 44px phone name targets. The mobile roster is 164px tall in the checked normal-motion state.
- All 30 isolated interaction checks, original running GIF/Photos byte checks, original idle-art checks, TypeScript, ESLint and diff whitespace checks passed. No production votes, scores, queue or media settings were mutated. Browser viewport checks are not physical-device or complete assistive-technology certification.
- Team interaction notes are captured in `docs/show-interactions.md`. Cue-linked game/Clippy/commercial layouts, soundboard, feedback and slime/award toys remain planned, not implemented in this header release.

### Deploy result

- URL: https://2006-party.vercel.app/event
- Target: production, project `2006-party`, team `moosh3s-projects`.
- Status: READY; tested staged production build promoted unchanged, deployment `dpl_GZjnG6k1ByzSBdSDLdyf5iAx9cQi`.
- Source: local dirty working tree based on `b1c1978`, not a clean committed release. This pass changed header layout/copy, its regression, and documentation only.
- Framework: Next.js 14.2.33, Node.js 22. Build duration: 1m 54s.
- Checks: staged `/api/health` and `/event` returned HTTP 200. Live browser confirmed 97px header, 48px idle portraits and 64px run targets after promotion.
- Error scan: no error entries returned in the bounded 10-minute scan (up to 50 entries). This is not continuous monitoring.
- Drains: current recheck unavailable through the connector; previous inspection found none. Monitoring gap remains. No monitoring configuration was changed.
- Existing dependency audit warnings remain unchanged: 29 total vulnerabilities, including 1 critical. Dependency upgrades are outside this header pass.

## October 5, 2026: Companion-site style pass

- Clicked through the production's reference show, cast/AIM profiles, countdown and confessions/vibes pages. Reused its actual wordmark and original animated cast artwork, with visible source credit and provenance in `public/2006/SHOW-ART.md`.
- Added collage wallpaper, cast buddy-info access that stays within the show, SmarterChild access, companion-site links, and a warm-paper/lime/pink voting-board treatment. Operator styles and vote/scoring behavior are unchanged.
- Preserved expanded desktop as the default and the floating-window option. Mobile keeps Watch / Vote & Trivia / Chat / Extras, with a single player region across section changes. The old unfinished video shelf is no longer promoted from show Extras.
- Essay drafts and the selected prompt now persist under the local viewer ID on explicit Save Draft. Invalid/blocked browser storage is handled without preventing playback. Save failures have an alert instead of a false success message.
- Keyboard checks: buddy-dialog initial focus, Shift+Tab wrap, Escape close and return to the SmarterChild trigger. Large-dialog height limits account for inherited CSS zoom. Cast text contrast and phone sizing were improved.
- User requested the full original animations: all six GIFs were copied byte-for-byte, retaining 8 frames × 130ms, transparency, original dimensions and infinite looping. Added permanent source-hash/GIF-structure tests and a shared pause/resume control. Original PNGs remain only for paused or reduced-motion mode. Browser checks confirmed all GIFs loaded, pause switched all three strips to PNGs, resume restored GIFs, and 320px layout retained one player with no horizontal overflow.
- Browser checks at 320×740, 390×844, 768×1024, 1280×720 and 1560×1040. Checked no horizontal overflow at phone/tablet widths, a single player region, joined-game layout, trivia saved-answer feedback, superlative vote replacement, local bot response, draft/prompt persistence after reload, and expanded/floating switching. The tallest checked large-screen cast profile was bounded to 12px viewport insets.
- TypeScript and scoped ESLint passed. PostgreSQL game tests and isolated Next.js API regression checks passed. All test participation stayed in the disposable local database; no production votes, scores or show/media settings were changed.
- Limits: viewport testing is not physical-device or comprehensive assistive-technology certification. The local preview uses mock playback/chat. Actual streaming, captions and live transitions still need a show rehearsal.

## October 5, 2026: Mobile show layout

- At widths of 900px or less, the show uses a sticky, touch-sized Watch / Vote & Trivia / Chat / Extras navigation instead of desktop window controls and the dock.
- The existing video, chat and game components remain mounted across mobile section changes. Desktop expanded/floating layout is unchanged.
- The player remains visible above each section. Chat height accounts for the player and header, and unsent chat text survives section changes. Mail, essay and video-shelf access remain under Extras.
- Automatic Clippy reminders are suppressed on phones. A new trivia popup reveals the mobile game section before opening, preserving trivia access from Watch or Chat.
- Browser checks at 320×568, 390×844, 844×390 and 1440×1000: no horizontal overflow in checked layouts, 48px mobile navigation targets, working join/trivia popup and answer, Mail access, retained chat draft and player DOM identity, and desktop controls restored at desktop width.
- Tests use the disposable game database and mock video/chat. Physical-device keyboard behavior and real streaming still require a production-device rehearsal.

## September 12, 2026

Direction confirmed by the user: preserve the playful AIM and 2006 Mac desktop, prioritizing clearer controls, mobile usability, keyboard access and reduced motion.

### Changes

- Audience: explicit Watch Show and Explore sign-on actions; remember the selected experience screen across refreshes; dock windows scroll into view on phones.
- Game: integrate the board into Safari, remove nested framing and mobile blank space, announce saved votes, mark open categories, implement arrow/Home/End tab navigation with unique accessible IDs, clarify closed trivia and hide joining after the show ends.
- Operator: distinguish initial loading from an empty show, separate transient connection errors, add section shortcuts, prevent incomplete drafts, reset the correct-answer selection when choices change, and improve moderation navigation.
- Visual system: larger touch controls, visible keyboard focus and skip links, reduced-motion baseline, consistent silver/blue operator styling, stronger warning contrast, and a better-fitting stage cue clock.

### Checks

- TypeScript and ESLint.
- PostgreSQL game tests: vote replacement, trivia locking, scoring and ties, moderation, privacy and show isolation.
- Real Next.js API tests against the disposable PostgreSQL preview.
- Showtime validation.
- Browser walkthrough: sign-on to show, join, trivia popup and answer, private draft creation and opening, TRL vote replacement, saved-vote feedback, keyboard category switching, desktop and phone show views, game administration and stream controls, stage preview.
- Viewports checked: 390×844, 768×1024, 1440×1000. No horizontal overflow in checked audience/game layouts; visible game buttons at phone width meet a 44px minimum height.

### Limits

Browser viewport checks are not physical-device or comprehensive assistive-technology certification. The disposable preview supports the game database; legacy chat/media services are simulated or unavailable there. Real-time chat delivery, actual Mux/YouTube playback, captions and operator live-feed transitions require a production rehearsal. No production votes, scores, show state or media controls were changed during this pass.
