-- Requires pg_cron extension enabled in Supabase project.
create extension if not exists pg_cron;

-- Run every day at 15:10 UTC (= 00:10 JST next day).
-- The function itself only performs work when JST day is 1.
select cron.unschedule(jobid)
from cron.job
where jobname = 'monthly_quote_batch_jst';

select cron.schedule(
  'monthly_quote_batch_jst',
  '10 15 * * *',
  $$select public.run_monthly_quote_batch();$$
);
