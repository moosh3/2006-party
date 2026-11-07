# Rules of the Game

Draft spec, November 7, 2026. Tracks [issue #2](https://github.com/moosh3/2006-party/issues/2), filed as “Rules Of Life” from MK’s first note. MK’s run of show names the segment **Rules of the Game**, and that is the on-screen name. Decisions below were made by the production team in chat; items under **Open inputs** are not decided and must not be guessed in implementation. See `docs/run-of-show-alignment.md` for how this fits the whole show.

## MK’s notes

First note:

> A new section called "Rules Of Life." Each of the avatars will show up in the video player for one of the sections with all of them lined up and when you click on them there will be "catch phrases", profiles to open up, and an intro to the polls and superlatives section (to help guests see those sections and interaction with it).

Run of show, segment 2:

> In-person Lip preps the Rules Of The Game while Sprite Lip sets up on the online people to click around.

## Summary

Segment 2 of the show, after Welcome and Ads 1, before Ads 2 and video #5. While Lip preps the room in person, online guests get an interactive scene in the program player. The cast avatars (“Sprites”) stand in a lineup; each reveals a catchphrase and links to their Buddy Info profile. Sprite Lip opens a short tour, and other Sprites present the later steps, pointing guests at cast superlatives (open) and TRL voting (closed since Welcome). After the cue, the scene stays reachable from the desktop.

**Sprites** are the cast members’ existing avatar art on the website, not separate recorded media.

## Decisions

| Topic | Decision |
| --- | --- |
| Name | **Rules of the Game** on screen. The issue and early notes say “Rules Of Life”. |
| Rundown slot | Segment 2: after Ads 1, before Ads 2 / video #5. |
| Presentation | Interactive scene in place of the video. No media plays underneath. |
| Trigger | New operator queue cue type, queued and reordered like any other cue. |
| Duration | Fixed, operator-entered positive length in seconds. Auto-advance treats it like a video cue. |
| Surfaces | `/event` shows the interactive scene. `/stage` shows a static branded card while Lip runs the room live. The operator monitor shows the same card plus cue status. The offline room player is unchanged. |
| Lineup | Same people and order as `ShowBuddyStrip` / the Buddy List, excluding SmarterChild. |
| Avatar click | Catchphrase speech bubble with a **View profile** action that opens the existing AIM Buddy Info window. |
| Catchphrase format | Text always. Optional recorded clip with a play button; never autoplays. |
| Participation intro | Guided tour with Next / Back / Skip. **Sprite Lip** presents the first step; each later step is presented by a different Sprite. |
| Superlatives | Open during the show. The tour links into the existing superlatives voting. |
| TRL voting | Closed before this segment (“VOTING IS NOW CLOSED” at Welcome). Shown so guests know it exists, clearly marked closed. Results arrive through the countdown. |
| After the cue | A **Rules of the Game** desktop icon/window remains so latecomers can browse the lineup and catchphrases. The tour is replayable from there. |
| Content storage | In code, alongside the existing buddy profiles in `components/2006/AimExperience.tsx`. Changes ship by deploy. |

## Guest experience (`/event`)

### Scene

- Fills the player area at its normal aspect ratio and inside composition fullscreen. Uses the 2006 desktop visual language (`DESIGN.md`), not a generic card grid.
- Heading **Rules of the Game**, then the lineup of Sprites with screen names visible under each. Sprite Lip is visually marked as the host of the segment.
- Every avatar is a real `<button>` labeled with name and screen name. Visible focus, 44px minimum touch target, arrow-key movement along the lineup is a nice-to-have on top of normal Tab order.
- Phones: the lineup wraps or scrolls horizontally inside the player area; the catchphrase bubble and tour steps stack below the lineup instead of floating over it. Check at 320px.
- Original cast artwork only. Any idle animation is one-shot or pausable and is off under `prefers-reduced-motion`.

### Catchphrase and profile

- Clicking an avatar opens its bubble; only one bubble is open at a time. Escape or clicking the avatar again closes it.
- The bubble shows the catchphrase text, a **Play** button when an audio clip exists, and **View profile**.
- **Play** plays the clip once at modest volume. There is no program audio during the scene to duck. Text is the caption; no clip-only content.
- **View profile** opens the existing Buddy Info window for that buddy. Profiles that are still empty show the existing empty treatment until MK supplies copy.
- These interactions are local to the viewer and never write to the server.

### Guided tour

- Starts with a visible **Show me around** button presented by Sprite Lip. It does not auto-start over a guest’s exploration; if MK wants it to auto-start at cue start, that is an open input.
- Steps (presenters after step 1 are an open input):
  1. **Sprite Lip: Meet the cast.** Click a buddy to see their catchphrase and open their profile.
  2. **Cast superlatives are open.** Points to the existing superlatives entry point; **Vote now** opens it.
  3. **TRL voting is closed.** Points to TRL voting; shows **Voting closed before the show — watch the countdown for results.** No vote action is offered. The step must read as closed through text, not only grey styling.
  4. **Write the essay.** Points to the essay and explains that submitted essays can show up in Let’s Check Our Scores (segment 7). Wording depends on the essay submission work in `docs/run-of-show-alignment.md`.
  5. **You can come back.** Points to the Rules of the Game desktop icon.
- The presenting Sprite’s avatar appears beside each step’s text.
- Next / Back / Skip are buttons; Escape skips. Focus moves to each step and returns to the **Show me around** button at the end. Step text is announced to assistive technology.
- Tour progress is per-viewer and local. Finishing or skipping it does not change any vote, admission or playback state.
- If the cue ends mid-tour, the tour closes with the scene; the desktop window offers it again.

### After the cue

- When the queue advances, the player shows the next cue (Ads 2) as usual.
- A **Rules of the Game** desktop icon (and mobile equivalent in the existing participation area) opens a window with the same lineup, bubbles, profile links and tour. It must not cover the player or captions by default.
- Default: the icon appears after the cue first airs in the current playback session. Showing it from doors-open is an open input.

## Stage (`/stage`) and operator monitor

- `/stage` shows a static branded card: **Rules of the Game**, with a smaller line such as “happening online”. No interactivity, no lineup. Wording is an open input.
- The cue clock and next-cue display keep working from the shared snapshot.
- The `/admin` monitor shows the same card and the normal Playing / Paused / Holding status and remaining time.

## Operator (`/admin`)

- New queue action **Add Rules of the Game scene** with one required field: **Length (seconds)**, a finite positive number, fractional seconds allowed.
- The cue appears in the queue with its own label/icon, can be selected, moved and removed like other cues. Selecting or moving never starts it.
- **Play Next**, auto-advance, pause, hold, restart and Schedule interplay behave as for a video cue of the same length. Pause/hold preserve elapsed time. Queue exhaustion after it uses the existing hold screen.
- The scene has no media, so there is no seek control for it beyond Restart.

## Technical approach

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

- Move the shared cast data out of `AimExperience.tsx` into a small module used by the buddy strip, Buddy Info, this scene and the presenter avatars on countdown title cards. Add the cast member’s real name (for “Sprite Lip”), `catchphrase: string` and `catchphraseAudio?: string`.
- Audio clips live under `public/2006/` with provenance added to `public/2006/SHOW-ART.md`. Format: something every target browser plays (AAC/M4A or MP3); check during rehearsal.
- Tour copy lives next to the scene component as a typed constant, with the presenter Sprite per step.

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
- [ ] Each avatar shows its catchphrase and opens its Buddy Info profile. Optional audio plays only on request.
- [ ] Tour opens with Sprite Lip, reaches open superlatives and clearly closed TRL voting, with Next / Back / Skip, keyboard and screen-reader support.
- [ ] Rules of the Game remains reachable from the desktop after the cue.
- [ ] `/stage` and the operator monitor show the branded card and correct status.
- [ ] Pause, hold, restart, auto-advance on/off and Schedule interplay behave as for an equal-length video cue.
- [ ] Phones (320px+), keyboard, visible focus, reduced motion all checked.
- [ ] No interaction in the scene writes votes, admission or playback state.
- [ ] Migration 028 installs after 027 via a guarded installer; existing queue, doors, votes and library are preserved.
- [ ] Tests: queue interactions, playout DB, playback sync, and a new scene test alongside `npm run test:countdown-intro`; rehearsed in `npm run preview:playout`.

## Open inputs (MK / production)

1. **Cast mapping:** which screen name is Jen, Lip, Emma, Yongoo and MK (and whether `bbulldogs48` is Alec/Tech and belongs in the lineup).
2. **Catchphrase for each cast member**, and who (if anyone) records audio.
3. **Missing profiles:** SBconfetti, neodafunky, EmmaIsNine and bbulldogs48 have empty profiles; EmmaIsNine’s away message is a placeholder.
4. **Tour script:** final wording for each step and which Sprite presents steps 2–5.
5. **Length** of the cue.
6. Whether the tour **auto-starts** at cue start or waits for **Show me around**.
7. `/stage` card wording.
8. Whether the desktop icon appears **only after the cue airs** or from doors-open.

## Out of scope

- The offline room player.
- Admin-editable catchphrases or profiles.
- Opening, closing or changing any poll, superlative or TRL round from the scene.
- Sprite scenes for Welcome and People We Know (tracked in `docs/run-of-show-alignment.md`).
