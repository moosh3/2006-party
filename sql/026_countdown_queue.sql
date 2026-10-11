-- Countdown cues keep source duration intact and freeze metadata when cued.
-- Apply after 025. No updates to current playback, queue or audience rows.
BEGIN;
DO $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('video_queue_order')); END; $$;
ALTER TABLE public.video_queue ADD COLUMN IF NOT EXISTS countdown jsonb;
ALTER TABLE public.current_stream ADD COLUMN IF NOT EXISTS countdown jsonb;

CREATE OR REPLACE FUNCTION public.countdown_valid(c jsonb, m public.mux_items)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE rank integer; start_at numeric; duration numeric; banner text;
BEGIN
  IF c IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(c) <> 'object' OR NOT public.playout_is_queue_media(m)
    OR jsonb_typeof(c->'rank') IS DISTINCT FROM 'number'
    OR jsonb_typeof(c->'startSeconds') IS DISTINCT FROM 'number'
    OR jsonb_typeof(c->'durationSeconds') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  IF (c->>'rank')::numeric <> trunc((c->>'rank')::numeric) THEN RETURN false; END IF;
  rank := (c->>'rank')::integer; start_at := (c->>'startSeconds')::numeric;
  duration := (c->>'durationSeconds')::numeric; banner := c->>'bannerUrl';
  RETURN COALESCE(rank BETWEEN 1 AND 5 AND start_at >= 0 AND duration > 0
    AND start_at + duration <= m.duration_seconds
    AND (rank <> 5 OR duration = 15)
    AND (rank <> 1 OR (start_at = 0 AND duration = m.duration_seconds))
    AND (banner IS NULL OR length(banner) <= 2048 AND
      (banner ~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$' OR banner ~ '^/2006/[^[:space:]]+$')), false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_countdown_cue(
  media_id uuid, cue jsonb, actor text, queue_id uuid DEFAULT NULL, command_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE m public.mux_items%ROWTYPE; q public.video_queue%ROWTYPE; next_pos integer; payload jsonb; prior jsonb; result jsonb; c_id text := COALESCE(command_id,'countdown-'||gen_random_uuid()::text);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
  payload := jsonb_build_object('media',media_id,'cue',cue,'queue',queue_id,'actor',actor);
  prior := public.playout_command_replay(c_id,'countdown_save',payload);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  SELECT * INTO m FROM public.mux_items WHERE id=media_id;
  IF NOT FOUND OR cue IS NULL OR NOT public.countdown_valid(cue,m) THEN
    RAISE EXCEPTION 'Invalid countdown: check rank, highlight, length and banner URL';
  END IF;
  -- Store only the supported fields. This is copied into the active cue at GO.
  cue := jsonb_build_object('rank',(cue->>'rank')::integer,
    'startSeconds',(cue->>'startSeconds')::numeric,'durationSeconds',(cue->>'durationSeconds')::numeric,
    'bannerUrl',nullif(cue->>'bannerUrl',''));
  IF queue_id IS NULL THEN
    SELECT COALESCE(max(position),0)+1 INTO next_pos FROM public.video_queue;
    INSERT INTO public.video_queue(mux_item_id,position,countdown) VALUES(media_id,next_pos,cue) RETURNING * INTO q;
  ELSE
    UPDATE public.video_queue SET mux_item_id=media_id,countdown=cue WHERE id=queue_id RETURNING * INTO q;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cue has already played or was removed. Refresh the queue.'; END IF;
  END IF;
  INSERT INTO public.admin_actions(action_type,admin_user,details)
    VALUES('countdown_save',actor,jsonb_build_object('queue_id',q.id,'countdown',cue));
  result := to_jsonb(q);
  INSERT INTO public.playout_commands VALUES(c_id,'countdown_save',payload,result,clock_timestamp());
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
    RAISE EXCEPTION 'Queue item must be a Mux or YouTube video with a known positive duration';
  END IF;
  UPDATE public.current_stream SET
    playback_id = media.playback_id, title = COALESCE(media.label, media.playback_id), kind = 'vod',
    source_type = COALESCE(media.source_type, 'mux'), youtube_playlist_id = NULL, source_url = media.source_url,
    countdown = queued.countdown,
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
      SELECT countdown INTO next_cue FROM public.video_queue ORDER BY position,id LIMIT 1;
      IF NOT public.playout_is_queue_media(next_media) OR NOT public.countdown_valid(next_cue,next_media) THEN
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
        IF s.countdown IS NOT NULL THEN d := (s.countdown->>'startSeconds')::numeric + (s.countdown->>'durationSeconds')::numeric; END IF;
        due_at := s.playback_updated_at + (d - COALESCE(s.playback_position, 0)) * interval '1 second';
        state := CASE WHEN due_at <= now_at THEN 'catching-up' ELSE 'armed' END;
        EXIT;
      END IF;
    ELSE
      UPDATE public.current_stream SET
        countdown = NULL, hold_screen_enabled = true, playback_state = 'playing', playback_position = 0,
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
  UPDATE public.current_stream SET countdown = NULL, playback_id = new_playback_id, title = new_title, kind = new_kind,
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
  IF s.countdown IS NOT NULL THEN d := (s.countdown->>'startSeconds')::numeric + (s.countdown->>'durationSeconds')::numeric; END IF;
  pos := CASE WHEN command_action = 'restart' THEN COALESCE((s.countdown->>'startSeconds')::numeric,0)
    ELSE COALESCE(command_position, public.playout_live_position(s, now_at)) END;
  IF s.countdown IS NOT NULL AND pos < (s.countdown->>'startSeconds')::numeric THEN RAISE EXCEPTION 'Position precedes countdown highlight'; END IF;
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
    IF s.countdown IS NOT NULL AND NOT s.hold_screen_enabled THEN
      d := (s.countdown->>'startSeconds')::numeric + (s.countdown->>'durationSeconds')::numeric;
    END IF;
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

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname IN
      ('countdown_valid','save_countdown_cue','playout_advance_at','get_playout_snapshot','set_manual_stream','playback_command','set_playout_mode')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END; $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
