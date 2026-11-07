-- Essay submissions (MK's run of show, segment 7: Let's Check Our Scores).
-- A signed-on guest submits their 2006 essay once per doors-open session. It
-- is published immediately with their screen name; the API applies the same
-- basic profanity/link filter as game suggestions. Guests cannot delete a
-- submission; the operator can hide or restore one. Apply after 021 and 024.
-- Creates new objects only: no existing show, queue, door or vote state changes.
BEGIN;

CREATE TABLE IF NOT EXISTS public.essay_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id uuid NOT NULL REFERENCES public.game_viewers(id) ON DELETE CASCADE,
  screen_name text NOT NULL CHECK (length(screen_name) BETWEEN 1 AND 40),
  prompt_index integer NOT NULL CHECK (prompt_index BETWEEN 0 AND 20),
  prompt text NOT NULL CHECK (length(prompt) BETWEEN 1 AND 300),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  hidden boolean NOT NULL DEFAULT false,
  hidden_at timestamptz,
  hidden_by text
);
CREATE INDEX IF NOT EXISTS essay_submissions_created_at ON public.essay_submissions (created_at);
CREATE INDEX IF NOT EXISTS essay_submissions_viewer ON public.essay_submissions (viewer_id, created_at);
ALTER TABLE public.essay_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.essay_submissions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.essay_submissions TO service_role;

-- One submission per guest since the doors last opened. Locks the guest so
-- two quick clicks cannot both publish.
CREATE OR REPLACE FUNCTION public.essay_submit(v uuid, prompt_idx integer, prompt_text text, essay text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE viewer public.game_viewers%ROWTYPE; gate public.audience_doors%ROWTYPE; saved public.essay_submissions%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('essay:' || v::text));
  SELECT * INTO viewer FROM public.game_viewers WHERE id = v;
  IF NOT FOUND OR viewer.blocked THEN RAISE EXCEPTION 'Participation is unavailable. Please contact the host.'; END IF;
  SELECT * INTO gate FROM public.audience_doors WHERE id = 1;
  IF NOT FOUND OR NOT gate.doors_open THEN RAISE EXCEPTION 'Essays can be submitted once the doors are open.'; END IF;
  IF EXISTS (SELECT 1 FROM public.essay_submissions WHERE viewer_id = v AND created_at >= gate.changed_at) THEN
    RAISE EXCEPTION 'You already submitted your essay tonight.';
  END IF;
  INSERT INTO public.essay_submissions(viewer_id, screen_name, prompt_index, prompt, body)
    VALUES (v, viewer.name, prompt_idx, prompt_text, essay) RETURNING * INTO saved;
  RETURN jsonb_build_object('id', saved.id, 'screenName', saved.screen_name, 'promptIndex', saved.prompt_index,
    'prompt', saved.prompt, 'body', saved.body, 'createdAt', saved.created_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.essay_set_hidden(essay_id uuid, hide boolean, actor text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE saved public.essay_submissions%ROWTYPE;
BEGIN
  IF hide IS NULL THEN RAISE EXCEPTION 'Choose hide or restore'; END IF;
  UPDATE public.essay_submissions SET hidden = hide,
    hidden_at = CASE WHEN hide THEN clock_timestamp() END, hidden_by = CASE WHEN hide THEN actor END
    WHERE id = essay_id RETURNING * INTO saved;
  IF NOT FOUND THEN RAISE EXCEPTION 'Essay not found'; END IF;
  INSERT INTO public.admin_actions(action_type, admin_user, details)
    VALUES (CASE WHEN hide THEN 'essay_hide' ELSE 'essay_restore' END, actor, jsonb_build_object('essay_id', essay_id));
  RETURN jsonb_build_object('id', saved.id, 'hidden', saved.hidden);
END;
$$;

REVOKE ALL ON FUNCTION public.essay_submit(uuid, integer, text, text), public.essay_set_hidden(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.essay_submit(uuid, integer, text, text), public.essay_set_hidden(uuid, boolean, text)
  TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
