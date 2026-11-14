BEGIN;

-- Remove only the legacy one-open-question restriction. Preserve the rest of
-- the installed admin function, answer locks, permissions, and existing data.
DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.game_admin(uuid,text,jsonb)'::regprocedure);
  old_guard text := $guard$    IF p.kind='trivia' AND EXISTS(SELECT 1 FROM game_prompts WHERE show_id=s AND kind='trivia' AND status='open') THEN RAISE EXCEPTION 'Close the current trivia question first'; END IF;$guard$;
BEGIN
  IF strpos(definition, old_guard) > 0 THEN
    EXECUTE replace(definition, old_guard, '');
  ELSIF strpos(definition, 'Close the current trivia question first') > 0 THEN
    RAISE EXCEPTION 'Unexpected trivia guard; inspect game_admin before migrating';
  END IF;
END $migration$;
DROP INDEX IF EXISTS public.game_one_open_trivia;

CREATE OR REPLACE FUNCTION public.game_trivia_list(s uuid, action text) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE sh game_shows;
BEGIN
  SELECT * INTO sh FROM game_shows WHERE id=s FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Show not found'; END IF;
  IF sh.status<>'active' THEN RAISE EXCEPTION 'Show has ended'; END IF;
  IF action='open' THEN
    UPDATE game_prompts SET status='open' WHERE show_id=s AND kind='trivia' AND status='draft';
  ELSIF action='close_reveal' THEN
    -- One transaction. Retrying a lost response never hides an answer again.
    UPDATE game_prompts SET status='closed',results_visible=true
      WHERE show_id=s AND kind='trivia' AND status IN ('open','closed');
  ELSE RAISE EXCEPTION 'Unknown trivia list action'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.game_trivia_list(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.game_trivia_list(uuid,text) TO service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
