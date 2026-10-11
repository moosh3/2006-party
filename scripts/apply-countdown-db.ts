/** Read-only preflight by default; --apply installs countdown support without
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
const migration = readFileSync('sql/026_countdown_queue.sql', 'utf8');
// Keep migration + guard in ONE transaction; never accidentally commit before
// checking state. PL/pgSQL BEGIN is not a standalone BEGIN; line.
if ((migration.match(/^BEGIN;$/gm) || []).length !== 1
  || (migration.match(/^COMMIT;$/gm) || []).length !== 1
  || !/COMMIT;\s*$/.test(migration)) throw new Error('Unexpected migration transaction wrapper.');
const body = migration.replace(/^BEGIN;\r?\n/m, '').replace(/^COMMIT;\s*$/m, '');
const tables = ['current_stream', 'mux_items', 'video_queue', 'audience_doors',
  'game_viewers', 'game_votes', 'admin_actions', 'playout_commands'];
const fingerprint = `md5(jsonb_build_object(${tables.map(name =>
  `'${name}', (SELECT coalesce(jsonb_agg((to_jsonb(t) || jsonb_build_object('countdown',to_jsonb(t)->'countdown')) ORDER BY (to_jsonb(t) || jsonb_build_object('countdown',to_jsonb(t)->'countdown'))::text), '[]'::jsonb) FROM public.${name} t)`
).join(',')} )::text)`;
const verification = `SELECT
  to_regprocedure('public.save_countdown_cue(uuid,jsonb,text,uuid,text)') IS NOT NULL AS countdown_installed,
  has_function_privilege('anon','public.get_playout_snapshot()','EXECUTE') AS anon_can_operate,
  has_function_privilege('service_role','public.get_playout_snapshot()','EXECUTE') AS service_can_operate;`;
const statement = apply ? `BEGIN;
  SET LOCAL lock_timeout = '5s';
  SET LOCAL statement_timeout = '30s';
  DO $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('video_queue_order')); END; $$;
  LOCK TABLE ${tables.map(name => `public.${name}`).join(',')} IN SHARE MODE;
  CREATE TEMP TABLE countdown_install_guard ON COMMIT DROP AS SELECT ${fingerprint} AS fingerprint;
  ${body}
  DO $$ BEGIN
    IF (SELECT fingerprint FROM countdown_install_guard) IS DISTINCT FROM ${fingerprint} THEN
      RAISE EXCEPTION 'Countdown migration changed live show or audience state';
    END IF;
  END $$;
  COMMIT;
  ${verification}` : `SELECT
    to_regclass('public.current_stream') IS NOT NULL AS stream_exists,
    to_regclass('public.video_queue') IS NOT NULL AS queue_exists,
    to_regclass('public.audience_doors') IS NOT NULL AS admission_exists,
    to_regprocedure('public.playout_is_queue_media(public.mux_items)') IS NOT NULL AS queue_prerequisite_installed;`;
console.log(JSON.stringify({ project: expectedRef, mode: apply ? 'install-countdown-support-only' : 'read-only-preflight',
  migrationSha256: createHash('sha256').update(migration).digest('hex') }));
execFileSync('npx', ['--yes', 'supabase', 'db', 'query', '--linked', '--project-ref', expectedRef, statement], { stdio: 'inherit' });
