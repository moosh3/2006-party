-- Individual YouTube videos use the SAME finite show queue/timeline as Mux.
-- Playlists remain ambient-only. No downloads, new player clock, or public writes.
-- Replaces only source-sensitive 022 functions; locks, idempotency, session
-- rotation, catch-up deadlines, and operator pause/hold semantics are retained.
-- Applying this migration again never updates an active stream or its anchor.
BEGIN;
DO $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('video_queue_order')); END; $$;

ALTER TABLE public.mux_items DROP CONSTRAINT IF EXISTS mux_items_source_type_check;
ALTER TABLE public.mux_items ADD CONSTRAINT mux_items_source_type_check
  CHECK (source_type IN ('mux', 'youtube_video', 'youtube_playlist'));
ALTER TABLE public.current_stream DROP CONSTRAINT IF EXISTS current_stream_source_type_check;
ALTER TABLE public.current_stream ADD CONSTRAINT current_stream_source_type_check
  CHECK (source_type IN ('mux', 'youtube_video', 'youtube_playlist'));

ALTER TABLE public.mux_items DROP CONSTRAINT IF EXISTS mux_items_youtube_video_shape;
ALTER TABLE public.mux_items ADD CONSTRAINT mux_items_youtube_video_shape CHECK (
  source_type IS DISTINCT FROM 'youtube_video' OR (
    playback_id ~ '^youtube:video:[A-Za-z0-9_-]{11}$' AND COALESCE(kind, '') = 'vod'
    AND youtube_playlist_id IS NULL
    AND source_url = 'https://www.youtube.com/watch?v=' || substring(playback_id FROM 15)
    AND source_url IS NOT NULL AND duration_seconds IS NOT NULL
    AND duration_seconds > 0 AND duration_seconds::text NOT IN ('NaN', 'Infinity', '-Infinity')
  )
);
ALTER TABLE public.current_stream DROP CONSTRAINT IF EXISTS current_stream_youtube_video_shape;
ALTER TABLE public.current_stream ADD CONSTRAINT current_stream_youtube_video_shape CHECK (
  source_type IS DISTINCT FROM 'youtube_video' OR (
    playback_id ~ '^youtube:video:[A-Za-z0-9_-]{11}$' AND COALESCE(kind, '') = 'vod'
    AND youtube_playlist_id IS NULL AND source_url IS NOT NULL
    AND source_url = 'https://www.youtube.com/watch?v=' || substring(playback_id FROM 15)
  )
);

CREATE OR REPLACE FUNCTION public.playout_is_queue_media(m public.mux_items)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(m.source_type, 'mux') IN ('mux', 'youtube_video')
    AND COALESCE(m.kind, 'vod') = 'vod'
    AND COALESCE(m.duration_seconds, 0) > 0
    AND m.duration_seconds::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND (COALESCE(m.source_type, 'mux') <> 'youtube_video'
      OR COALESCE(m.playback_id ~ '^youtube:video:[A-Za-z0-9_-]{11}$', false));
$$;

CREATE OR REPLACE FUNCTION public.enqueue_video(mux_item_id uuid, admin_user_id text)
RETURNS json LANGUAGE plpgsql SET search_path = public AS $$
DECLARE media public.mux_items%ROWTYPE; queued public.video_queue%ROWTYPE;
  target_item_id uuid := mux_item_id; next_position integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
  SELECT * INTO media FROM public.mux_items WHERE id = target_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Media item not found'; END IF;
  IF NOT public.playout_is_queue_media(media) THEN
    RAISE EXCEPTION 'Queue item must be a Mux or YouTube video with a known positive duration';
  END IF;
  SELECT COALESCE(MAX(position), 0) + 1 INTO next_position FROM public.video_queue;
  INSERT INTO public.video_queue AS q (mux_item_id, position)
    VALUES (target_item_id, next_position) RETURNING q.* INTO queued;
  INSERT INTO public.admin_actions(action_type, admin_user, details)
    VALUES ('queue_add', admin_user_id, jsonb_build_object('mux_item_id', target_item_id, 'position', next_position));
  RETURN (to_jsonb(queued) || jsonb_build_object('mux_items', to_jsonb(media)))::json;
END;
$$;

CREATE OR REPLACE FUNCTION public.playout_advance_at(anchor_at timestamptz, actor text, transition_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE queued public.video_queue%ROWTYPE; media public.mux_items%ROWTYPE; s public.current_stream%ROWTYPE;
BEGIN
  SELECT * INTO queued FROM public.video_queue ORDER BY position, id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO media FROM public.mux_items WHERE id = queued.mux_item_id;
  IF NOT FOUND OR NOT public.playout_is_queue_media(media) THEN
    RAISE EXCEPTION 'Queue item must be a Mux or YouTube video with a known positive duration';
  END IF;
  UPDATE public.current_stream SET
    playback_id = media.playback_id, title = COALESCE(media.label, media.playback_id), kind = 'vod',
    source_type = COALESCE(media.source_type, 'mux'), youtube_playlist_id = NULL, source_url = media.source_url,
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
    'title', s.title, 'kind', s.kind, 'source_type', s.source_type, 'source_url', s.source_url, 'stream', to_jsonb(s));
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
  next_media public.mux_items%ROWTYPE;
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
    ELSIF COALESCE(s.source_type, 'mux') NOT IN ('mux', 'youtube_video') THEN state := 'unsupported-source';
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
    SELECT m.* INTO next_media
      FROM public.video_queue q LEFT JOIN public.mux_items m ON m.id = q.mux_item_id
      ORDER BY q.position, q.id LIMIT 1;
    IF FOUND THEN
      IF NOT public.playout_is_queue_media(next_media) THEN
        state := 'blocked-queue-item';
        problem := 'Next queue item must be a Mux or YouTube video with a known positive duration';
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
    OR new_source_type IS NULL OR new_source_type NOT IN ('mux', 'youtube_video', 'youtube_playlist') THEN
    RAISE EXCEPTION 'Invalid stream configuration';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
  SELECT * INTO s FROM public.current_stream WHERE id = 1 FOR UPDATE;
  payload := jsonb_build_object('playback_id', new_playback_id, 'title', new_title, 'kind', new_kind,
    'source_type', new_source_type, 'playlist', new_youtube_playlist_id, 'url', new_source_url, 'actor', admin_user_id);
  prior := public.playout_command_replay(c_id, 'set_stream', payload);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  IF s.auto_advance_enabled AND new_source_type IN ('mux', 'youtube_video') AND new_kind = 'vod'
    AND NOT EXISTS(SELECT 1 FROM public.mux_items WHERE playback_id = new_playback_id AND duration_seconds > 0
      AND duration_seconds::text NOT IN ('NaN', 'Infinity', '-Infinity')) THEN
    RAISE EXCEPTION 'A positive duration is required for automatic playback';
  END IF;
  IF new_source_type = 'youtube_video' AND NOT EXISTS (
    SELECT 1 FROM public.mux_items m WHERE m.playback_id = new_playback_id
      AND m.source_type = 'youtube_video' AND public.playout_is_queue_media(m)
      AND new_kind = 'vod' AND new_youtube_playlist_id IS NULL
      AND new_source_url = m.source_url
  ) THEN RAISE EXCEPTION 'Add this YouTube video to the media library with its exact positive duration before cueing it'; END IF;
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
      AND COALESCE(source_type, 'mux') IN ('mux', 'youtube_video', 'youtube_playlist')) THEN RAISE EXCEPTION 'Media item not found'; END IF;
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
      WHERE NOT public.playout_is_queue_media(m)) THEN
      RAISE EXCEPTION 'Queue item must be a Mux or YouTube video with a known positive duration';
    END IF;
    IF NOT s.hold_screen_enabled AND s.playback_id <> 'demo-playback-id' AND COALESCE(s.playout_mode, 'manual') = 'manual'
      AND (COALESCE(s.source_type, 'mux') NOT IN ('mux', 'youtube_video') OR COALESCE(s.kind, 'vod') <> 'vod'
        OR NOT EXISTS (SELECT 1 FROM public.mux_items WHERE playback_id = s.playback_id AND duration_seconds > 0
          AND duration_seconds::text NOT IN ('NaN', 'Infinity', '-Infinity'))) THEN
      RAISE EXCEPTION 'A positive duration is required for automatic playback of a Mux or YouTube video';
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

-- Existing changed functions retain their service-only ACL; explicitly secure
-- the new helper too so there is no public write-capable RPC surface.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname IN
      ('playout_is_queue_media', 'enqueue_video', 'playout_advance_at', 'get_playout_snapshot',
       'set_manual_stream', 'toggle_hold', 'set_auto_advance')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.signature);
  END LOOP;
END;
$$;
COMMENT ON COLUMN public.mux_items.source_type IS
  'mux: Mux playback_id; youtube_video: youtube:video:{11-character ID}; youtube_playlist: ambient loop only.';
COMMENT ON COLUMN public.current_stream.source_type IS
  'Active media source; finite Mux and individual YouTube videos share the authoritative manual queue.';
COMMIT;
