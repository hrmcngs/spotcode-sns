-- Allow authenticated admins/operators to follow as the official account.
begin;

drop policy if exists "users insert their own follows"          on public.follows;
drop policy if exists "users or staff-as-official insert follows" on public.follows;
create policy "users or staff-as-official insert follows"
  on public.follows for insert with check (
    auth.uid() = follower_id
    or (
      exists (select 1 from public.profiles where id = follower_id and is_official = true)
      and
      exists (select 1 from public.profiles where id = auth.uid() and (is_admin = true or is_operator = true))
    )
  );

drop policy if exists "users delete their own follows"          on public.follows;
drop policy if exists "users or staff-as-official delete follows" on public.follows;
create policy "users or staff-as-official delete follows"
  on public.follows for delete using (
    auth.uid() = follower_id
    or (
      exists (select 1 from public.profiles where id = follower_id and is_official = true)
      and
      exists (select 1 from public.profiles where id = auth.uid() and (is_admin = true or is_operator = true))
    )
  );

commit;
