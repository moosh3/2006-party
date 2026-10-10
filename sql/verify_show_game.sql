-- Run only when no show is active. All fixture data is rolled back.
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE s uuid; v uuid; p uuid; award uuid; suggestion uuid; option_a text; option_b text; totals jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM game_shows WHERE status='active') THEN
    RAISE EXCEPTION 'Do not run the smoke test during an active show';
  END IF;
  INSERT INTO game_shows(title) VALUES('Transactional verification') RETURNING id INTO s;
  INSERT INTO game_viewers(token_hash,name) VALUES(gen_random_uuid()::text,'Smoke Test') RETURNING id INTO v;
  PERFORM game_admin(s,'cast','{"names":["Cast A","Cast B"]}');
  PERFORM game_admin(s,'create','{"kind":"trivia","question":"Verification question","options":[{"id":"0","label":"Correct"},{"id":"1","label":"Incorrect"}],"correctOption":"0"}');
  SELECT id INTO p FROM game_prompts WHERE show_id=s AND kind='trivia';
  PERFORM game_admin(s,'open',jsonb_build_object('id',p));
  PERFORM game_vote(p,v,'0');
  BEGIN
    PERFORM game_vote(p,v,'1');
    RAISE EXCEPTION 'FAIL: duplicate trivia answer accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Your trivia answer is already locked' THEN RAISE; END IF;
  END;
  PERFORM game_admin(s,'close',jsonb_build_object('id',p));
  totals := game_totals(s);
  IF (totals->'scores'->0->>'score')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL: incorrect trivia score';
  END IF;
  PERFORM game_suggest(s,v,'Best verification award');
  SELECT id INTO suggestion FROM game_suggestions WHERE show_id=s;
  IF EXISTS(SELECT 1 FROM game_prompts WHERE show_id=s AND kind='superlative') THEN
    RAISE EXCEPTION 'FAIL: suggestion published without approval';
  END IF;
  PERFORM game_admin(s,'approve',jsonb_build_object('id',suggestion,'question','Approved award'));
  SELECT id,options->0->>'id',options->1->>'id' INTO award,option_a,option_b
    FROM game_prompts WHERE show_id=s AND kind='superlative' AND status='draft';
  IF award IS NULL THEN RAISE EXCEPTION 'FAIL: approved suggestion is not a draft'; END IF;
  PERFORM game_admin(s,'open',jsonb_build_object('id',award));
  PERFORM game_vote(award,v,option_a);
  PERFORM game_vote(award,v,option_b);
  IF (SELECT count(*) FROM game_votes WHERE prompt_id=award) <> 1 OR
     (SELECT option_id FROM game_votes WHERE prompt_id=award) <> option_b THEN
    RAISE EXCEPTION 'FAIL: vote replacement failed';
  END IF;
  PERFORM game_admin(s,'finish','{}');
  BEGIN
    PERFORM game_vote(award,v,option_a);
    RAISE EXCEPTION 'FAIL: finished show accepted a vote';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Show is not accepting votes' THEN RAISE; END IF;
  END;
  IF has_function_privilege('anon','game_admin(uuid,text,jsonb)','EXECUTE') OR
     has_function_privilege('authenticated','game_totals(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: private functions are publicly executable';
  END IF;
END $$;
ROLLBACK;
SELECT 'PASS: service-role voting, locked trivia, scoring, moderated drafts, vote replacement, show closure, and function permissions; all test data rolled back' AS result;
