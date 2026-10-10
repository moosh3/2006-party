-- Hosted Supabase only. The isolated tests intentionally do not install a
-- background scheduler. This tick works without any viewers or admin tabs.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  '2006-playout-clock',
  '2 seconds',
  $job$SELECT public.get_playout_snapshot()
    WHERE EXISTS (SELECT 1 FROM public.current_stream WHERE id = 1
      AND playout_mode = 'manual' AND auto_advance_enabled
      AND playback_state = 'playing' AND NOT hold_screen_enabled);$job$
);

-- Retain three days of this application's tick history only. Do not alter
-- other jobs or disable instance-wide cron logging.
SELECT cron.schedule(
  '2006-playout-clock-history',
  '17 5 * * *',
  $job$DELETE FROM cron.job_run_details WHERE jobid IN (
      SELECT jobid FROM cron.job WHERE jobname IN ('2006-playout-clock', '2006-playout-clock-history'))
    AND end_time < clock_timestamp() - interval '3 days';$job$
);
COMMIT;
