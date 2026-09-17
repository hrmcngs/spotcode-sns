begin;
-- Multiple calendar-day/link pairs for one event post. Existing posts are unchanged.
alter table public.posts add column if not exists event_days jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'posts_event_days_array' and conrelid = 'public.posts'::regclass) then
    alter table public.posts add constraint posts_event_days_array
      check (event_days is null or jsonb_typeof(event_days) = 'array');
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
