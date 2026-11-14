/** Read-only by default. Installs full-list trivia controls without changing existing game data. */
import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
config({ path: '.env.local', quiet: true });
const expectedRef = 'zrzhdmdyxzkcwilftkjy';
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname !== `${expectedRef}.supabase.co`)
  throw new Error('This installer is restricted to the existing 2006-party database.');
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Only --apply is supported.');
const migration = readFileSync('sql/033_trivia_list.sql', 'utf8');
if ((migration.match(/^BEGIN;$/gm) || []).length !== 1 || (migration.match(/^COMMIT;$/gm) || []).length !== 1)
  throw new Error('Unexpected migration wrapper.');
const body = migration.replace(/^BEGIN;\r?\n/m, '').replace(/^COMMIT;\s*$/m, '');
const tables = ['game_shows', 'game_cast', 'game_prompts', 'game_votes', 'game_viewers', 'game_suggestions', 'admin_actions'];
const fingerprint = `md5(jsonb_build_object(${tables.map(name =>
  `'${name}', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM public.${name} t)`
).join(',')})::text)`;
const verification = `SELECT
  to_regclass('public.game_one_open_trivia') IS NULL AS list_limit_removed,
  to_regprocedure('public.game_trivia_list(uuid,text)') IS NOT NULL AS list_controls_installed,
  strpos(pg_get_functiondef('public.game_admin(uuid,text,jsonb)'::regprocedure), 'Close the current trivia question first')=0 AS legacy_guard_removed;`;
const statement = apply ? `BEGIN;
 SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
 LOCK TABLE ${tables.map(t => `public.${t}`).join(',')} IN SHARE MODE;
 CREATE TEMP TABLE trivia_list_install_guard ON COMMIT DROP AS SELECT ${fingerprint} AS fingerprint;
 ${body}
 DO $$ BEGIN IF (SELECT fingerprint FROM trivia_list_install_guard) IS DISTINCT FROM ${fingerprint} THEN
   RAISE EXCEPTION 'Trivia migration changed existing game state';
 END IF; END $$;
 COMMIT;
 ${verification}` : verification;
console.log(JSON.stringify({ project: expectedRef, mode: apply ? 'install-trivia-list-only' : 'read-only-preflight',
 migrationSha256: createHash('sha256').update(migration).digest('hex') }));
execFileSync('npx', ['--yes', 'supabase', 'db', 'query', `--remote=${expectedRef}`, apply ? '--yes' : '--read-only', statement], { stdio: 'inherit', timeout: 45000 });
