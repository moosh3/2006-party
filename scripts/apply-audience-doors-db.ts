/** Install only the admission gate on the already configured Supabase project.
 * Auth comes from the CLI's existing login; never print credentials or rows.
 * Without --apply, this command performs a read-only schema preflight.
 */
import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

config({ path: '.env.local', quiet: true });
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
if (!/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)) throw new Error('Expected the configured hosted Supabase project.');
const ref = url.hostname.split('.')[0];
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Only --apply is supported.');

// A transactional guard proves this migration did not change the show. Only
// its hash lives in a temporary table; no viewer data leaves the database.
const fingerprint = `md5(jsonb_build_object(
  'stream', (SELECT to_jsonb(s) FROM public.current_stream s WHERE id=1),
  'queue', (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id), '[]'::jsonb) FROM public.video_queue q),
  'viewers', (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id), '[]'::jsonb) FROM public.game_viewers v),
  'votes', (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.prompt_id, v.viewer_id), '[]'::jsonb) FROM public.game_votes v)
)::text)`;
const migration = readFileSync('sql/024_audience_doors.sql', 'utf8');
const statement = apply ? `BEGIN;
  LOCK TABLE public.current_stream, public.video_queue, public.game_viewers, public.game_votes IN SHARE MODE;
  CREATE TEMP TABLE audience_doors_install_guard ON COMMIT DROP AS SELECT ${fingerprint} AS fingerprint;
  ${migration}
  DO $$ BEGIN
    IF (SELECT fingerprint FROM audience_doors_install_guard) IS DISTINCT FROM ${fingerprint} THEN
      RAISE EXCEPTION 'Admission migration changed unrelated show state';
    END IF;
  END $$;
  COMMIT;
  SELECT doors_open, revision, changed_at,
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.audience_doors'::regclass) AS rls_enabled,
    has_table_privilege('anon','public.audience_doors','SELECT') AS anon_can_read,
    has_function_privilege('anon','public.set_audience_doors(boolean,bigint,text)','EXECUTE') AS anon_can_operate
  FROM public.audience_doors WHERE id=1;`
  : `SELECT to_regclass('public.audience_doors') IS NOT NULL AS gate_exists,
      to_regclass('public.game_viewers') IS NOT NULL AS viewers_exist,
      to_regclass('public.admin_actions') IS NOT NULL AS audit_exists;`;
console.log(JSON.stringify({ project: ref, mode: apply ? 'install-admission-only' : 'read-only-preflight',
  migrationSha256: createHash('sha256').update(migration).digest('hex') }));
execFileSync('npx', ['--yes', 'supabase', 'db', 'query', '--linked', '--project-ref', ref, statement], { stdio: 'inherit' });
