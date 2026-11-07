/** Read-only preflight by default; --apply installs the Scores scene and countdown logging without
 * changing live media, queue order, audience admission, votes or audit rows. */
import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

config({ path: '.env.local', quiet: true });
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
const expectedRef = 'zrzhdmdyxzkcwilftkjy';
if (url.hostname !== `${expectedRef}.supabase.co`) throw new Error('This installer is restricted to the existing 2006-party database.');
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Only --apply is supported.');
const migration = readFileSync('sql/030_check_our_scores.sql', 'utf8');
// Keep migration + guard in ONE transaction; never accidentally commit before
// checking state. PL/pgSQL BEGIN is not a standalone BEGIN; line.
if ((migration.match(/^BEGIN;$/gm) || []).length !== 1
  || (migration.match(/^COMMIT;$/gm) || []).length !== 1
  || !/COMMIT;\s*$/.test(migration)) throw new Error('Unexpected migration transaction wrapper.');
const body = migration.replace(/^BEGIN;\r?\n/m, '').replace(/^COMMIT;\s*$/m, '');
const tables = ['current_stream', 'mux_items', 'video_queue', 'audience_doors',
  'game_viewers', 'game_votes', 'admin_actions', 'playout_commands'];
const fingerprint = `md5(jsonb_build_object(${tables.map(name =>
  `'${name}', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM public.${name} t)`
).join(',')} )::text)`;
const scoresInstalled = `position('check-our-scores' in pg_get_functiondef('public.queue_scene_cue(text,numeric,text,text)'::regprocedure)) > 0`;
const verification = `SELECT
  ${scoresInstalled} AS scores_scene_installed,
  position('''countdown''' in pg_get_functiondef('public.playout_advance_at(timestamptz,text,text)'::regprocedure)) > 0 AS countdown_logged,
  has_function_privilege('anon','public.queue_scene_cue(text,numeric,text,text)','EXECUTE') AS anon_can_queue_scene;`;
const statement = apply ? `BEGIN;
  SET LOCAL lock_timeout = '5s';
  SET LOCAL statement_timeout = '30s';
  DO $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('video_queue_order')); END; $$;
  LOCK TABLE ${tables.map(name => `public.${name}`).join(',')} IN SHARE MODE;
  CREATE TEMP TABLE scores_install_guard ON COMMIT DROP AS SELECT ${fingerprint} AS fingerprint;
  ${body}
  DO $$ BEGIN
    IF (SELECT fingerprint FROM scores_install_guard) IS DISTINCT FROM ${fingerprint} THEN
      RAISE EXCEPTION 'Scores migration changed live show or audience state';
    END IF;
  END $$;
  COMMIT;
  ${verification}` : `SELECT
    to_regclass('public.current_stream') IS NOT NULL AS stream_exists,
    to_regclass('public.video_queue') IS NOT NULL AS queue_exists,
    to_regprocedure('public.queue_scene_cue(text,numeric,text,text)') IS NOT NULL AS scene_cues_028_installed,
    ${scoresInstalled} AS scores_scene_installed;`;
console.log(JSON.stringify({ project: expectedRef, mode: apply ? 'install-scores-scene-only' : 'read-only-preflight',
  migrationSha256: createHash('sha256').update(migration).digest('hex') }));
// Hosted SQL requires an explicit execution mode. The default is enforced read-only;
// --apply opts into the hosted confirmation flag for this guarded migration only.
execFileSync('npx', ['--yes', 'supabase', 'db', 'query', `--remote=${expectedRef}`,
  apply ? '--yes' : '--read-only', statement], { stdio: 'inherit' });
