-- Stage 36 — Admin read access to only-me posts in developer mode.
begin;

drop policy if exists "only-me posts belong to their author" on public.posts;

drop policy if exists "only-me read access" on public.posts;
create policy "only-me read access" on public.posts as restrictive for select
using (
  visibility is distinct from 'only_me'
  or auth.uid() = author_id
  or (
    coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-spotcode-dev-mode', '') = '1'
    and exists (select 1 from public.profiles viewer where viewer.id = auth.uid() and viewer.is_admin = true)
  )
);

-- Preserve author-only writes; developer mode adds viewing access only.
drop policy if exists "only-me insert access" on public.posts;
create policy "only-me insert access" on public.posts as restrictive for insert
with check (visibility is distinct from 'only_me' or auth.uid() = author_id);

drop policy if exists "only-me update access" on public.posts;
create policy "only-me update access" on public.posts as restrictive for update
using (visibility is distinct from 'only_me' or auth.uid() = author_id)
with check (visibility is distinct from 'only_me' or auth.uid() = author_id);

drop policy if exists "only-me delete access" on public.posts;
create policy "only-me delete access" on public.posts as restrictive for delete
using (visibility is distinct from 'only_me' or auth.uid() = author_id);

commit;
