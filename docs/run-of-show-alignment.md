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
| 7 | Let’s Check Our Scores | Mario Party style. In-room attendee reads their essay; Alec reads audience submissions if time allows | A window pops open with superlative standings, the current video lineup, and links to submitted essays |
| — | Ads 7 | We’ll Be Right Back with your #1 Video, Last Gorillas, *insert here* ×2 | Same |
| — | **Video #1** | Sprite Lip presents | Same |
| 8 | When We Were Young | Performed live | Same video in both places |
| — | Ending loop video | | Same |

“Sprites” are the cast members’ avatars as they appear on the website.

## Decisions from this pass

- Segment 2 **Rules of the Game** is the feature filed as “Rules Of Life” (issue #2). Spec: `docs/rules-of-the-game.md`.
- **Sprites** are the site avatars, not separately recorded media.
- Countdown title cards (issue #3) gain a **presenter Sprite**: e.g. Sprite Emma’s avatar with “Sprite Emma presents… And now time for video #5”. The operator picks the presenter in the countdown editor.
- Clippy (issue #4) gains **typing-triggered Yongoo catchphrases**. **What else, Clippy?** stays as a manual extra.
- Essay **Submit** sends the essay to the server and **auto-publishes** it (basic profanity/link filtering only) so it can be linked from Let’s Check Our Scores.
- Sprite presentations at Welcome and People We Know are **tracked separately**, not built yet.

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
| TRL voting | `docs/show-game.md` runs TRL rounds during the show and picks the winner from a final in-show round | Voting closes before the show; Welcome announces it closed; the countdown reveals results | Confirm the operator flow: open TRL rounds pre-show (doors open), close at Welcome. Update the guide. Check that guest UI reads “closed” clearly afterwards |
| Rules of the Game | Not built | Segment 2 | `docs/rules-of-the-game.md` (issue #2) |
| Title-card presenter | Card has no presenter | “Sprite X presents” for each video | Add optional presenter to `CountdownCue`, editor field, avatar + line on the card. Touches the shipped 027 work, so the database change must build on 027 |
| Clippy typing triggers | Lines cycle only via **What else, Clippy?** | Yongoo’s catchphrases triggered by typing | Rate-limited triggers from essay typing (e.g. on pauses / word counts). Must not steal focus or interrupt typing, and must respect reduced motion. Needs Yongoo’s catchphrase list |
| Puppet Clippy video | — | Video of puppet Clippy in the Clippy segment | Queue media, unless it should play inside the Clippy helper; confirm |
| Essay submission | Drafts live only in the viewer’s browser; no server submission | **Submit** publishes; Let’s Check Our Scores links to submissions | New table + API + filtering, Submit button and confirmation, operator ability to hide an essay after the fact. Auto-publish means there is no moderation queue — keep an admin hide control |
| Let’s Check Our Scores | Final awards reveal exists at end of show only | Mid-show “check our scores” window before the last round | Operator-triggered audience window with superlative standings, countdown lineup so far (#5–#2), and submitted-essay links. Room version may be stage card/video. Decide whether standings reveal live totals or only leaders |
| Something Went Wrong | — | Glitch screen and sound before Life Is A Highway | Likely a queued media cue; confirm it isn’t a site-wide “broken” effect |
| Trivia | Supported, with SuperFan award | Not mentioned in MK’s rundown | Confirm whether trivia stays in the show |
| Sprite scenes (Welcome, People We Know) | — | Sprites present online | Separate issues. The scene cue type from Rules of the Game should be general enough to reuse |
| Final song | Rundown says “When You Were Young” | “When We Were Young” | Confirm the title |

## Open questions for MK

1. Screen-name → cast mapping (Jen, Lip, Emma, Yongoo, MK; is `bbulldogs48` Alec?).
2. Does trivia stay in the show, and where?
3. Let’s Check Our Scores: live vote totals, or leaders only? Does the room screen show the same window?
4. Puppet Clippy: queue video, or inside the Clippy helper?
5. Something Went Wrong: a media file, or something the site does?
6. Yongoo’s catchphrase list for Clippy.
7. “When We Were Young” or “When You Were Young”?
8. Can essay authors remove their own submission? Should essays show screen names?
