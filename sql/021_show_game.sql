BEGIN;

-- Private, server-managed game data. No answer keys or pending suggestions
-- are exposed through the public Supabase API or realtime publication.
CREATE TABLE game_shows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','finished')),
  results_visible boolean NOT NULL DEFAULT false,
  suggestions_open boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX game_one_active_show ON game_shows ((status)) WHERE status = 'active';
CREATE TABLE game_viewers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 20),
  blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE game_cast (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES game_shows(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  UNIQUE(show_id, name)
);
CREATE TABLE game_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES game_shows(id),
  kind text NOT NULL CHECK (kind IN ('trl','trivia','superlative')),
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 300),
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 30),
  correct_option text,
  trl_final boolean NOT NULL DEFAULT false CHECK (NOT trl_final OR kind='trl'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  results_visible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'trivia') = (correct_option IS NOT NULL))
);
CREATE UNIQUE INDEX game_one_open_trivia ON game_prompts(show_id) WHERE kind='trivia' AND status='open';
CREATE UNIQUE INDEX game_one_trl_final ON game_prompts(show_id) WHERE trl_final;
CREATE TABLE game_votes (
  prompt_id uuid NOT NULL REFERENCES game_prompts(id),
  viewer_id uuid NOT NULL REFERENCES game_viewers(id),
  option_id text NOT NULL,
  PRIMARY KEY(prompt_id, viewer_id)
);
CREATE TABLE game_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES game_shows(id),
  viewer_id uuid NOT NULL REFERENCES game_viewers(id),
  body text NOT NULL CHECK (length(body) BETWEEN 3 AND 200),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  prompt_id uuid REFERENCES game_prompts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE game_limits (key text PRIMARY KEY, touched_at timestamptz NOT NULL);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['game_shows','game_viewers','game_cast','game_prompts','game_votes','game_suggestions','game_limits'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END $$;

-- Atomic throttle, shared across server instances.
CREATE FUNCTION game_throttle(k text, seconds integer) RETURNS boolean
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE affected integer;
BEGIN
  INSERT INTO game_limits VALUES(k, clock_timestamp())
  ON CONFLICT(key) DO UPDATE SET touched_at=EXCLUDED.touched_at
  WHERE game_limits.touched_at < clock_timestamp() - make_interval(secs => seconds);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected=1;
END $$;

-- Lock the show before its prompt, so closing a round/show cannot race a vote.
CREATE FUNCTION game_vote(p uuid, v uuid, o text) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE prompt game_prompts; show_status text; sid uuid;
BEGIN
  SELECT show_id INTO sid FROM game_prompts WHERE id=p;
  SELECT status INTO show_status FROM game_shows WHERE id=sid FOR SHARE;
  IF show_status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'Show is not accepting votes'; END IF;
  PERFORM 1 FROM game_viewers WHERE id=v AND NOT blocked FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participation unavailable'; END IF;
  SELECT * INTO prompt FROM game_prompts WHERE id=p FOR SHARE;
  IF prompt.status IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'Poll is closed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(prompt.options) x WHERE x->>'id'=o) THEN
    RAISE EXCEPTION 'Invalid answer';
  END IF;
  IF prompt.kind='trivia' THEN
    INSERT INTO game_votes VALUES(p,v,o) ON CONFLICT DO NOTHING;
    IF NOT FOUND THEN RAISE EXCEPTION 'Your trivia answer is already locked'; END IF;
  ELSE
    INSERT INTO game_votes VALUES(p,v,o) ON CONFLICT(prompt_id,viewer_id) DO UPDATE SET option_id=EXCLUDED.option_id;
  END IF;
END $$;

CREATE FUNCTION game_suggest(s uuid, v uuid, body_text text) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM game_shows WHERE id=s AND status='active' AND suggestions_open FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Suggestions are closed'; END IF;
  PERFORM 1 FROM game_viewers WHERE id=v AND NOT blocked FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participation unavailable'; END IF;
  IF NOT game_throttle('suggest:'||v,30) THEN RAISE EXCEPTION 'Please wait 30 seconds between suggestions'; END IF;
  IF (SELECT count(*) FROM game_suggestions WHERE show_id=s AND viewer_id=v)>=10 THEN
    RAISE EXCEPTION 'You have reached the ten-suggestion limit for this show';
  END IF;
  INSERT INTO game_suggestions(show_id,viewer_id,body) VALUES(s,v,body_text);
END $$;

-- Aggregates in Postgres, avoiding the Data API row limit for large audiences.
CREATE FUNCTION game_totals(s uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT jsonb_build_object(
    'counts', coalesce((SELECT jsonb_agg(x) FROM (
      SELECT v.prompt_id,v.option_id,count(*)::int AS count FROM game_votes v
      JOIN game_prompts p ON p.id=v.prompt_id JOIN game_viewers u ON u.id=v.viewer_id
      WHERE p.show_id=s AND NOT u.blocked GROUP BY v.prompt_id,v.option_id
    ) x),'[]'::jsonb),
    'scores', coalesce((SELECT jsonb_agg(x) FROM (
      SELECT u.id,u.name,count(*) FILTER (WHERE v.option_id=p.correct_option)::int AS score
      FROM game_votes v JOIN game_prompts p ON p.id=v.prompt_id JOIN game_viewers u ON u.id=v.viewer_id
      WHERE p.show_id=s AND p.kind='trivia' AND p.status='closed' AND NOT u.blocked
      GROUP BY u.id,u.name ORDER BY score DESC,u.id
    ) x),'[]'::jsonb)
  );
$$;

CREATE FUNCTION game_admin(s uuid, action text, payload jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE sh game_shows; p game_prompts; sg game_suggestions; opts jsonb; new_id uuid; k text;
BEGIN
  SELECT * INTO sh FROM game_shows WHERE id=s FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Show not found'; END IF;
  IF action='reveal_show' THEN UPDATE game_shows SET results_visible=NOT results_visible WHERE id=s; RETURN; END IF;
  IF action='block' THEN UPDATE game_viewers SET blocked=true WHERE id=(payload->>'viewerId')::uuid; RETURN; END IF;
  IF action='unblock' THEN UPDATE game_viewers SET blocked=false WHERE id=(payload->>'viewerId')::uuid; RETURN; END IF;
  IF action='rename' THEN UPDATE game_viewers SET name=payload->>'name' WHERE id=(payload->>'viewerId')::uuid; RETURN; END IF;
  IF sh.status<>'active' THEN RAISE EXCEPTION 'Show has ended'; END IF;
  IF action='finish' THEN
    UPDATE game_prompts SET status='closed' WHERE show_id=s AND status='open';
    UPDATE game_shows SET status='finished',suggestions_open=false WHERE id=s; RETURN;
  END IF;
  IF action='suggestions' THEN UPDATE game_shows SET suggestions_open=NOT suggestions_open WHERE id=s; RETURN; END IF;
  IF action='cast' THEN
    IF EXISTS(SELECT 1 FROM game_prompts WHERE show_id=s AND kind='superlative') THEN RAISE EXCEPTION 'Cast is locked once superlatives are created'; END IF;
    DELETE FROM game_cast WHERE show_id=s;
    INSERT INTO game_cast(show_id,name) SELECT s,jsonb_array_elements_text(payload->'names'); RETURN;
  END IF;
  IF action IN ('create','approve') THEN
    IF (SELECT count(*) FROM game_prompts WHERE show_id=s)>=200 THEN RAISE EXCEPTION 'This show has reached its 200-round limit'; END IF;
    k := payload->>'kind';
    IF action='approve' THEN
      SELECT * INTO sg FROM game_suggestions WHERE id=(payload->>'id')::uuid AND show_id=s AND status='pending' FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Suggestion is no longer pending'; END IF;
      k := 'superlative';
    END IF;
    IF k='superlative' THEN
      SELECT jsonb_agg(jsonb_build_object('id',id::text,'label',name) ORDER BY name) INTO opts FROM game_cast WHERE show_id=s;
      IF opts IS NULL OR jsonb_array_length(opts)<2 THEN RAISE EXCEPTION 'Set at least two cast members first'; END IF;
    ELSE opts := payload->'options'; END IF;
    IF k='trivia' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(opts) x WHERE x->>'id'=payload->>'correctOption') THEN
      RAISE EXCEPTION 'Choose a correct answer';
    END IF;
    INSERT INTO game_prompts(show_id,kind,question,options,correct_option)
    VALUES(s,k,payload->>'question',opts,CASE WHEN k='trivia' THEN payload->>'correctOption' END) RETURNING id INTO new_id;
    IF action='approve' THEN UPDATE game_suggestions SET status='approved',prompt_id=new_id WHERE id=sg.id; END IF;
    RETURN;
  END IF;
  IF action='reject' THEN UPDATE game_suggestions SET status='rejected' WHERE id=(payload->>'id')::uuid AND show_id=s AND status='pending'; RETURN; END IF;
  SELECT * INTO p FROM game_prompts WHERE id=(payload->>'id')::uuid AND show_id=s FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Poll not found'; END IF;
  IF action='open' THEN
    IF p.status<>'draft' THEN RAISE EXCEPTION 'Only drafts can open'; END IF;
    IF p.kind='trivia' AND EXISTS(SELECT 1 FROM game_prompts WHERE show_id=s AND kind='trivia' AND status='open') THEN RAISE EXCEPTION 'Close the current trivia question first'; END IF;
    UPDATE game_prompts SET status='open' WHERE id=p.id;
  ELSIF action='trl_final' THEN
    IF p.kind<>'trl' THEN RAISE EXCEPTION 'Choose a TRL round'; END IF;
    UPDATE game_prompts SET trl_final=false WHERE show_id=s AND trl_final;
    UPDATE game_prompts SET trl_final=true WHERE id=p.id;
  ELSIF action='close' THEN UPDATE game_prompts SET status='closed' WHERE id=p.id AND status='open';
  ELSIF action='reveal' THEN
    IF p.kind='trivia' AND p.status<>'closed' THEN RAISE EXCEPTION 'Close trivia before revealing its answer'; END IF;
    UPDATE game_prompts SET results_visible=NOT results_visible WHERE id=p.id;
  ELSIF action='edit' THEN
    IF p.status<>'draft' THEN RAISE EXCEPTION 'Only drafts can be edited'; END IF;
    IF payload->>'kind' IS DISTINCT FROM p.kind THEN RAISE EXCEPTION 'Round type cannot change'; END IF;
    IF p.kind='trivia' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'options') x WHERE x->>'id'=payload->>'correctOption') THEN RAISE EXCEPTION 'Choose a correct answer'; END IF;
    UPDATE game_prompts SET question=payload->>'question',
      options=CASE WHEN p.kind='superlative' THEN p.options ELSE payload->'options' END,
      correct_option=CASE WHEN p.kind='trivia' THEN payload->>'correctOption' END WHERE id=p.id;
  ELSIF action='discard' THEN
    IF p.status<>'draft' THEN RAISE EXCEPTION 'Only private drafts can be discarded'; END IF;
    UPDATE game_suggestions SET prompt_id=null WHERE prompt_id=p.id;
    DELETE FROM game_prompts WHERE id=p.id;
  ELSE RAISE EXCEPTION 'Unknown action'; END IF;
END $$;

REVOKE ALL ON FUNCTION game_throttle(text,integer),game_vote(uuid,uuid,text),game_suggest(uuid,uuid,text),game_totals(uuid),game_admin(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION game_throttle(text,integer),game_vote(uuid,uuid,text),game_suggest(uuid,uuid,text),game_totals(uuid),game_admin(uuid,text,jsonb) TO service_role;

-- Existing polling writes already go through authenticated admin routes or
-- the server vote route. Public reads remain for existing realtime cards.
DROP POLICY IF EXISTS "Allow insert polls" ON polls;
DROP POLICY IF EXISTS "Allow update polls" ON polls;
DROP POLICY IF EXISTS "Allow insert poll_options" ON poll_options;
DROP POLICY IF EXISTS "Allow insert poll_votes" ON poll_votes;
DROP POLICY IF EXISTS "Allow update poll_votes" ON poll_votes;
NOTIFY pgrst, 'reload schema';
COMMIT;
