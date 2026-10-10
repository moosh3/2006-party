-- Audience admission is deliberately independent of playback and the game.
-- A newly installed gate starts closed. Reapplying this migration preserves it.
CREATE TABLE IF NOT EXISTS public.audience_doors (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  doors_open boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO public.audience_doors (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.audience_doors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audience_doors FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.audience_doors TO service_role;

COMMENT ON TABLE public.audience_doors IS
  'Host-controlled audience waiting screen. Service-role only; never changes the program feed.';

CREATE OR REPLACE FUNCTION public.set_audience_doors(
  requested_doors_open boolean,
  expected_revision bigint,
  admin_user_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  gate public.audience_doors%ROWTYPE;
BEGIN
  IF requested_doors_open IS NULL OR expected_revision IS NULL
     OR expected_revision < 0 OR expected_revision > 9007199254740991
     OR admin_user_id IS NULL OR length(btrim(admin_user_id)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid audience doors command' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO gate FROM public.audience_doors WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audience doors singleton missing' USING ERRCODE = 'P0002';
  END IF;
  IF gate.revision <> expected_revision THEN
    RAISE EXCEPTION 'AUDIENCE_DOORS_REVISION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  -- Repeated desired-state requests are harmless, not toggles.
  IF gate.doors_open IS DISTINCT FROM requested_doors_open THEN
    UPDATE public.audience_doors
      SET doors_open = requested_doors_open, revision = revision + 1,
          changed_at = clock_timestamp()
      WHERE id = 1 RETURNING * INTO gate;

    INSERT INTO public.admin_actions (action_type, admin_user, details)
      VALUES ('audience_doors', admin_user_id, jsonb_build_object(
        'doorsOpen', gate.doors_open, 'revision', gate.revision
      ));
  END IF;

  RETURN jsonb_build_object(
    'doorsOpen', gate.doors_open,
    'revision', gate.revision,
    'changedAt', gate.changed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_audience_doors(boolean, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_audience_doors(boolean, bigint, text) TO service_role;

NOTIFY pgrst, 'reload schema';
