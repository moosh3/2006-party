# 2006 Party

The technical home of **2006**, a live performance and synchronized online broadcast by Artistic Accessibility Collective.

This project began as a local fork of [`moosh3/after-party`](https://github.com/moosh3/after-party). It keeps the source project’s Mux playback, Supabase realtime chat and polling, queue controls, captions, and synchronized playback engine while replacing the audience experience with the visual language of the existing [2006 website](https://www.artisticaccessibility.com/2006).

## The three surfaces

All three surfaces read the same current program state from `/api/current`.

| Route | Surface | Purpose |
| --- | --- | --- |
| `/event` | Online audience | Synchronized video, AIM-style audience chat, video shelf, and voting |
| `/stage` | Live room | Program video without chat, plus the current cue, next cue, and transition clock |
| `/admin` | Operator | Existing media library, queue, playback, poll, and stream controls |

`/schedule` exposes the working cue sequence from `lib/run-of-show.ts`. It deliberately does not invent durations or media IDs that have not been locked by the production team.

## Current state

- The landing and sign-on flow use the AIM/Windows XP visual system from the 2006 site.
- The online audience sees the same synchronized Mux or YouTube program source as the stage display.
- The chat retains Supabase realtime delivery, recovery, slow mode, reactions, and polls while rendering as an AIM chat room.
- The stage display is designed for a 16:9 room screen and keeps a large cue clock visible below the program image.
- Local preview mode works without Supabase or Mux credentials and clearly identifies itself as a preview.
- New database setup defaults to manual playout until the real run times and media IDs are approved.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without credentials, the app renders a branded program-feed preview and keeps chat messages local to the current page.

For production, configure:

- Supabase URL, anonymous key, and service-role key
- Mux API and signing credentials
- admin password hash and a 32+ character session secret
- YouTube API key if the public playlist shelf is enabled

Run the SQL migrations in numerical order and enable Supabase Realtime for `messages`, `message_reactions`, `current_stream`, `polls`, and `poll_votes`.

## Verification

```bash
npm run build
npm run test:showtime
```

The production build is credential-independent. Runtime administration still refuses operations that require missing secrets.

## Production inputs still needed

- show date, start time, and timezone
- final duration for every cue and transition
- Mux playback/asset IDs or approved YouTube sources
- final countdown order and poll wording
- caption files and the audio-description plan for each prerecorded asset
- operator fallback policy for a failed live feed, failed video, or network interruption

The original `showtime.yaml` remains an upstream scheduling-engine fixture. Do not switch production into schedule mode until it has been replaced with the approved 2006 timings and media. Manual playout is the safe default meanwhile.

## Repository remotes

The project repository is `origin`; the source repository remains available as `upstream`. GitHub does not allow one account to own both a repository and its native fork, so this repository preserves the complete `after-party` history without being part of GitHub's fork network.

```bash
git fetch upstream
git merge upstream/main
```
