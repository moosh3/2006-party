# Simple game desk

Music-video voting happens on a separate website. Only trivia and cast superlative voting happen here. The external site's final ranking is used to arrange the countdown videos; this desk does not import votes or choose the music-video winner.

`/admin/game` opens in **Show time**:

1. **On screen:** Jen says “Voting is closed.”, Clippy offers the essay, or Essays gives a last call. Clear message removes it; Resend reaches guests who dismissed it.
2. **Trivia:** Open trivia opens every prepared question together in the list under the video. Guests answer in any order at their own pace. Close trivia & show answers closes all open questions before revealing answers and updating scores. The saved nightly order stays fixed as guests answer.
3. **Superlatives:** Open superlatives opens all prepared categories. Close superlatives closes the open categories. Show superlative results reveals the closed categories when ready. Categories and totals are in a disclosure.

**Finish tonight** is collapsed until needed. Finishing closes all remaining rounds, preserves the night, and offers the final results reveal. It does not stop video playback.

**Setup** holds the show selector, next-night creation and trivia shuffle, cast roster, question editor, individual round controls, suggestion inbox, scoreboards, viewer moderation, and essays. Earlier music-video poll records remain read-only references. Creating new music-video polls is removed from the interface.

Audience games have only **Trivia** and **Superlatives** tabs. The Rules of the Game tour describes the external music-video vote without offering a second voting form. Existing data and API compatibility are preserved; database update 033 removes the legacy one-question limit without changing existing questions, votes, or scores.

Trivia list controls use one authenticated database transaction and can safely repeat after a lost response. Superlative controls use the existing authenticated actions in order. On a failure they stop and reload the actual status before allowing another action. They never roll back completed writes, retry a reveal automatically, or advance playback. The operator can continue from the state shown or use the individual controls in Setup.

For Saturday/Sunday: finish the previous night, open Setup, create the new night using the previous night's shuffled trivia. Save the cast and prepare superlatives for the new night. Only trivia is copied.

Verification: `node --import tsx scripts/test-game-desk.ts`, `npm run test:scene-cues`, the game API fixture, and browser rehearsal. Use only disposable fixtures for votes and mutations.

Nightly shuffle changes only the order of the full list; it never creates a host-paced, one-question-at-a-time quiz. A full list does not trigger successive question popups.

Install update 033 before releasing the list controls: `node --import tsx scripts/apply-trivia-list-db.ts --apply`. Without `--apply` it only checks installation. The installer verifies existing game rows are unchanged. `node --import tsx scripts/test-trivia-list.ts` exercises the migration, full-list answering, score calculation, retries, shuffle, and permissions in disposable PostgreSQL.
