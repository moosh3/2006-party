/** Read-only preflight by default; --apply installs essay submissions without
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
const migration = readFileSync('sql/029_essay_submissions.sql', 'utf8');
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
const verification = `SELECT
  to_regclass('public.essay_submissions') IS NOT NULL AS essays_installed,
  has_table_privilege('anon','public.essay_submissions','SELECT') AS anon_can_read_essays,
  has_function_privilege('anon','public.essay_submit(uuid,integer,text,text)','EXECUTE') AS anon_can_submit;`;
const statement = apply ? `BEGIN;
  SET LOCAL lock_timeout = '5s';
  SET LOCAL statement_timeout = '30s';
  LOCK TABLE ${tables.map(name => `public.${name}`).join(',')} IN SHARE MODE;
  CREATE TEMP TABLE essay_install_guard ON COMMIT DROP AS SELECT ${fingerprint} AS fingerprint;
  ${body}
  DO $$ BEGIN
    IF (SELECT fingerprint FROM essay_install_guard) IS DISTINCT FROM ${fingerprint} THEN
      RAISE EXCEPTION 'Essay migration changed live show or audience state';
    END IF;
  END $$;
  COMMIT;
  ${verification}` : `SELECT
    to_regclass('public.game_viewers') IS NOT NULL AS game_viewers_exist,
    to_regclass('public.audience_doors') IS NOT NULL AS audience_doors_exist,
    to_regclass('public.admin_actions') IS NOT NULL AS admin_actions_exist,
    to_regclass('public.essay_submissions') IS NOT NULL AS essays_installed;`;
console.log(JSON.stringify({ project: expectedRef, mode: apply ? 'install-essay-submissions-only' : 'read-only-preflight',
  migrationSha256: createHash('sha256').update(migration).digest('hex') }));
// Hosted SQL requires an explicit execution mode. The default is enforced read-only;
// --apply opts into the hosted confirmation flag for this guarded migration only.
execFileSync('npx', ['--yes', 'supabase', 'db', 'query', `--remote=${expectedRef}`,
  apply ? '--yes' : '--read-only', statement], { stdio: 'inherit' });
