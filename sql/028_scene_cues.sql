-- Timed scene cues (Rules of the Game) run on the SAME finite queue clock as
-- Mux and YouTube videos. A scene is a library row hidden from the media
-- library: source_type 'scene', playback_id 'scene:<scene-id>:<uuid>' and the
-- exact operator-entered length. Each queued scene gets its own row so its
-- length cannot change another cue. No media plays; clients render the scene.
-- Apply after 027. Replaces only source-sensitive functions, copied from their
-- latest definitions (025 set_auto_advance; 027 for the rest). Never replay
-- 022, 025, 026 or 027 after this file. Applying it never changes an active
-- stream, its anchor, the queue order, doors or votes.
BEGIN;
DO $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('video_queue_order')); END; $$;

ALTER TABLE public.mux_items DROP CONSTRAINT IF EXISTS mux_items_source_type_check;
ALTER TABLE public.mux_items ADD CONSTRAINT mux_items_source_type_check
  CHECK (source_type IN ('mux', 'youtube_video', 'youtube_playlist', 'scene'));
ALTER TABLE public.current_stream DROP CONSTRAINT IF EXISTS current_stream_source_type_check;
ALTER TABLE public.current_stream ADD CONSTRAINT current_stream_source_type_check
  CHECK (source_type IN ('mux', 'youtube_video', 'youtube_playlist', 'scene'));

ALTER TABLE public.mux_items DROP CONSTRAINT IF EXISTS mux_items_scene_shape;
ALTER TABLE public.mux_items ADD CONSTRAINT mux_items_scene_shape CHECK (
  source_type IS DISTINCT FROM 'scene' OR (
    playback_id ~ '^scene:[a-z0-9-]{1,40}:[0-9a-f-]{36}$' AND COALESCE(kind, '') = 'vod'
    AND youtube_playlist_id IS NULL AND source_url IS NULL
    AND duration_seconds IS NOT NULL AND duration_seconds > 0
    AND duration_seconds::text NOT IN ('NaN', 'Infinity', '-Infinity')
  )
);
ALTER TABLE public.current_stream DROP CONSTRAINT IF EXISTS current_stream_scene_shape;
ALTER TABLE public.current_stream ADD CONSTRAINT current_stream_scene_shape CHECK (
  source_type IS DISTINCT FROM 'scene' OR (
    playback_id ~ '^scene:[a-z0-9-]{1,40}:[0-9a-f-]{36}$' AND COALESCE(kind, '') = 'vod'
    AND youtube_playlist_id IS NULL AND source_url IS NULL
  )
);

CREATE OR REPLACE FUNCTION public.playout_is_queue_media(m public.mux_items)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(m.source_type, 'mux') IN ('mux', 'youtube_video', 'scene')
    AND COALESCE(m.kind, 'vod') = 'vod'
    AND COALESCE(m.duration_seconds, 0) > 0
    AND m.duration_seconds::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND (COALESCE(m.source_type, 'mux') <> 'youtube_video'
      OR COALESCE(m.playback_id ~ '^youtube:video:[A-Za-z0-9_-]{11}$', false))
    AND (COALESCE(m.source_type, 'mux') <> 'scene'
      OR COALESCE(m.playback_id ~ '^scene:[a-z0-9-]{1,40}:[0-9a-f-]{36}$', false));
$$;

-- A scene never carries countdown metadata.
CREATE OR REPLACE FUNCTION public.countdown_valid(c jsonb, m public.mux_items)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE rank integer; start_at numeric; duration numeric; banner text;
BEGIN
  IF c IS NULL THEN RETURN true; END IF;
  IF COALESCE(m.source_type, 'mux') = 'scene' THEN RETURN false; END IF;
  IF jsonb_typeof(c) <> 'object' OR NOT public.playout_is_queue_media(m)
    OR jsonb_typeof(c->'rank') IS DISTINCT FROM 'number'
    OR jsonb_typeof(c->'startSeconds') IS DISTINCT FROM 'number'
    OR jsonb_typeof(c->'durationSeconds') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  IF (c->>'rank')::numeric <> trunc((c->>'rank')::numeric) THEN RETURN false; END IF;
  rank := (c->>'rank')::integer; start_at := (c->>'startSeconds')::numeric;
  duration := (c->>'durationSeconds')::numeric; banner := c->>'bannerUrl';
  RETURN COALESCE(rank BETWEEN 1 AND 5 AND start_at >= 0 AND duration > 0
    AND start_at + duration <= m.duration_seconds
    AND (NOT c ? 'introSeconds' OR (jsonb_typeof(c->'introSeconds') = 'number'
      AND (c->>'introSeconds')::numeric BETWEEN 0 AND 10))
    AND (rank <> 5 OR duration = 15)
    AND (rank <> 1 OR (start_at = 0 AND duration = m.duration_seconds))
    AND (banner IS NULL OR length(banner) <= 2048 AND
      (banner ~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$' OR banner ~ '^/2006/[^[:space:]]+$')), false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_scene_cue(scene_id text, length_seconds numeric,
  actor text, command_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE media public.mux_items%ROWTYPE; q public.video_queue%ROWTYPE; next_pos integer; scene_label text;
  payload jsonb; prior jsonb; result jsonb; c_id text := COALESCE(command_id, 'scene-' || gen_random_uuid()::text);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
  payload := jsonb_build_object('scene', scene_id, 'length', length_seconds, 'actor', actor);
  prior := public.playout_command_replay(c_id, 'scene_queue', payload);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  scene_label := CASE scene_id WHEN 'rules-of-the-game' THEN 'Rules of the Game' END;
  IF scene_label IS NULL THEN RAISE EXCEPTION 'Unknown scene'; END IF;
  IF length_seconds IS NULL OR length_seconds <= 0 OR length_seconds > 7200
    OR length_seconds::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Scene length must be a positive number of seconds, up to two hours';
  END IF;
  INSERT INTO public.mux_items(playback_id, label, kind, source_type, duration_seconds)
    VALUES ('scene:' || scene_id || ':' || gen_random_uuid()::text, scene_label, 'vod', 'scene', length_seconds)
    RETURNING * INTO media;
  SELECT COALESCE(max(position), 0) + 1 INTO next_pos FROM public.video_queue;
  INSERT INTO public.video_queue(mux_item_id, position) VALUES (media.id, next_pos) RETURNING * INTO q;
  INSERT INTO public.admin_actions(action_type, admin_user, details)
    VALUES ('scene_queue', actor, jsonb_build_object('queue_id', q.id, 'scene', scene_id,
      'length_seconds', length_seconds, 'mux_item_id', media.id));
  result := to_jsonb(q);
  INSERT INTO public.playout_commands VALUES(c_id, 'scene_queue', payload, result, clock_timestamp());
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.playout_advance_at(anchor_at timestamptz, actor text, transition_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE queued public.video_queue%ROWTYPE; media public.mux_items%ROWTYPE; s public.current_stream%ROWTYPE;
BEGIN
  SELECT * INTO queued FROM public.video_queue ORDER BY position, id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO media FROM public.mux_items WHERE id = queued.mux_item_id;
  IF NOT FOUND OR NOT public.playout_is_queue_media(media) OR NOT public.countdown_valid(queued.countdown, media) THEN
    RAISE EXCEPTION 'Queue item must be a Mux or YouTube video or a scene with a known positive duration';
  END IF;
  UPDATE public.current_stream SET
    playback_id = media.playback_id, title = COALESCE(media.label, media.playback_id), kind = 'vod',
    source_type = COALESCE(media.source_type, 'mux'), youtube_playlist_id = NULL, source_url = media.source_url,
    countdown = queued.countdown,
    countdown_intro_remaining_seconds = COALESCE((queued.countdown->>'introSeconds')::numeric,0),
    playback_state = 'playing', playback_position = COALESCE((queued.countdown->>'startSeconds')::numeric, 0), playback_updated_at = anchor_at,
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
  next_media public.mux_items%ROWTYPE; next_cue jsonb;
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
    IF s.countdown IS NOT NULL AND NOT s.hold_screen_enabled AND s.playout_mode='manual' THEN
      d := (s.countdown->>'startSeconds')::numeric + (s.countdown->>'durationSeconds')::numeric;
      -- Even with auto-advance off, a countdown excerpt must stop at its out point.
      IF NOT s.auto_advance_enabled AND s.playback_state='playing'
        AND public.playout_live_position(s,now_at) >= d THEN
        IF NOT locked THEN
          PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
          SELECT * INTO s FROM public.current_stream WHERE id=1 FOR UPDATE;
          now_at:=clock_timestamp(); locked:=true; CONTINUE;
        END IF;
        UPDATE public.current_stream SET playback_state='paused',playback_position=d,
          playback_updated_at=now_at,last_playback_command='excerpt_end',
          last_command_id='excerpt-'||gen_random_uuid()::text WHERE id=1 RETURNING * INTO s;
      END IF;
    END IF;
    IF COALESCE(s.playout_mode, 'manual') <> 'manual' THEN state := 'schedule';
    ELSIF s.hold_screen_enabled THEN state := 'holding';
    ELSIF NOT COALESCE(s.auto_advance_enabled, false) THEN state := 'disabled';
    ELSIF s.playback_state <> 'playing' THEN state := 'paused';
    ELSIF COALESCE(s.source_type, 'mux') NOT IN ('mux', 'youtube_video', 'scene') THEN state := 'unsupported-source';
    ELSIF COALESCE(s.kind, 'vod') <> 'vod' THEN state := 'live';
    ELSIF COALESCE(d, 0) <= 0 OR d::text IN ('NaN', 'Infinity', '-Infinity') THEN state := 'missing-duration';
    ELSE
      state := 'armed';
      due_at := COALESCE(s.playback_updated_at, now_at) +
        (d - COALESCE(s.playback_position, 0) + CASE WHEN s.countdown IS NOT NULL
          THEN s.countdown_intro_remaining_seconds ELSE 0 END) * interval '1 second';
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
      SELECT countdown INTO next_cue FROM public.video_queue ORDER BY position,id LIMIT 1;
      IF NOT public.playout_is_queue_media(next_media) OR NOT public.countdown_valid(next_cue,next_media) THEN
        state := 'blocked-queue-item';
        problem := 'Next queue item must be a Mux or YouTube video or a scene with a known positive duration';
        due_at := NULL; EXIT;
      END IF;
      PERFORM public.playout_advance_at(due_at, 'system:clock', 'clock-' || gen_random_uuid()::text);
      transitions := transitions + 1;
      SELECT * INTO s FROM public.current_stream WHERE id = 1;
      -- Bound work per invocation without abandoning the original timeline.
      IF transitions >= 256 THEN
        SELECT duration_seconds INTO d FROM public.mux_items WHERE playback_id = s.playback_id;
        IF s.countdown IS NOT NULL THEN d := (s.countdown->>'startSeconds')::numeric + (s.countdown->>'durationSeconds')::numeric; END IF;
        due_at := s.playback_updated_at + (d - COALESCE(s.playback_position, 0) + CASE WHEN s.countdown IS NOT NULL
          THEN s.countdown_intro_remaining_seconds ELSE 0 END) * interval '1 second';
        state := CASE WHEN due_at <= now_at THEN 'catching-up' ELSE 'armed' END;
        EXIT;
      END IF;
    ELSE
      UPDATE public.current_stream SET
        countdown = NULL, countdown_intro_remaining_seconds = 0, hold_screen_enabled = true, playback_state = 'playing', playback_position = 0,
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
    'playback_position_seconds', public.playout_live_position(s,now_at),
    'playback_start_delay_seconds', public.playout_intro_remaining(s,now_at),
    'playback_duration_seconds', d, 'next_transition_at', due_at,
    'automation_status', state, 'automation_error', problem);
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
      RAISE EXCEPTION 'Queue item must be a Mux or YouTube video or a scene with a known positive duration';
    END IF;
    IF NOT s.hold_screen_enabled AND s.playback_id <> 'demo-playback-id' AND COALESCE(s.playout_mode, 'manual') = 'manual'
      AND (COALESCE(s.source_type, 'mux') NOT IN ('mux', 'youtube_video', 'scene') OR COALESCE(s.kind, 'vod') <> 'vod'
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

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname IN
      ('playout_is_queue_media','countdown_valid','queue_scene_cue','playout_advance_at',
       'get_playout_snapshot','set_auto_advance')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END; $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
