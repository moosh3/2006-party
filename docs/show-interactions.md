# Show-driven audience interaction

## Direction

The shared video remains the main event. Give viewers one relevant action next to it, not a growing header or a page of games they have to scroll through. Keep the existing player mounted when switching layouts. Toys are optional and never change broadcast timing or game scores.

## Suggested behavior

| Show moment | Audience experience |
| --- | --- |
| Normal program | Large video, compact cast strip, chat. No automatic window over the program. |
| TRL vote / trivia / superlative | A small current-task area beside the video on desktop and directly below it on phones. The shared video stays visible while answering. |
| Commercial | The same player gets a smaller layout; the current task gets more room. Return to the video-first layout when the commercial ends. |
| Essay cue | Clippy invites the viewer to open the existing essay editor. On phones, use an inline prompt rather than a floating desktop character. Drafts continue to save in this browser. |
| Video or show wrap | Offer a short feedback form at the specified cue, not every transient browser `ended` event. At the final wrap, reveal TRL Winner, Most 2006er and SuperFan using existing results. |

## First implementation

1. Add explicit audience cues to the real rundown: media/slot ID, optional playback offset, action and optional poll ID. Include a commercial layout flag. Do not guess actions from video titles.
2. Connect those cues to the existing shared playback occurrence and server-clock position. Invitations default to once per show and cue ID, including hold/resume sessions. Only deliberately repeated cues use occurrence plus cue ID. Reloads, retries and reconnects must not repeatedly open the same task; late arrivals should see the currently active task.
3. Reuse the existing game state and voting components in one video-adjacent current-task area. Avoid a second independently polling game board.
4. Give production an explicit manual cue/clear override and a rehearsal preview. Never let a viewer finishing a local video trigger a global poll or advance the show.

Existing pieces: synchronized playback metadata, moderated superlatives, vote changes, trivia scoring, award results, Clippy, Mail and the essay editor. Missing pieces: audience cue mapping, the current-task layout, an explicit commercial flag, and feedback collection. The checked-in schedule describes the earlier Cage-A-Thon; it is not a ready-to-use 2006 audience cue sheet.

Inputs needed: the actual 2006 rundown/media IDs, which moments open and close each task, feedback questions or form URL, and supplied sound clips approved for publication.

## Optional delight after the cue flow

- Local soundboard: AIM door open/close, the requested short Life Is a Highway phrase, and Ka-chow. Explicit tap to play, mute/volume control, no automatic sound over the show. Shared broadcast sound would be a separate production feature.
- Cast toys: drag within a bounded play area; tap or use a keyboard action to slime a cast member. Keep it local initially and away from player controls. Preserve original artwork, pause and reduced-motion behavior.
- Finale: optional lava/award animation based on the existing server-scored trivia result. No additional points for client-side toys; ties and zero-answer viewers need clear outcomes.

For the first run-through, keep the compact header and existing click-to-run sprites. Record where people miss an interaction or leave the video. Build the current-task area and cue sheet before the larger toys.

## Foundation implemented October 9

The inactive cue engine, delivery ledger, existing-clock hook and inline invitation are implemented. Poll navigation, essay editing, feedback and results access require a click; invitations do not interrupt a viewer’s current tab or draft. A commercial cue exposes a layout state, but does not yet resize the player. The single game board still owns its existing poll/vote/score logic. See `docs/show-cues.md` for configuration, rehearsal and the remaining activation inputs.

Five supplied Mux videos are verified and added to the production media library, with exact durations in `lib/show-media.ts`. Their import did not change the current stream or queue. No cue timings were inferred from the uploaded titles, and no soundboard/slime assets were invented.
