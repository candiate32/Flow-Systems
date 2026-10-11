-- Spec 004, slice A, item 3: pg_cron calls the run-jobs Edge Function every
-- minute through pg_net, with a shared secret header.
--
-- The URL and the secret are not in this file. They live in Supabase Vault:
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/run-jobs', 'run_jobs_url');
--   select vault.create_secret('<same value as the RUN_JOBS_SECRET function secret>', 'run_jobs_secret');
--
-- and the function gets the same secret with
-- `supabase secrets set RUN_JOBS_SECRET=<value>`. Until both Vault secrets
-- exist the cron job runs and does nothing (no request, no error), which is
-- also what happens on a local stack that hasn't set them.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Posts to run-jobs when configured. Returns the pg_net request id, or null
-- when the Vault secrets are missing. Security definer so the cron job can
-- read Vault; nobody else may call it.
create function private.invoke_run_jobs()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  fn_url text;
  fn_secret text;
begin
  select s.decrypted_secret into fn_url
    from vault.decrypted_secrets s where s.name = 'run_jobs_url' limit 1;
  select s.decrypted_secret into fn_secret
    from vault.decrypted_secrets s where s.name = 'run_jobs_secret' limit 1;
  if coalesce(fn_url, '') = '' or coalesce(fn_secret, '') = '' then
    return null;
  end if;
  return net.http_post(
    url := fn_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-run-jobs-secret', fn_secret
    ),
    -- run-jobs stops claiming after ~40 s; leave it time to finish.
    timeout_milliseconds := 55000
  );
end;
$$;
revoke execute on function private.invoke_run_jobs() from public, anon, authenticated;

-- cron.schedule with a job name updates the job if it already exists.
select cron.schedule('run-jobs', '* * * * *', 'select private.invoke_run_jobs()');
