# Technical architecture

## One program state, three presentations

The operator changes `current_stream` through `/admin`. `/api/current` resolves that state into one normalized payload containing the active media source, synchronized playback position, active cue, and next transition.

```text
                     /event  online video + AIM chat + polls
                    /
/admin → current_stream → /api/current → /stage  room video + cue clock
                    \
                     Supabase Realtime → presence, messages, reactions, polls
```

This means the audience and the room do not run independent playlists. They are two views of the same program clock.

## Surface responsibilities

### Audience (`/event`)

- display the current Mux VOD/live source or approved YouTube playlist
- correct viewer drift against the shared playback state
- show captions by default when a caption track exists
- accept audience chat messages, reactions, and poll votes
- recover after mobile sleep, tab backgrounding, and realtime reconnects

### Stage (`/stage`)

- display the same program source without audience chat
- keep the current performance cue visible
- show the next transition as a large tabular countdown
- continue showing the last received cue if network refresh fails
- provide a one-click fullscreen action for the room display

### Operator (`/admin`)

- select manual or scheduled playout
- choose and queue media
- start, pause, seek, restart, or advance playback
- open and close polls
- switch to a hold source when the live room needs time
- preview both audience and stage views

## Run-of-show data

`lib/run-of-show.ts` currently stores only facts supported by the production document: ordered cue names, which surface receives each cue, and the performer-facing action. Exact duration is intentionally absent.

When the schedule is locked, the cue IDs should become the `showtime.yaml` slot IDs. That makes `activeSlotId` the bridge between the playback engine and both visual presentations.

## Failure behavior

- The audience and stage poll `/api/current` every three seconds, so a dropped realtime socket does not freeze the program state.
- The video player re-fetches the current source after a playback error and refreshes signed playback tokens before expiry.
- The stage display preserves the last valid cue and adds an offline warning if the refresh fails.
- Local preview mode uses explicit non-production data rather than requiring secrets during build.

## Accessibility baseline

- skip links are present on audience-facing screens
- the show and chat remain keyboard operable
- chat updates use a polite live region
- focus indicators are high-contrast on the collage and window chrome
- reduced-motion preferences disable nonessential motion
- stage cues use large type and do not rely on color alone
- media captions remain wired through the source project’s caption-track path

