-- Remove event-specific fixtures inherited from after-party. Keep this as a
-- migration so both the first deployed database and future clean installs end
-- in the same 2006-specific state.

DELETE FROM public.polls
WHERE created_by = 'admin-seed'
  AND question IN (
    'What is your favorite Nic Cage quote?',
    'What is your favorite USA quote?',
    'Which Nic Cage film isn''t playing?',
    'What type of marathon are you hoping for next?',
    'Which actor do you think would be better at stealing the Declaration of Independence?',
    'What is the most American activity someone could be doing today?',
    'What is the top choice at the Ice Cream Truck?'
  );

UPDATE public.current_stream
SET
  title = '2006 — waiting for the program',
  playout_mode = 'manual',
  playback_state = 'paused',
  playback_position = 0,
  playback_elapsed_ms = 0,
  updated_at = now()
WHERE id = 1
  AND playback_id = 'demo-playback-id';
