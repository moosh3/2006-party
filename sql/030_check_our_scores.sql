-- Let's Check Our Scores (MK's run of show, segment 7) is a second timed scene,
-- and the queue log now records each cue's countdown metadata so the Scores
-- window can list the countdown videos that have aired tonight.
-- Apply after 028. Both functions are copied from 028 with one change each.
-- Never replay 022, 025, 026, 027 or 028 after this file. Applying it never
-- changes an active stream, its anchor, the queue order, doors or votes.
BEGIN;
DO $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('video_queue_order')); END; $$;

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
  scene_label := CASE scene_id WHEN 'rules-of-the-game' THEN 'Rules of the Game'
    WHEN 'check-our-scores' THEN 'Let''s Check Our Scores' END;
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
      'to_playback_id', media.playback_id, 'to_title', media.label, 'countdown', queued.countdown,
      'playback_session_id', s.playback_session_id, 'started_at', anchor_at));
  RETURN jsonb_build_object('success', true, 'playback_id', s.playback_id,
    'title', s.title, 'kind', s.kind, 'source_type', s.source_type, 'source_url', s.source_url, 'stream', to_jsonb(s));
END;
$$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname IN ('queue_scene_cue','playout_advance_at')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END; $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
