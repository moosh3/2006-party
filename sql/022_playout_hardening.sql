-- Server-authoritative manual playout. Browser ended events are hints only:
-- get_playout_snapshot() advances exclusively when the database clock is due.
-- All queue/timeline writers share the same advisory-lock -> row-lock order.
BEGIN;

-- Mux reports fractional seconds. Rounding to the inherited integer column
-- can cut off a frame/segment; retain the full asset duration instead.
ALTER TABLE public.mux_items ALTER COLUMN duration_seconds TYPE numeric USING duration_seconds::numeric;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mux_items'::regclass
    AND conname = 'mux_items_duration_finite_positive') THEN
    ALTER TABLE public.mux_items ADD CONSTRAINT mux_items_duration_finite_positive
      CHECK (duration_seconds IS NULL OR (duration_seconds > 0
        AND duration_seconds::text NOT IN ('NaN', 'Infinity', '-Infinity'))) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.current_stream
  ADD COLUMN IF NOT EXISTS playback_session_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS playback_revision bigint NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.playout_commands (
  command_id text PRIMARY KEY CHECK (length(command_id) BETWEEN 1 AND 200),
  action text NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.playout_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.playout_commands FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.playout_commands TO service_role;

CREATE OR REPLACE FUNCTION public.update_playback_elapsed()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  changed boolean;
  new_occurrence boolean;
BEGIN
  new_occurrence := OLD.playback_id IS DISTINCT FROM NEW.playback_id
    OR OLD.source_type IS DISTINCT FROM NEW.source_type
    OR OLD.playout_mode IS DISTINCT FROM NEW.playout_mode
    OR OLD.hold_screen_enabled IS DISTINCT FROM NEW.hold_screen_enabled
    OR (NEW.hold_screen_enabled AND OLD.hold_screen_mux_item_id IS DISTINCT FROM NEW.hold_screen_mux_item_id)
    OR (OLD.last_command_id IS DISTINCT FROM NEW.last_command_id AND NEW.last_playback_command IN
      ('restart', 'set_video', 'queue_advance', 'hold_screen_enable', 'hold_screen_disable', 'queue_exhausted'));
  changed := new_occurrence
    OR OLD.playback_state IS DISTINCT FROM NEW.playback_state
    OR OLD.playback_position IS DISTINCT FROM NEW.playback_position
    OR OLD.playback_updated_at IS DISTINCT FROM NEW.playback_updated_at;
  IF changed THEN
    -- Explicit anchors are used by catch-up: a late tick must start the next
    -- cue at its ORIGINAL due time, not at the moment somebody opens the page.
    IF NEW.playback_updated_at IS NOT DISTINCT FROM OLD.playback_updated_at THEN
      NEW.playback_updated_at := clock_timestamp();
    END IF;
    NEW.playback_revision := COALESCE(OLD.playback_revision, 0) + 1;
    NEW.playback_session_id := CASE WHEN new_occurrence THEN gen_random_uuid() ELSE OLD.playback_session_id END;
  ELSE
    NEW.playback_updated_at := OLD.playback_updated_at;
    NEW.playback_revision := OLD.playback_revision;
    NEW.playback_session_id := OLD.playback_session_id;
  END IF;
  -- This legacy column is never a clock. Responses compute elapsed from the
  -- database's current time; persisting elapsed here freezes subsequent reads.
  NEW.playback_elapsed_ms := 0;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS compute_playback_elapsed ON public.current_stream;
CREATE TRIGGER compute_playback_elapsed BEFORE UPDATE ON public.current_stream
FOR EACH ROW EXECUTE FUNCTION public.update_playback_elapsed();
UPDATE public.current_stream SET playback_elapsed_ms = 0
WHERE playback_elapsed_ms IS DISTINCT FROM 0;

CREATE OR REPLACE FUNCTION public.playout_live_position(s public.current_stream, at_time timestamptz)
RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT GREATEST(0, COALESCE(s.playback_position, 0)) +
    CASE WHEN s.playback_state = 'playing'
      THEN GREATEST(0, EXTRACT(epoch FROM at_time - COALESCE(s.playback_updated_at, at_time)))
      ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.playout_command_replay(c_id text, c_action text, c_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE prior public.playout_commands%ROWTYPE;
BEGIN
  IF c_id IS NULL OR length(c_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A command ID of 1 to 200 characters is required';
  END IF;
  SELECT * INTO prior FROM public.playout_commands WHERE command_id = c_id;
  IF FOUND THEN
    IF prior.action IS DISTINCT FROM c_action OR prior.payload IS DISTINCT FROM c_payload THEN
      RAISE EXCEPTION 'Command ID was already used for a different operation';
    END IF;
    RETURN prior.result || jsonb_build_object('duplicate', true,
      'stream', (SELECT to_jsonb(s) FROM public.current_stream s WHERE id = 1));
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_video(mux_item_id uuid, admin_user_id text)
RETURNS json LANGUAGE plpgsql SET search_path = public AS $$
DECLARE media public.mux_items%ROWTYPE; queued public.video_queue%ROWTYPE;
  target_item_id uuid := mux_item_id; next_position integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
  SELECT * INTO media FROM public.mux_items WHERE id = target_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mux item not found'; END IF;
  IF COALESCE(media.source_type, 'mux') <> 'mux' OR COALESCE(media.kind, 'vod') <> 'vod'
    OR COALESCE(media.duration_seconds, 0) <= 0 OR media.duration_seconds::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Queue item must be a Mux VOD with a known positive duration';
  END IF;
  SELECT COALESCE(MAX(position), 0) + 1 INTO next_position FROM public.video_queue;
  INSERT INTO public.video_queue AS q (mux_item_id, position)
    VALUES (target_item_id, next_position) RETURNING q.* INTO queued;
  INSERT INTO public.admin_actions(action_type, admin_user, details)
    VALUES ('queue_add', admin_user_id, jsonb_build_object('mux_item_id', target_item_id, 'position', next_position));
  RETURN (to_jsonb(queued) || jsonb_build_object('mux_items', to_jsonb(media)))::json;
END;
$$;

-- Internal transition, called only while holding the common queue lock.
CREATE OR REPLACE FUNCTION public.playout_advance_at(anchor_at timestamptz, actor text, transition_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE queued public.video_queue%ROWTYPE; media public.mux_items%ROWTYPE; s public.current_stream%ROWTYPE;
BEGIN
  SELECT * INTO queued FROM public.video_queue ORDER BY position, id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO media FROM public.mux_items WHERE id = queued.mux_item_id;
  IF NOT FOUND OR COALESCE(media.source_type, 'mux') <> 'mux'
    OR COALESCE(media.kind, 'vod') <> 'vod' OR COALESCE(media.duration_seconds, 0) <= 0
    OR media.duration_seconds::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Queue item must be a Mux VOD with a known positive duration';
  END IF;
  UPDATE public.current_stream SET
    playback_id = media.playback_id, title = COALESCE(media.label, media.playback_id), kind = 'vod',
    source_type = 'mux', youtube_playlist_id = NULL, source_url = NULL,
    playback_state = 'playing', playback_position = 0, playback_updated_at = anchor_at,
    playback_elapsed_ms = 0, playout_mode = 'manual',
    schedule_early_ended_slot = NULL, schedule_early_ended_at = NULL,
    hold_screen_enabled = false, hold_screen_resume_playback_id = NULL,
    hold_screen_resume_position = NULL, hold_screen_resume_state = NULL,
    auto_advance_in_progress = false, auto_advance_lock_at = NULL,
    updated_at = clock_timestamp(), updated_by = actor,
    last_playback_command = 'queue_advance', last_command_id = transition_id
  WHERE id = 1 RETURNING * INTO s;
  DELETE FROM public.video_queue WHERE id = queued.id;
  -- Sparse positions are valid; retaining them avoids temporary negative
  -- position collisions. Every display/reorder already sorts by position.
  INSERT INTO public.admin_actions(action_type, admin_user, details)
    VALUES ('queue_advance', actor, jsonb_build_object('queue_item_id', queued.id,
      'to_playback_id', media.playback_id, 'to_title', media.label,
      'playback_session_id', s.playback_session_id, 'started_at', anchor_at));
  RETURN jsonb_build_object('success', true, 'playback_id', s.playback_id,
    'title', s.title, 'kind', s.kind, 'source_type', s.source_type, 'stream', to_jsonb(s));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_playout_snapshot()
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  s public.current_stream%ROWTYPE;
  d numeric;
  now_at timestamptz;
  due_at timestamptz;
  state text;
  problem text;
  next_media record;
  transitions integer := 0;
  locked boolean := false;
BEGIN
  -- Most audience reads do not take a write lock. Re-read after locking when
  -- due; another tick/operator may have changed the cue while we waited.
  SELECT * INTO s FROM public.current_stream WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current stream is not configured'; END IF;
  now_at := clock_timestamp();
  LOOP
    d := NULL; due_at := NULL; problem := NULL;
    SELECT duration_seconds INTO d FROM public.mux_items
      WHERE CASE WHEN s.hold_screen_enabled AND s.hold_screen_mux_item_id IS NOT NULL
        THEN id = s.hold_screen_mux_item_id ELSE playback_id = s.playback_id END;
    IF COALESCE(s.playout_mode, 'manual') <> 'manual' THEN state := 'schedule';
    ELSIF s.hold_screen_enabled THEN state := 'holding';
    ELSIF NOT COALESCE(s.auto_advance_enabled, false) THEN state := 'disabled';
    ELSIF s.playback_state <> 'playing' THEN state := 'paused';
    ELSIF COALESCE(s.source_type, 'mux') <> 'mux' THEN state := 'unsupported-source';
    ELSIF COALESCE(s.kind, 'vod') <> 'vod' THEN state := 'live';
    ELSIF COALESCE(d, 0) <= 0 OR d::text IN ('NaN', 'Infinity', '-Infinity') THEN state := 'missing-duration';
    ELSE
      state := 'armed';
      due_at := COALESCE(s.playback_updated_at, now_at) +
        (d - COALESCE(s.playback_position, 0)) * interval '1 second';
    END IF;
    EXIT WHEN state <> 'armed' OR due_at > now_at;
    IF NOT locked THEN
      PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
      SELECT * INTO s FROM public.current_stream WHERE id = 1 FOR UPDATE;
      now_at := clock_timestamp(); locked := true;
      CONTINUE;
    END IF;
    SELECT q.id, m.source_type, m.kind, m.duration_seconds INTO next_media
      FROM public.video_queue q LEFT JOIN public.mux_items m ON m.id = q.mux_item_id
      ORDER BY q.position, q.id LIMIT 1;
    IF FOUND THEN
      IF COALESCE(next_media.source_type, 'mux') <> 'mux'
        OR COALESCE(next_media.kind, 'vod') <> 'vod' OR COALESCE(next_media.duration_seconds, 0) <= 0
        OR next_media.duration_seconds::text IN ('NaN', 'Infinity', '-Infinity') THEN
        state := 'blocked-queue-item';
        problem := 'Next queue item must be a Mux VOD with a known positive duration';
        due_at := NULL; EXIT;
      END IF;
      PERFORM public.playout_advance_at(due_at, 'system:clock', 'clock-' || gen_random_uuid()::text);
      transitions := transitions + 1;
      SELECT * INTO s FROM public.current_stream WHERE id = 1;
      -- Bound work per invocation without abandoning the original timeline.
      IF transitions >= 256 THEN
        SELECT duration_seconds INTO d FROM public.mux_items WHERE playback_id = s.playback_id;
        due_at := s.playback_updated_at + (d - COALESCE(s.playback_position, 0)) * interval '1 second';
        state := CASE WHEN due_at <= now_at THEN 'catching-up' ELSE 'armed' END;
        EXIT;
      END IF;
    ELSE
      UPDATE public.current_stream SET
        hold_screen_enabled = true, playback_state = 'playing', playback_position = 0,
        playback_updated_at = due_at, hold_screen_resume_playback_id = NULL,
        hold_screen_resume_position = NULL, hold_screen_resume_state = NULL,
        playback_id = CASE WHEN hold_screen_mux_item_id IS NULL THEN 'demo-playback-id' ELSE playback_id END,
        title = CASE WHEN hold_screen_mux_item_id IS NULL THEN '2006 — waiting for the program' ELSE title END,
        kind = CASE WHEN hold_screen_mux_item_id IS NULL THEN 'vod' ELSE kind END,
        source_type = CASE WHEN hold_screen_mux_item_id IS NULL THEN 'mux' ELSE source_type END,
        youtube_playlist_id = CASE WHEN hold_screen_mux_item_id IS NULL THEN NULL ELSE youtube_playlist_id END,
        source_url = CASE WHEN hold_screen_mux_item_id IS NULL THEN NULL ELSE source_url END,
        last_playback_command = 'queue_exhausted', last_command_id = 'hold-' || gen_random_uuid()::text,
        updated_at = clock_timestamp(), updated_by = 'system:clock'
      WHERE id = 1 RETURNING * INTO s;
      INSERT INTO public.admin_actions(action_type, admin_user, details)
        VALUES ('queue_exhausted', 'system:clock', jsonb_build_object('hold_screen_mux_item_id', s.hold_screen_mux_item_id,
          'playback_session_id', s.playback_session_id, 'started_at', due_at));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('stream', to_jsonb(s), 'server_now', now_at,
    'playback_duration_seconds', d, 'next_transition_at', due_at,
    'automation_status', state, 'automation_error', problem);
END;
$$;

CREATE OR REPLACE FUNCTION public.playback_command(
  command_action text, command_position numeric DEFAULT NULL, command_id text DEFAULT NULL,
  admin_user_id text DEFAULT 'system:operator', expected_session_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.current_stream%ROWTYPE; d numeric; pos numeric; now_at timestamptz;
  payload jsonb; prior jsonb; result jsonb; c_id text := COALESCE(command_id, 'command-' || gen_random_uuid()::text);
BEGIN
  IF command_action IS NULL OR command_action NOT IN ('play', 'pause', 'seek', 'restart') THEN RAISE EXCEPTION 'Invalid playback action'; END IF;
  IF command_position IS NOT NULL AND (command_position < 0 OR command_position::text IN ('NaN', 'Infinity', '-Infinity')) THEN
    RAISE EXCEPTION 'Position must be a finite non-negative number';
  END IF;
  IF command_action = 'seek' AND command_position IS NULL THEN RAISE EXCEPTION 'A seek position is required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
  SELECT * INTO s FROM public.current_stream WHERE id = 1 FOR UPDATE;
  payload := jsonb_build_object('action', command_action, 'position', command_position,
    'actor', admin_user_id, 'session', expected_session_id);
  prior := public.playout_command_replay(c_id, 'playback', payload);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF expected_session_id IS NOT NULL AND s.playback_session_id <> expected_session_id THEN
    RAISE EXCEPTION 'Playback has changed; reload before applying this command';
  END IF;
  IF COALESCE(s.playout_mode, 'manual') <> 'manual' THEN RAISE EXCEPTION 'Schedule mode is active'; END IF;
  IF s.hold_screen_enabled THEN RAISE EXCEPTION 'Hold screen is active'; END IF;
  now_at := clock_timestamp();
  SELECT duration_seconds INTO d FROM public.mux_items WHERE playback_id = s.playback_id;
  pos := CASE WHEN command_action = 'restart' THEN 0
    ELSE COALESCE(command_position, public.playout_live_position(s, now_at)) END;
  IF command_position IS NOT NULL AND d > 0 AND pos > d THEN RAISE EXCEPTION 'Position exceeds video duration'; END IF;
  IF d > 0 THEN pos := LEAST(pos, d); END IF;
  UPDATE public.current_stream SET
    playback_state = CASE WHEN command_action = 'pause' THEN 'paused'
      WHEN command_action IN ('play', 'restart') THEN 'playing' ELSE playback_state END,
    playback_position = pos, playback_updated_at = now_at,
    last_playback_command = command_action, last_command_id = c_id,
    updated_at = now_at, updated_by = admin_user_id
  WHERE id = 1 RETURNING * INTO s;
  result := jsonb_build_object('success', true, 'stream', to_jsonb(s));
  INSERT INTO public.playout_commands VALUES(c_id, 'playback', payload, result, now_at);
  INSERT INTO public.admin_actions(action_type, admin_user, details)
    VALUES ('playback_' || command_action, admin_user_id, jsonb_build_object('command_id', c_id, 'position', pos));
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_manual_stream(
  new_playback_id text, new_title text, new_kind text DEFAULT 'vod', new_source_type text DEFAULT 'mux',
  new_youtube_playlist_id text DEFAULT NULL, new_source_url text DEFAULT NULL,
  admin_user_id text DEFAULT 'system:operator', command_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.current_stream%ROWTYPE; payload jsonb; prior jsonb; result jsonb;
  now_at timestamptz; c_id text := COALESCE(command_id, 'set-' || gen_random_uuid()::text);
BEGIN
  IF new_playback_id IS NULL OR length(new_playback_id) = 0 OR new_title IS NULL OR length(new_title) = 0
    OR new_kind IS NULL OR new_kind NOT IN ('vod', 'live')
    OR new_source_type IS NULL OR new_source_type NOT IN ('mux', 'youtube_playlist') THEN
    RAISE EXCEPTION 'Invalid stream configuration';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
  SELECT * INTO s FROM public.current_stream WHERE id = 1 FOR UPDATE;
  payload := jsonb_build_object('playback_id', new_playback_id, 'title', new_title, 'kind', new_kind,
    'source_type', new_source_type, 'playlist', new_youtube_playlist_id, 'url', new_source_url, 'actor', admin_user_id);
  prior := public.playout_command_replay(c_id, 'set_stream', payload);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF s.auto_advance_enabled AND new_source_type = 'mux' AND new_kind = 'vod'
    AND NOT EXISTS(SELECT 1 FROM public.mux_items WHERE playback_id = new_playback_id AND duration_seconds > 0
      AND duration_seconds::text NOT IN ('NaN', 'Infinity', '-Infinity')) THEN
    RAISE EXCEPTION 'A positive duration is required for automatic playback';
  END IF;
  now_at := clock_timestamp();
  UPDATE public.current_stream SET playback_id = new_playback_id, title = new_title, kind = new_kind,
    source_type = new_source_type, youtube_playlist_id = new_youtube_playlist_id, source_url = new_source_url,
    playback_state = 'playing', playback_position = 0, playback_updated_at = now_at,
    playout_mode = 'manual', schedule_early_ended_slot = NULL, schedule_early_ended_at = NULL,
    hold_screen_enabled = false, hold_screen_resume_playback_id = NULL,
    hold_screen_resume_position = NULL, hold_screen_resume_state = NULL,
    last_playback_command = 'set_video', last_command_id = c_id,
    updated_at = now_at, updated_by = admin_user_id
  WHERE id = 1 RETURNING * INTO s;
  result := jsonb_build_object('success', true, 'stream', to_jsonb(s));
  INSERT INTO public.playout_commands VALUES(c_id, 'set_stream', payload, result, now_at);
  INSERT INTO public.admin_actions(action_type, admin_user, details)
    VALUES ('stream_change', admin_user_id, payload || jsonb_build_object('command_id', c_id));
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_hold(action text, mux_item_id uuid DEFAULT NULL,
  admin_user_id text DEFAULT 'system:operator', command_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.current_stream%ROWTYPE; payload jsonb; prior jsonb; result jsonb;
  now_at timestamptz; pos numeric; c_id text := COALESCE(command_id, 'hold-' || gen_random_uuid()::text);
BEGIN
  IF action IS NULL OR action NOT IN ('enable', 'disable', 'set_item') THEN RAISE EXCEPTION 'Invalid hold screen action'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
  SELECT * INTO s FROM public.current_stream WHERE id = 1 FOR UPDATE;
  payload := jsonb_build_object('action', action, 'mux_item_id', mux_item_id, 'actor', admin_user_id);
  prior := public.playout_command_replay(c_id, 'hold', payload);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF action <> 'set_item' AND COALESCE(s.playout_mode, 'manual') <> 'manual' THEN RAISE EXCEPTION 'Schedule mode is active'; END IF;
  now_at := clock_timestamp();
  IF action = 'set_item' THEN
    IF NOT EXISTS (SELECT 1 FROM public.mux_items WHERE id = mux_item_id
      AND COALESCE(source_type, 'mux') IN ('mux', 'youtube_playlist')) THEN RAISE EXCEPTION 'Media item not found'; END IF;
    UPDATE public.current_stream SET hold_screen_mux_item_id = mux_item_id,
      playback_position = CASE WHEN hold_screen_enabled THEN 0 ELSE playback_position END,
      playback_updated_at = CASE WHEN hold_screen_enabled THEN now_at ELSE playback_updated_at END,
      last_playback_command = 'hold_screen_set_item', last_command_id = c_id,
      updated_at = now_at, updated_by = admin_user_id WHERE id = 1 RETURNING * INTO s;
  ELSIF action = 'enable' AND NOT s.hold_screen_enabled THEN
    pos := public.playout_live_position(s, now_at);
    UPDATE public.current_stream SET hold_screen_enabled = true,
      hold_screen_resume_playback_id = playback_id, hold_screen_resume_position = pos,
      hold_screen_resume_state = playback_state, playback_state = 'playing', playback_position = 0,
      playback_updated_at = now_at, last_playback_command = 'hold_screen_enable', last_command_id = c_id,
      updated_at = now_at, updated_by = admin_user_id WHERE id = 1 RETURNING * INTO s;
  ELSIF action = 'disable' AND s.hold_screen_enabled THEN
    UPDATE public.current_stream SET hold_screen_enabled = false,
      playback_id = COALESCE(hold_screen_resume_playback_id, 'demo-playback-id'),
      title = CASE WHEN hold_screen_resume_playback_id IS NULL THEN '2006 — waiting for the program' ELSE title END,
      kind = CASE WHEN hold_screen_resume_playback_id IS NULL THEN 'vod' ELSE kind END,
      source_type = CASE WHEN hold_screen_resume_playback_id IS NULL THEN 'mux' ELSE source_type END,
      youtube_playlist_id = CASE WHEN hold_screen_resume_playback_id IS NULL THEN NULL ELSE youtube_playlist_id END,
      source_url = CASE WHEN hold_screen_resume_playback_id IS NULL THEN NULL ELSE source_url END,
      playback_state = COALESCE(hold_screen_resume_state, 'paused'),
      playback_position = COALESCE(hold_screen_resume_position, 0), playback_updated_at = now_at,
      hold_screen_resume_playback_id = NULL, hold_screen_resume_position = NULL, hold_screen_resume_state = NULL,
      last_playback_command = 'hold_screen_disable', last_command_id = c_id,
      updated_at = now_at, updated_by = admin_user_id WHERE id = 1 RETURNING * INTO s;
  END IF;
  result := jsonb_build_object('success', true, 'stream', to_jsonb(s));
  INSERT INTO public.playout_commands VALUES(c_id, 'hold', payload, result, now_at);
  INSERT INTO public.admin_actions(action_type, admin_user, details)
    VALUES ('hold_screen_' || action, admin_user_id, payload || jsonb_build_object('command_id', c_id));
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_queue_command(admin_user_id text, command_id text, expected_session_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.current_stream%ROWTYPE; prior jsonb; result jsonb; payload jsonb; now_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
  SELECT * INTO s FROM public.current_stream WHERE id = 1 FOR UPDATE;
  payload := jsonb_build_object('actor', admin_user_id, 'session', expected_session_id);
  prior := public.playout_command_replay(command_id, 'advance', payload);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF expected_session_id IS NOT NULL AND s.playback_session_id <> expected_session_id THEN
    RAISE EXCEPTION 'Playback has changed; reload before applying this command';
  END IF;
  now_at := clock_timestamp();
  result := public.playout_advance_at(now_at, admin_user_id, command_id);
  IF result IS NULL THEN RAISE EXCEPTION 'No videos in queue'; END IF;
  INSERT INTO public.playout_commands VALUES(command_id, 'advance', payload, result, now_at);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_queue_next(admin_user_id text)
RETURNS json LANGUAGE sql SET search_path = public AS $$
  SELECT public.advance_queue_command(admin_user_id, 'next-' || gen_random_uuid()::text)::json;
$$;

CREATE OR REPLACE FUNCTION public.set_auto_advance(enabled boolean,
  admin_user_id text DEFAULT 'system:operator', command_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.current_stream%ROWTYPE; prior jsonb; result jsonb; payload jsonb; now_at timestamptz;
  c_id text := COALESCE(command_id, 'auto-' || gen_random_uuid()::text);
BEGIN
  IF enabled IS NULL THEN RAISE EXCEPTION 'Enabled must be a boolean'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
  SELECT * INTO s FROM public.current_stream WHERE id = 1 FOR UPDATE;
  payload := jsonb_build_object('enabled', enabled, 'actor', admin_user_id);
  prior := public.playout_command_replay(c_id, 'auto_advance', payload);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF enabled THEN
    IF EXISTS (SELECT 1 FROM public.video_queue q LEFT JOIN public.mux_items m ON m.id = q.mux_item_id
      WHERE COALESCE(m.source_type, 'mux') <> 'mux' OR COALESCE(m.kind, 'vod') <> 'vod' OR COALESCE(m.duration_seconds, 0) <= 0
        OR m.duration_seconds::text IN ('NaN', 'Infinity', '-Infinity')) THEN
      RAISE EXCEPTION 'Queue item must be a Mux VOD with a known positive duration';
    END IF;
    IF NOT s.hold_screen_enabled AND s.playback_id <> 'demo-playback-id' AND COALESCE(s.playout_mode, 'manual') = 'manual'
      AND (COALESCE(s.source_type, 'mux') <> 'mux' OR COALESCE(s.kind, 'vod') <> 'vod'
        OR NOT EXISTS (SELECT 1 FROM public.mux_items WHERE playback_id = s.playback_id AND duration_seconds > 0
          AND duration_seconds::text NOT IN ('NaN', 'Infinity', '-Infinity'))) THEN
      RAISE EXCEPTION 'A positive duration is required for automatic playback of a Mux VOD';
    END IF;
  END IF;
  now_at := clock_timestamp();
  UPDATE public.current_stream SET auto_advance_enabled = enabled,
    updated_at = now_at, updated_by = admin_user_id WHERE id = 1 RETURNING * INTO s;
  result := jsonb_build_object('success', true, 'stream', to_jsonb(s));
  INSERT INTO public.playout_commands VALUES(c_id, 'auto_advance', payload, result, now_at);
  INSERT INTO public.admin_actions(action_type, admin_user, details)
    VALUES ('auto_advance_toggle', admin_user_id, payload || jsonb_build_object('command_id', c_id));
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_mux_item(item_id uuid,
  admin_user_id text DEFAULT 'system:operator')
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.current_stream%ROWTYPE; media public.mux_items%ROWTYPE;
BEGIN
  -- Catalog deletion and enqueue/advance must share a transaction boundary.
  -- Otherwise the FK cascade could remove a cue queued after an API precheck,
  -- or an asset could lose its duration just as it becomes the active stream.
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
  SELECT * INTO s FROM public.current_stream WHERE id = 1 FOR UPDATE;
  SELECT * INTO media FROM public.mux_items WHERE id = item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Media item not found'; END IF;
  IF s.playback_id = media.playback_id OR s.hold_screen_mux_item_id = item_id
    OR s.hold_screen_resume_playback_id = media.playback_id THEN
    RAISE EXCEPTION 'Cannot delete an active, configured hold, or resumable stream. Select another item first.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.video_queue WHERE mux_item_id = item_id) THEN
    RAISE EXCEPTION 'Remove this item from the queue before deleting it.';
  END IF;
  DELETE FROM public.mux_items WHERE id = item_id;
  INSERT INTO public.admin_actions(action_type, admin_user, details)
    VALUES ('media_delete', admin_user_id, jsonb_build_object('item_id', item_id,
      'playback_id', media.playback_id, 'label', media.label));
  RETURN jsonb_build_object('success', true, 'itemId', item_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_playout_mode(mode text,
  admin_user_id text DEFAULT 'system:operator', command_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.current_stream%ROWTYPE; prior jsonb; result jsonb; payload jsonb;
  now_at timestamptz; pos numeric; d numeric;
  c_id text := COALESCE(command_id, 'mode-' || gen_random_uuid()::text);
BEGIN
  IF mode IS NULL OR mode NOT IN ('manual', 'schedule') THEN RAISE EXCEPTION 'Mode must be manual or schedule'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
  SELECT * INTO s FROM public.current_stream WHERE id = 1 FOR UPDATE;
  payload := jsonb_build_object('mode', mode, 'actor', admin_user_id);
  prior := public.playout_command_replay(c_id, 'mode', payload);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  now_at := clock_timestamp();
  IF COALESCE(s.playout_mode, 'manual') IS DISTINCT FROM mode THEN
    -- Schedule is derived separately from DB time. Freeze the manual cue
    -- before leaving it; returning to manual must not resurrect an old video
    -- as though it had been playing throughout the entire scheduled event.
    pos := CASE WHEN s.playout_mode = 'manual'
      THEN public.playout_live_position(s, now_at) ELSE COALESCE(s.playback_position, 0) END;
    SELECT duration_seconds INTO d FROM public.mux_items
      WHERE CASE WHEN s.hold_screen_enabled AND s.hold_screen_mux_item_id IS NOT NULL
        THEN id = s.hold_screen_mux_item_id ELSE playback_id = s.playback_id END;
    IF d > 0 AND d::text NOT IN ('NaN', 'Infinity', '-Infinity') THEN
      pos := CASE WHEN s.hold_screen_enabled THEN mod(pos, d) ELSE LEAST(pos, d) END;
    END IF;
    UPDATE public.current_stream SET playout_mode = mode,
      playback_position = pos, playback_state = 'paused', playback_updated_at = now_at,
      schedule_early_ended_slot = NULL, schedule_early_ended_at = NULL,
      last_playback_command = 'mode_change', last_command_id = c_id,
      updated_at = now_at, updated_by = admin_user_id WHERE id = 1 RETURNING * INTO s;
  END IF;
  result := jsonb_build_object('success', true, 'stream', to_jsonb(s));
  INSERT INTO public.playout_commands VALUES(c_id, 'mode', payload, result, now_at);
  INSERT INTO public.admin_actions(action_type, admin_user, details)
    VALUES ('playout_mode', admin_user_id, payload || jsonb_build_object('command_id', c_id));
  RETURN result;
END;
$$;

-- Public clients may observe realtime state, never mutate it. API handlers
-- use the server-only service key; a signed application session is not a
-- Supabase JWT and cannot safely be enforced by the former permissive RLS.
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('current_stream', 'video_queue') AND cmd <> 'SELECT'
  LOOP EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename); END LOOP;
  FOR p IN SELECT oid::regprocedure AS signature FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname IN
      ('get_playout_snapshot', 'playout_live_position', 'playout_command_replay', 'playout_advance_at',
       'playback_command', 'set_manual_stream', 'toggle_hold', 'advance_queue_command', 'advance_queue_next',
       'set_auto_advance', 'set_playout_mode', 'delete_mux_item', 'enqueue_video', 'reorder_queue', 'delete_from_queue')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', p.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', p.signature);
  END LOOP;
END;
$$;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.current_stream, public.video_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.current_stream, public.video_queue TO anon, authenticated;
GRANT ALL ON public.current_stream, public.video_queue, public.mux_items, public.admin_actions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.admin_actions_id_seq TO service_role;
COMMENT ON COLUMN public.current_stream.playback_session_id IS 'Unique playback occurrence; repeated assets and restarts are distinct sessions.';
COMMENT ON COLUMN public.current_stream.playback_revision IS 'Monotonic playback state version; clients must ignore older responses.';
COMMENT ON FUNCTION public.get_playout_snapshot() IS 'Read current DB-clock timeline; atomically catch up due manual queue cues and enter hold when exhausted.';
COMMIT;
