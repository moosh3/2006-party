# Essay submissions

Guests write their 2006 essay in TextEdit (`/event`). **Save Draft** keeps it in that browser only. **Submit essay** publishes it: an inline confirmation explains that the essay is credited to the guest’s sign-on screen name, may be read aloud, and cannot be changed or deleted. After submitting, TextEdit shows the essay read-only, also after a reload.

## Rules

- One submission per guest each time the doors open (“tonight”). Doors must be open; blocked guests cannot submit.
- 10–5,000 characters. Line breaks are fine. The same basic profanity and link filter as game suggestions applies; there is no moderation queue.
- A 5-second throttle per guest stops repeated clicks.
- The operator can **Hide** a published essay on `/admin/game` (Essays section) and **Restore** it. Nothing is deleted; hides and restores are logged in `admin_actions`.

## Data and APIs

- `sql/029_essay_submissions.sql`: `essay_submissions`, `essay_submit`, `essay_set_hidden`. Service role only. Install with `npm run db:essays` (read-only preflight) and `npm run db:essays -- --apply`.
- `GET /api/essays`: tonight’s published essays, oldest first (public, CDN-cached 10 seconds). This is the source for Let’s Check Our Scores.
- `POST /api/essays`: submit (signed-on guest, same origin).
- `GET /api/essays/mine`: the guest’s submission tonight, if any.
- `GET/POST /api/admin/essays`: operator list (newest 300, including hidden) and hide/restore.
- Prompts and text rules: `lib/essays.ts`. Test: `npm run test:essay-db`.

Not built yet: the Let’s Check Our Scores window that links to these essays.
