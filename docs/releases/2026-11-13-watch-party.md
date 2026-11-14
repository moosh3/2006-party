# November 13, 2026 show release

This source snapshot records the show version deployed as `dpl_A5jWkfqp5jqC7T84rn7jpQcgEieD` at `https://2006theyeartheshow.live`. The deployment was uploaded from local source before these changes were committed to Git. Its parent deployment was `dpl_FoUTt5nj2hoLKnjkd6D1fRsRztXP`.

Included: the simplified game desk, nightly trivia ordering, cast catchphrases and character profiles, countdown presentation, automatic projector profiles and results, and looping Rules/results music. The web tutorial remains interactive. Admin monitors stay silent.

The projector uses `/stage` and follows the online show. The independent offline room player is a separate system. This history sync does not execute database migrations, change queue state, reset votes, or change local playback. The expanded three-panel profile idea was deferred and is not included.

Validation performed for the release: production build with lint and type checks; scene cue, scene clock, scene music, scores and party-results tests; browser audio playback, pause/resume, scene switching and results-loop checks; production page health and byte-for-byte audio/sprite asset checks. Physical projector and speaker setup still requires rehearsal at the venue.

The snapshot was compared against the saved 482-file release manifest when synchronizing Git on November 14. Generated `next-env.d.ts` remains ignored and is recreated by Next.js. Unreleased preview/offline-player edits in the development checkout were preserved separately.
