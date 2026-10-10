-- Preview data only. Refuses to seed a show that already has rounds.
-- Every sample round and participant is labeled DEMO.
BEGIN;
DO $$
DECLARE s uuid; p uuid; ids uuid[] := ARRAY[]::uuid[]; cast_ids text[];
  viewer_names text[] := ARRAY['DEMO Alex','DEMO Jamie','DEMO Taylor','DEMO Morgan','DEMO Casey'];
  v uuid; i integer;
BEGIN
  SELECT id INTO s FROM game_shows WHERE status='active' FOR UPDATE;
  IF s IS NULL THEN RAISE EXCEPTION 'Create a show before adding demo data'; END IF;
  IF EXISTS(SELECT 1 FROM game_prompts WHERE show_id=s) THEN
    RAISE EXCEPTION 'Show already has rounds; refusing to duplicate or mix demo data';
  END IF;
  SELECT array_agg(id::text ORDER BY name) INTO cast_ids FROM game_cast WHERE show_id=s;
  IF coalesce(array_length(cast_ids,1),0)<2 THEN RAISE EXCEPTION 'Save the cast roster first'; END IF;
  FOR i IN 1..5 LOOP
    INSERT INTO game_viewers(token_hash,name) VALUES(gen_random_uuid()::text,viewer_names[i]) RETURNING id INTO v;
    ids := array_append(ids,v);
  END LOOP;

  PERFORM game_admin(s,'create','{"kind":"trivia","question":"[DEMO] Which happened in 2006?","options":[{"id":"0","label":"Pluto was reclassified as a dwarf planet"},{"id":"1","label":"Facebook launched"},{"id":"2","label":"The first iPod was released"},{"id":"3","label":"Mean Girls premiered"}],"correctOption":"0"}');
  SELECT id INTO p FROM game_prompts WHERE show_id=s AND question='[DEMO] Which happened in 2006?';
  PERFORM game_admin(s,'open',jsonb_build_object('id',p));
  FOR i IN 1..5 LOOP PERFORM game_vote(p,ids[i],CASE WHEN i<=3 THEN '0' ELSE '1' END); END LOOP;
  PERFORM game_admin(s,'close',jsonb_build_object('id',p));
  PERFORM game_admin(s,'reveal',jsonb_build_object('id',p));

  PERFORM game_admin(s,'create','{"kind":"trivia","question":"[DEMO] Your AIM buddy says BRB. What do they mean?","options":[{"id":"0","label":"Be right back"},{"id":"1","label":"Bring replacement batteries"},{"id":"2","label":"Best ringtone buddy"},{"id":"3","label":"Burn, rip, burn"}],"correctOption":"0"}');
  SELECT id INTO p FROM game_prompts WHERE show_id=s AND question='[DEMO] Your AIM buddy says BRB. What do they mean?';
  PERFORM game_admin(s,'open',jsonb_build_object('id',p));
  PERFORM game_vote(p,ids[1],'0'); PERFORM game_vote(p,ids[2],'2');

  PERFORM game_admin(s,'create','{"kind":"trivia","question":"[DEMO] Which site let you rank your friends in a Top 8?","options":[{"id":"0","label":"MySpace"},{"id":"1","label":"Wikipedia"},{"id":"2","label":"MapQuest"},{"id":"3","label":"IMDb"}],"correctOption":"0"}');

  PERFORM game_admin(s,'create','{"kind":"superlative","question":"[DEMO] Best AIM Away Message"}');
  SELECT id INTO p FROM game_prompts WHERE show_id=s AND question='[DEMO] Best AIM Away Message';
  PERFORM game_admin(s,'open',jsonb_build_object('id',p));
  FOR i IN 1..5 LOOP PERFORM game_vote(p,ids[i],CASE WHEN i<=3 THEN cast_ids[1] ELSE cast_ids[2] END); END LOOP;
  PERFORM game_admin(s,'close',jsonb_build_object('id',p));
  PERFORM game_admin(s,'reveal',jsonb_build_object('id',p));

  PERFORM game_admin(s,'create','{"kind":"superlative","question":"[DEMO] Most Likely to Destroy the Family Computer With LimeWire"}');
  SELECT id INTO p FROM game_prompts WHERE show_id=s AND question='[DEMO] Most Likely to Destroy the Family Computer With LimeWire';
  PERFORM game_admin(s,'open',jsonb_build_object('id',p));
  FOR i IN 1..5 LOOP PERFORM game_vote(p,ids[i],cast_ids[1 + (i % array_length(cast_ids,1))]); END LOOP;
  PERFORM game_admin(s,'reveal',jsonb_build_object('id',p));

  PERFORM game_admin(s,'create','{"kind":"superlative","question":"[DEMO] Most Removed From MySpace Top 8"}');
  SELECT id INTO p FROM game_prompts WHERE show_id=s AND question='[DEMO] Most Removed From MySpace Top 8';
  PERFORM game_admin(s,'open',jsonb_build_object('id',p));
  FOR i IN 1..5 LOOP PERFORM game_vote(p,ids[i],CASE WHEN i<=4 THEN cast_ids[2] ELSE cast_ids[1] END); END LOOP;
  -- This one intentionally keeps totals hidden to demonstrate host-controlled reveal.

  PERFORM game_admin(s,'create','{"kind":"trl","question":"[DEMO] Pick the video to close out the night","options":[{"id":"0","label":"Shakira feat. Wyclef Jean — Hips Don’t Lie"},{"id":"1","label":"Nelly Furtado feat. Timbaland — Promiscuous"},{"id":"2","label":"Justin Timberlake — SexyBack"},{"id":"3","label":"Gnarls Barkley — Crazy"}]}');
  SELECT id INTO p FROM game_prompts WHERE show_id=s AND kind='trl';
  PERFORM game_admin(s,'trl_final',jsonb_build_object('id',p));
  PERFORM game_admin(s,'open',jsonb_build_object('id',p));
  FOR i IN 1..5 LOOP PERFORM game_vote(p,ids[i],CASE WHEN i<=3 THEN '0' WHEN i=4 THEN '1' ELSE '2' END); END LOOP;
  PERFORM game_admin(s,'reveal',jsonb_build_object('id',p));

  INSERT INTO game_suggestions(show_id,viewer_id,body) VALUES
    (s,ids[4],'[DEMO] Most Likely to Put Song Lyrics in Their AIM Profile'),
    (s,ids[5],'[DEMO] Most Likely to Spend All Night Customizing Their MySpace');
END $$;
COMMIT;
SELECT kind,status,count(*) FROM game_prompts
WHERE show_id=(SELECT id FROM game_shows WHERE status='active') GROUP BY kind,status ORDER BY kind,status;
