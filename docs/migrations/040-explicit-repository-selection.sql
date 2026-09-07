-- Explicit opt-in: existing implicit 'all repositories' is not a selection.
begin;
alter table public.issue_display_preferences
  add column if not exists selected_repos text[] not null default '{}';
notify pgrst, 'reload schema';
commit;
