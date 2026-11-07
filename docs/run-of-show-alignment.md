# Run of show alignment

Working note, November 7, 2026. Compares MK’s run-of-show document (supplied in chat) with what the site does today, so the online experience can be brought to the state MK designed. It is a planning document: it does not approve timings, media or deployment.

## MK’s rundown

| # | Segment | Room | Online / screens |
| --- | --- | --- | --- |
| — | Pre-show loop | Long intro that reminds people to vote several times | Same loop |
| 1 | Welcome | In-person Jen welcomes the room | Sprite Jen welcomes the at-home audience on the TV and announces **VOTING IS NOW CLOSED** |
| — | Ads 1 | We’ll Be Right Back #1, Ellen, Booty Booty Booty Booty | Same |
| 2 | Rules of the Game | In-person Lip preps the rules | Sprite Lip sets the online audience up to click around. Spec: `docs/rules-of-the-game.md` |
| — | Ads 2 | We’ll Be Right Back #2, First Gorillas Cut, Commercials, First Yongoo Cut | Same |
| — | **Video #5** | Sprite Emma presents | Same |
| 3 | Clippy | In-person Clippy encourages an attendee to try the essay | Virtual Clippy: puppet-Clippy video, plus real Clippy animation with Yongoo’s catchphrases triggered by typing |
| — | Ads 3 | We’ll Be Right Back #3, Second Yongoo Cut, MK Ring Tones One, *insert here*, Second Gorillas Cut | Same |
| — | **Video #4** | Sprite Yongoo presents | Same |
| 4 | People We Know | Watch and react | Sprites present “our information” |
| — | Ads 4 | We’ll Be Right Back #4, Third Gorillas, Last Yongoo, *insert here* | Same |
| — | **Video #3** | Sprite Jen presents | Same |
| 5 | Emma, our foreign correspondent | Emma takes one person on a journey | The recorded Emma/Jen version on screens and at home |
| — | Ads 5 | Crazy Post Emma Ads #1, Fourth Gorillas, Crazy Post Emma Ads #2, MK Ring Tones Two, Crazy Post Emma Ads #3 | Same |
| — | Something Went Wrong | Screen and sound, then cut to: | Same |
| 6 | Life Is A Highway | Cast lip-syncs to the recorded edit from opposite sides of the room; flashlight on whoever is talking | The edit plays |
| — | Ads 6 | Urgent News Bulletin: news mash-up with silly adult commercials | Same |
| — | **Video #2** | Sprite MK presents | Same |
| 7 | Let’s Check Our Scores | Built as a timed scene (`docs/check-our-scores.md`): live superlative totals, the countdown so far and tonight’s essays on `/event` and `/stage`. Migration 030 not yet installed in production | Mid-show “check our scores” window before the last round | Install 030; rehearse readability on the room TV |
| — | Ads 7 | We’ll Be Right Back with your #1 Video, Last Gorillas, *insert here* ×2 | Same |
| — | **Video #1** | Sprite Lip presents | Same |
| 8 | When We Were Young | Performed live | Same video in both places |
| — | Ending loop video | | Same |

“Sprites” are the cast members’ avatars as they appear on the website.

| Sprite | Screen name |
| --- | --- |
| MK | `mkashe9` |
| Jen | `SBconfetti` |
| Lip | `x0x_BlueShellVictim_x0x` |
| Yongoo | `neodafunky` |
| Emma | `EmmaIsNine` |
| Alec | `bbulldogs48` (Tech) |

## Decisions from this pass

- Segment 2 **Rules of the Game** is the feature filed as “Rules Of Life” (issue #2). Spec: `docs/rules-of-the-game.md`.
- **Sprites** are the site avatars, not separately recorded media.
- Countdown title cards (issue #3) gain a **presenter Sprite**: e.g. Sprite Emma’s avatar with “Sprite Emma presents… And now time for video #5”. The operator picks the presenter in the countdown editor.
- Clippy (issue #4): during the Clippy segment the **main player shows a puppet-Clippy video** (queue media) lasting the whole segment, so guests who skip the essay still have something to watch. The **site’s Clippy widget** says the catchphrases live Clippy (Yongoo) uses in the room, triggered while the guest types. **What else, Clippy?** stays as a manual extra.
- Essay **Submit** sends the essay to the server and **auto-publishes** it (basic profanity/link filtering only) so it can be linked from Let’s Check Our Scores. Published essays show the writer’s screen name. Writers **cannot** delete a submission; only the operator can hide one.
- Sprite presentations at Welcome and People We Know are **tracked separately**, not built yet.
- **Trivia stays.** Questions run **during ad breaks** in a separate window while the ad plays. They must never cover or interrupt the video.
- **Let’s Check Our Scores** shows **live superlative vote totals**, and the **room TV (`/stage`) shows the same window**.
- **Something Went Wrong** is a pre-made media file queued before Life Is A Highway. No site work.
- The final song is **When We Were Young**.

## Gaps: site vs. MK’s design

### Already aligned

- **Countdown is #5 → #1.** The countdown editor supports exactly #5–#1, so the handoff’s concern about #10–#6 no longer applies.
- **Title cards** “And now time for video #N” exist for every countdown cue (presenter still missing, below).
- **Superlatives** are open during the show through the game desk.
- **Hold screen** covers the pre-show and ending loops if those are loaded as hold media or queued cues; the offline room player has its own hold file.
- **Ads** are ordinary queued media. The lists above are a media/queue-building task, not code.

### Needs changes

| Area | Today | MK’s design | Work |
| --- | --- | --- | --- |
| Working rundown | Done: `lib/run-of-show.ts` now follows the rundown above (23 entries, labels and surfaces only). The offline room player’s `tools/room-player/starter-show.json` still has the older sequence | The rundown above | Update the room player’s starter rundown separately if wanted. Its local `.room-player/` copy is the operator’s and is never overwritten |
| TRL voting | Done: `docs/show-game.md` now runs TRL before the show. Guests see closed TRL clearly and land on open games. The game desk suggests the #5–#1 countdown order and confirms before revealing TRL results mid-show | Voting closes before the show; Welcome announces it closed; the countdown reveals results | Rehearse the Welcome → video #5 window for building the countdown cues |
| Rules of the Game | Built: scene cue type (028, installed in production), operator queue action, stage card, Sprite lineup, catchphrase bubbles (awaiting MK’s lines and audio) and the auto-starting tour (draft copy), and the Dock icon / Extras button after it airs | Segment 2 | `docs/rules-of-the-game.md` (issue #2). 028 installed and catalog-verified in production November 7; guest/operator UI rehearsal remains |
| Title-card presenter | Done: **Presented by** in the countdown editor, defaulting to the run of show (#5 Emma, #4 Yongwoo, #3 Jen, #2 MK, #1 Lip); the title card shows the Sprite and “Sprite X presents…”. Migration 031 not yet installed in production | “Sprite X presents” for each video | Install 031 |
| Clippy typing triggers | Lines cycle only via **What else, Clippy?** | Live Clippy’s catchphrases triggered by typing | Rate-limited triggers from essay typing (e.g. on pauses / word counts). Must not steal focus or interrupt typing, and must respect reduced motion. Needs live Clippy’s catchphrase list (MK will send) |
| Puppet Clippy video | — | Puppet-Clippy video in the main player for the whole Clippy segment | Queue media; no code. Needs the file and its exact length |
| Essay submission | Done: `docs/essays.md`. Submit publishes with screen-name credit, one per guest per night, operator Hide/Restore on `/admin/game`. Migration 029 not yet installed in production | **Submit** publishes; Let’s Check Our Scores links to submissions | Install 029; then build Let’s Check Our Scores on `GET /api/essays` |
| Let’s Check Our Scores | Final awards reveal exists at end of show only | Mid-show “check our scores” window before the last round | Operator-triggered audience window with superlative standings, countdown lineup so far (#5–#2), and submitted-essay links. Live vote totals. The same window on `/stage` for the room |
| Something Went Wrong | — | Glitch screen and sound before Life Is A Highway | Queue media only |
| Trivia | Done: the trivia popup is a non-modal floating window that stays clear of the player and captions (collapses to a chip if there is no room), and phones stay on Watch. `docs/show-game.md` covers opening trivia during ad blocks | During ad breaks, in a separate window while the ad plays | Decide which ad breaks carry trivia and the questions |
| Sprite scenes (Welcome, People We Know) | — | Sprites present online | Separate issues. The scene cue type from Rules of the Game should be general enough to reuse |
| Final song | Done: rundown says “When We Were Young” | “When We Were Young” | — |

## Open inputs from MK

Answered with MK on November 7, 2026: cast mapping, trivia, scores visibility and room display, puppet Clippy, Something Went Wrong, essay deletion and credit, final song title. Still to come from MK:

1. A catchphrase for each Sprite, plus recordings from all six.
2. Live Clippy’s catchphrase list.
3. Missing profiles (Jen, Yongoo, Emma, Alec) and Emma’s away message.
4. Rules of the Game tour script and segment length (see `docs/rules-of-the-game.md`).
5. Which ad breaks carry trivia, and the questions.
6. The media files: puppet Clippy, Something Went Wrong, ads, and the pre-show and ending loops.
