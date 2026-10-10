-- Audience moments: the operator pushes a one-off beat (Clippy line, window
-- opening, vote nudge) to every online viewer at once. Stored on the single
-- current_stream row so it rides the existing realtime UPDATE feed and the
-- /api/current poll that late joiners and reconnecting clients already use.
--
-- Shape: { id, message, action, actionLabel, autoOpen, sentAt, cleared? }.
-- A clear is written as { id, sentAt, cleared: true } so clients can order it.

ALTER TABLE public.current_stream
  ADD COLUMN IF NOT EXISTS audience_moment jsonb;

COMMENT ON COLUMN public.current_stream.audience_moment IS
  'Latest operator-pushed audience moment (see lib/audience-moments.ts). A clear is stored as a cleared marker.';
