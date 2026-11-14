BEGIN;

-- Existing rounds retain their relative order. Freshly copied trivia is given
-- an explicit order so a shuffled night survives refreshes and reconnects.
ALTER TABLE game_prompts ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 2147483647;

CREATE OR REPLACE FUNCTION game_copy_trivia_night(night_title text, source_show uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  source game_shows;
  new_show uuid;
  original_ids uuid[];
  shuffled_ids uuid[];
  prompt_id uuid;
  position integer := 0;
BEGIN
  IF night_title IS NULL OR length(btrim(night_title)) NOT BETWEEN 1 AND 100
    OR night_title ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Enter a show name (1–100 characters)';
  END IF;
  -- The existing admin operations also lock the show. A finished source is
  -- immutable, and the unique active-show index arbitrates concurrent requests.
  SELECT * INTO source FROM game_shows WHERE id=source_show FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source show not found'; END IF;
  IF source.status <> 'finished' OR EXISTS(SELECT 1 FROM game_shows WHERE status='active') THEN
    RAISE EXCEPTION 'End the active show before starting a new night';
  END IF;
  SELECT array_agg(id ORDER BY display_order,created_at,id), array_agg(id ORDER BY random())
    INTO original_ids, shuffled_ids FROM game_prompts WHERE show_id=source_show AND kind='trivia';
  IF coalesce(cardinality(original_ids),0)=0 THEN
    RAISE EXCEPTION 'That show has no trivia to reuse';
  END IF;
  IF cardinality(original_ids)>200 THEN RAISE EXCEPTION 'A show supports at most 200 rounds'; END IF;
  -- Avoid a no-op shuffle, especially with a small question set.
  IF cardinality(original_ids)>1 AND shuffled_ids=original_ids THEN
    shuffled_ids := shuffled_ids[2:cardinality(shuffled_ids)] || shuffled_ids[1:1];
  END IF;
  INSERT INTO game_shows(title) VALUES(btrim(night_title)) RETURNING id INTO new_show;
  FOREACH prompt_id IN ARRAY shuffled_ids LOOP
    INSERT INTO game_prompts(show_id,kind,question,options,correct_option,display_order)
      SELECT new_show,'trivia',question,options,correct_option,position
      FROM game_prompts WHERE id=prompt_id;
    position := position+1;
  END LOOP;
  RETURN new_show;
END $$;

REVOKE ALL ON FUNCTION game_copy_trivia_night(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION game_copy_trivia_night(text,uuid) TO service_role;

COMMIT;
