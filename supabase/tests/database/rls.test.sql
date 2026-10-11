-- Guard from the roadmap: every table in the public schema has row-level security on.
-- Holds from day one, so a table added without RLS fails CI.
begin;
select plan(1);

select is_empty(
  $$ select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and not c.relrowsecurity $$,
  'every public table has row-level security enabled'
);

select * from finish();
rollback;
