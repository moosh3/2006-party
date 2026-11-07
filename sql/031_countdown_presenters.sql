-- Countdown cues may name a presenting Sprite ("Sprite Emma presents… And now
-- time for video #5", MK's run of show). The presenter is optional cue
-- metadata shown on the title card; timing is unchanged. Apply after 030.
-- countdown_valid is copied from 028 and save_countdown_cue from 027, each with
-- the presenter added. Never replay 022 or 025–030 after this file. Applying
-- it never changes an active stream, queued cues, doors or votes.
BEGIN;
DO $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('video_queue_order')); END; $$;

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
    AND (NOT c ? 'presenter' OR (jsonb_typeof(c->'presenter') = 'string' AND c->>'presenter' IN ('mk','jen','lip','yongwoo','emma','alec')))
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
DECLARE m public.mux_items%ROWTYPE; q public.video_queue%ROWTYPE; next_pos integer; intro numeric; has_intro boolean; presenter text; payload jsonb; prior jsonb; result jsonb; c_id text := COALESCE(command_id,'countdown-'||gen_random_uuid()::text);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));
  payload := jsonb_build_object('media',media_id,'cue',cue,'queue',queue_id,'actor',actor);
  prior := public.playout_command_replay(c_id,'countdown_save',payload);
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  SELECT * INTO m FROM public.mux_items WHERE id=media_id;
  IF NOT FOUND OR cue IS NULL OR NOT public.countdown_valid(cue,m) THEN
    RAISE EXCEPTION 'Invalid countdown: check rank, highlight, length and banner URL';
  END IF;
  has_intro := cue ? 'introSeconds';
  presenter := cue->>'presenter';
  intro := COALESCE((cue->>'introSeconds')::numeric,0);
  -- Store only the supported fields. This is copied into the active cue at GO.
  cue := jsonb_build_object('rank',(cue->>'rank')::integer,
    'startSeconds',(cue->>'startSeconds')::numeric,'durationSeconds',(cue->>'durationSeconds')::numeric,
    'bannerUrl',nullif(cue->>'bannerUrl',''));
  IF has_intro THEN cue := cue || jsonb_build_object('introSeconds',intro); END IF;
  IF presenter IS NOT NULL THEN cue := cue || jsonb_build_object('presenter',presenter); END IF;
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

-- Lets the API refuse a presenter on a database that would silently drop it.
CREATE OR REPLACE FUNCTION public.countdown_presenter_supported()
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT true $$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc
    WHERE pronamespace='public'::regnamespace AND proname IN ('countdown_valid','save_countdown_cue','countdown_presenter_supported')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END; $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
