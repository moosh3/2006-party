# Rules of the Game

Draft spec, November 7, 2026; MK’s answers recorded the same day. Tracks [issue #2](https://github.com/moosh3/2006-party/issues/2), filed as “Rules Of Life” from MK’s first note. MK’s run of show names the segment **Rules of the Game**, and that is the on-screen name. Decisions below were made by the production team in chat; items under **Open inputs** are not decided and must not be guessed in implementation. See `docs/run-of-show-alignment.md` for how this fits the whole show.

## MK’s notes

First note:

> A new section called "Rules Of Life." Each of the avatars will show up in the video player for one of the sections with all of them lined up and when you click on them there will be "catch phrases", profiles to open up, and an intro to the polls and superlatives section (to help guests see those sections and interaction with it).

Run of show, segment 2:

> In-person Lip preps the Rules Of The Game while Sprite Lip sets up on the online people to click around.

## Summary

Segment 2 of the show, after Welcome and Ads 1, before Ads 2 and video #5. While Lip preps the room in person, online guests get an interactive scene in the program player. The cast avatars (“Sprites”) walk in, gather and greet guests, who can click each one for its lines. Below them, a self-paced setup wizard walks through superlatives (open), TRL (closed since Welcome), the essay and the chat. After the cue, the scene stays reachable from the desktop.

**Sprites** are the cast members’ existing avatar art on the website, not separate recorded media.

## Decisions

| Topic | Decision |
| --- | --- |
| Name | **Rules of the Game** on screen. The issue and early notes say “Rules Of Life”. |
| Rundown slot | Segment 2: after Ads 1, before Ads 2 / video #5. |
| Presentation | Interactive scene in place of the video. No media plays underneath. |
| Trigger | New operator queue cue type, queued and reordered like any other cue. |
| Duration | Fixed, operator-entered positive length in seconds. Auto-advance treats it like a video cue. MK sets the length after rehearsal. |
| Surfaces | `/event` shows the interactive scene. `/stage` shows a static branded card while Lip runs the room live. The operator monitor shows the same card plus cue status. The offline room player is unchanged. |
| Lineup | Six Sprites: MK, Jen, Lip, Yongoo, Emma and Alec, in Buddy List order. SmarterChild is excluded. |
| Avatar click | Catchphrase speech bubble with a **View profile** action that opens the existing AIM Buddy Info window. |
| Catchphrase format | Text always, plus a recorded clip for every Sprite with a play button. Clips never autoplay. Until a clip arrives, that Sprite shows text only. |
| Participation intro | Guided tour with Next / Back / Skip that **starts automatically** when the scene starts. **Sprite Lip** presents the first step; later steps are presented by other Sprites (see Guided tour). |
| Superlatives | Open during the show. The tour links into the existing superlatives voting. |
| TRL voting | Closed before this segment (“VOTING IS NOW CLOSED” at Welcome). Shown so guests know it exists, clearly marked closed. Results arrive through the countdown. |
| After the cue | A **Rules of the Game** desktop icon/window appears **after the segment has aired** and stays, so latecomers can play with the Sprites and reopen the wizard. The tour is replayable from there. |
| Content storage | In code, alongside the existing buddy profiles in `components/2006/AimExperience.tsx`. Changes ship by deploy. |

## Cast

| Sprite | Screen name | Role |
| --- | --- | --- |
| MK | `mkashe9` | Writer/Performer/Editor/Tech |
| Jen | `SBconfetti` | Writer/Performer/Editor |
| Lip | `x0x_BlueShellVictim_x0x` | Writer/Performer/Editor |
| Yongoo | `neodafunky` | Writer/Performer/Editor |
| Emma | `EmmaIsNine` | Writer/Performer |
| Alec | `bbulldogs48` | Tech |

## Guest experience (`/event`)

Revised November 7, 2026 after the first look: two separate things happen at once. The Sprites greet guests and can be played with; below them, a self-paced setup wizard shows the rest of the site.

### Sprites (top half)

- No on-screen heading; the scene is still named “Rules of the Game” for assistive technology.
- When the scene starts, the six Sprites walk in from the left one after another (0.3 s apart), gather in the middle slightly overlapping, and a “Welcome to 2006!” bubble appears for a few seconds. They use their still frames throughout: they walk and stand, they never spin. With reduced motion they are already gathered.
- Clicking a Sprite pops a speech bubble above it with one of its three lines; each click says the next line, and after the third it starts again. Each Sprite keeps its own place. Only one bubble shows at a time; Escape closes it. A small **Buddy Info** link opens the existing profile.
- Lines live in `lib/cast.ts` (`lines`, three per Sprite) with an optional recording per line (`lineAudio`), played on the click that says it. Until MK sends them, each Sprite has three placeholder lines.
- Sized to the player (container units), so it fits the 16:9 picture on desktop; narrow players get more room above the Sprites and 44 px touch targets.

### Setup wizard (bottom half)

- A Windows XP style “Getting started” wizard, separate from the Sprites and paced by the guest: **< Back**, **Next >**, **Finish**, **Skip**, step dots, and Escape to close. It is there from the start but never moves focus; **Show me around** restarts it, and finishing or skipping is remembered per cue.
- Steps (`lib/rules-of-the-game.ts`, draft copy): Welcome · Vote in the cast superlatives (**Vote now**) · TRL voting is closed (**See TRL**) · Write your 2006 essay (**Open essay**) · Chat with everyone watching · You’re all set.
- Each step lights up the page control it is about (glowing outline, static with reduced motion) and names it in text: Vote & Trivia bookmark, button and phone tab; TextEdit Dock icon, Essay due! bookmark and phone Extras tab; the AIM window, its Dock icon and the phone Chat tab. Targets are marked with `data-tour`.

### After the cue

- When the queue advances, the player shows the next cue (Ads 2) as usual.
- A **Rules of the Game** desktop icon (and mobile equivalent in the existing participation area) opens a window with the same lineup, bubbles, profile links and tour. It must not cover the player or captions by default.
- The icon appears after the cue first airs in the current playback session, not from doors-open.

## Stage (`/stage`) and operator monitor

- `/stage` shows a static branded card: **Rules of the Game**, with a smaller line such as “happening online”. No interactivity, no lineup.
- The cue clock and next-cue display keep working from the shared snapshot.
- The `/admin` monitor shows the same card and the normal Playing / Paused / Holding status and remaining time.

## Operator (`/admin`)

- New queue action **Add Rules of the Game scene** with one required field: **Length (seconds)**, a finite positive number, fractional seconds allowed.
- The cue appears in the queue with its own label/icon, can be selected, moved and removed like other cues. Selecting or moving never starts it.
- **Play Next**, auto-advance, pause, hold, restart and Schedule interplay behave as for a video cue of the same length. Pause/hold preserve elapsed time. Queue exhaustion after it uses the existing hold screen.
- The scene has no media, so there is no seek control for it beyond Restart.

## Technical approach

### Status (November 7, 2026)

The scene cue type is built: migration `sql/028_scene_cues.sql`, the guarded installer `npm run db:scene-cues` (read-only preflight; `-- --apply` installs), **Add Rules of the Game scene** in the `/admin` queue, the `/stage` and operator-monitor card, and the `/event` scene described above (walk-in Sprites with three cycling lines each, and the setup wizard). After the segment has aired, a **Rules of the Game** Dock icon (Sprite Lip) and a phone **Extras** button open the same Sprites (already gathered) and wizard in a Mac window; there the wizard waits for **Show me around**. “Aired” means a Rules of the Game cue started since the doors last opened (`/api/scenes`, read from the queue audit log, cached 15 seconds at the CDN), or this page saw it play; the icon stays hidden while the scene itself is on. Tests: `npm run test:scene-cues`, `npm run test:scene-cues-db`.

**028 was applied to production after 027 on November 7, 2026** using the guarded installer. The transaction preserved the active cue, queue, library, doors, viewers, votes, audit records and command records. Read-only catalog checks confirmed exact source-body matches for all six functions, all four scene/source constraints validated, anonymous/authenticated scene-queue access blocked, and service-role access allowed. The isolated database regression suite passed. Migration SHA-256: `264dbf5bcfe0c73a794b556a9d9a96eb328bf4f1efa89ada1b0812671e2649db`. No scene was queued or started for verification; production UI rehearsal remains separate. Never replay 022, 025, 026 or 027 after 028 (or 028 after 030).

Each queued scene is its own hidden library row (`source_type = 'scene'`, `playback_id = scene:rules-of-the-game:<uuid>`) holding that cue’s exact length, so the existing queue, clock, pause/hold, auto-advance and session guards apply unchanged. Scene rows are filtered out of the media library; removing a scene from the queue leaves its hidden row behind, which is harmless.

### Queue and database

- Add a new queue source type (working name `scene`, with a scene id `rules-of-the-game`) to `mux_items.source_type` and `current_stream.source_type`, alongside `mux`, `youtube_video` and `youtube_playlist` (see `sql/025_youtube_video_queue.sql`). Keep the type general: Welcome and People We Know may become Sprite scenes later (tracked separately).
- New migration `sql/028_scene_cues.sql`, applied after 027. It must extend the existing playback functions from 027 rather than replaying older definitions. Never replay 022, 025, 026 or 027 function bodies after it.
- Scene cues require an exact positive duration, the same as other synchronized cues. Clock, deadlines, session IDs, command IDs, expected-session guards and stale-snapshot rejection are unchanged.
- A guarded installer script like `scripts/apply-countdown-intro-db.ts` (read-only preflight, explicit `--apply`, state-preservation transaction). No seeding, no queue changes, no door/vote resets.
- The library is unchanged: scene cues do not need a library media row unless the queue schema requires one. Decide during implementation and document it.

### Client

- `lib/program-stream.ts` / `/api/current`: expose the scene source type and id in the snapshot.
- `/event`: when the current source is the scene, render the scene component instead of `VideoPlayer` / `YouTubeVideoPlayer`. Viewer-side elapsed time is projected from the snapshot exactly as for media (`lib/playback-sync.ts`); the client never advances the queue.
- Snapshot recovery and realtime-disconnect polling continue to work; a viewer arriving mid-cue sees the scene immediately.
- `/stage` and `/admin` render the static card for the scene source.
- Audience cues (`lib/audience-cues.ts`) that are source-offset based need a defined behavior during a scene. Default: none fire during it.

### Content

- Move the shared cast data out of `AimExperience.tsx` into a small module used by the buddy strip, Buddy Info, this scene and the presenter avatars on countdown title cards. Add the cast member’s real name, three `lines` and optional `lineAudio`.
- Audio clips live under `public/2006/` with provenance added to `public/2006/SHOW-ART.md`. Format: something every target browser plays (AAC/M4A or MP3); check during rehearsal.
- Wizard copy lives in `lib/rules-of-the-game.ts` as a typed constant.

### Where to start

| Area | Files |
| --- | --- |
| Cast data and Buddy Info | `components/2006/AimExperience.tsx`, `components/2006/ShowBuddyStrip.tsx` |
| Scene and tour UI | new `components/2006/RulesOfTheGameScene.tsx` and CSS next to `experience.css` / `mobile-show.css` |
| Superlatives / TRL entry points | `components/game/`, `lib/game-types.ts` |
| Queue and snapshot | `components/admin/QueueManager.tsx`, `app/api/admin/`, `app/api/current/route.ts`, `lib/program-stream.ts`, `lib/playback-sync.ts` |
| Stage | `app/stage/page.tsx` |
| Database | new `sql/028_scene_cues.sql`, new installer script |

## Acceptance

- [ ] Operator can queue a Rules of the Game scene with an exact length; selecting or moving it never starts it.
- [ ] `/event` shows the interactive lineup for exactly the cue’s duration, synchronized with other viewers; late arrivals and reconnects join mid-cue.
- [ ] Sprites walk in and gather; each click says the Sprite’s next line, looping after three. Optional audio plays only on the click.
- [ ] The setup wizard is present from the start without taking focus, reaches open superlatives, clearly closed TRL voting, the essay and chat, highlights each control, with Back / Next / Skip, keyboard and screen-reader support.
- [ ] Rules of the Game remains reachable from the desktop after the cue.
- [ ] `/stage` and the operator monitor show the branded card and correct status.
- [ ] Pause, hold, restart, auto-advance on/off and Schedule interplay behave as for an equal-length video cue.
- [ ] Phones (320px+), keyboard, visible focus, reduced motion all checked.
- [ ] No interaction in the scene writes votes, admission or playback state.
- [x] Migration 028 installs after 027 via a guarded installer; existing queue, doors, votes and library are preserved (production installation and catalog verification, November 7, 2026).
- [ ] Tests: queue interactions, playout DB, playback sync, and a new scene test alongside `npm run test:countdown-intro`; rehearsed in `npm run preview:playout`.

## Open inputs (MK / production)

Answered with MK on November 7, 2026: cast mapping, lineup (includes Alec), tour auto-start, icon timing, `/stage` wording, and that every Sprite gets recorded audio. Still open:

1. **Three lines for each Sprite** (said in turn on each click), and the group welcome line. MK will send.
2. **Recordings** of each line, if wanted (optional per line).
3. **Missing profiles:** Jen (`SBconfetti`), Yongoo (`neodafunky`), Emma (`EmmaIsNine`) and Alec (`bbulldogs48`) have empty profiles; Emma’s away message is a placeholder.
4. **Wizard wording** for the six steps (no presenters any more).
5. **Cue length,** set after rehearsal.

## Out of scope

- The offline room player.
- Admin-editable lines or profiles.
- Opening, closing or changing any poll, superlative or TRL round from the scene.
- Sprite scenes for Welcome and People We Know (tracked in `docs/run-of-show-alignment.md`).
