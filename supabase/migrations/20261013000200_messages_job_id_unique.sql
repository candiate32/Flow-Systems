-- A job sends at most one message, whatever happens to its status later.
-- The first version of this index only covered `status = 'sent'`, so once a
-- delivery receipt moves the row to delivered/read (slice C), a reclaimed job
-- would no longer find its earlier send and could send again. The run-jobs
-- handler only inserts a message after the provider accepted it, so every
-- message with a job_id is a real send.
drop index if exists public.messages_job_id_sent_key;
create unique index messages_job_id_key
  on public.messages (job_id)
  where job_id is not null;
