-- Stage 35 — Only-me posts (apply before deploying the clients).
-- Restrictive policy also blocks the existing staff moderation exceptions.
-- Existing audience policies still decide access to all other posts.
begin;

alter table public.posts drop constraint if exists posts_visibility_check;
alter table public.posts add constraint posts_visibility_check
  check (visibility in ('public', 'restricted', 'mutuals', 'following', 'friends', 'org', 'only_me'));

drop policy if exists "only-me posts belong to their author" on public.posts;
create policy "only-me posts belong to their author"
  on public.posts as restrictive for all
  using (visibility is distinct from 'only_me' or auth.uid() = author_id)
  with check (visibility is distinct from 'only_me' or auth.uid() = author_id);

commit;
