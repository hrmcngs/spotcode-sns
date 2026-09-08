begin;
create table if not exists public.user_blocks (
 blocker_id uuid not null references public.profiles(id) on delete cascade,
 blocked_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(blocker_id,blocked_id), check(blocker_id<>blocked_id)
);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon,authenticated;
grant select,delete on public.user_blocks to authenticated;
drop policy if exists "read own blocks" on public.user_blocks;
create policy "read own blocks" on public.user_blocks for select to authenticated using(blocker_id=auth.uid());
drop policy if exists "remove own blocks" on public.user_blocks;
create policy "remove own blocks" on public.user_blocks for delete to authenticated using(blocker_id=auth.uid());
create table if not exists public.moderation_events (
 id uuid primary key default gen_random_uuid(),
 reporter_id uuid references public.profiles(id) on delete set null,
 target_id uuid references public.profiles(id) on delete set null,
 post_id uuid references public.posts(id) on delete set null,
 kind text not null, detail text not null,
 created_at timestamptz not null default now()
);
alter table public.moderation_events enable row level security;
revoke all on public.moderation_events from anon,authenticated;
grant select on public.moderation_events to authenticated;
drop policy if exists "staff read safety notifications" on public.moderation_events;
create policy "staff read safety notifications" on public.moderation_events for select to authenticated
 using(exists(select 1 from public.profiles where id=auth.uid() and (is_admin or is_operator)));
create or replace function public.block_user(p_target uuid,p_post uuid default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or auth.uid()=p_target then raise exception 'Invalid block target'; end if;
 if p_post is not null and not exists(select 1 from posts where id=p_post and (author_id=p_target or organization_author_id=p_target)) then raise exception 'Invalid post'; end if;
 insert into user_blocks(blocker_id,blocked_id) values(auth.uid(),p_target) on conflict do nothing;
 if found then
  insert into moderation_events(reporter_id,target_id,post_id,kind,detail)
  values(auth.uid(),p_target,p_post,'block','User blocked this account. Review the account and associated content.');
 end if;
end $$;
revoke all on function public.block_user(uuid,uuid) from public,anon;
grant execute on function public.block_user(uuid,uuid) to authenticated;
create or replace function public.notify_content_report()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into moderation_events(reporter_id,target_id,post_id,kind,detail)
 select new.reporter_id,p.author_id,new.post_id,'report',new.reason || ': ' || coalesce(new.comment,'') from posts p where p.id=new.post_id;
 return new;
end $$;
revoke all on function public.notify_content_report() from public,anon,authenticated;
drop trigger if exists notify_content_report on public.reports;
create trigger notify_content_report after insert on public.reports for each row execute function public.notify_content_report();
create or replace function public.has_blocked(p_target uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from user_blocks where blocker_id=auth.uid() and blocked_id=p_target);
$$;
revoke all on function public.has_blocked(uuid) from public;
grant execute on function public.has_blocked(uuid) to anon,authenticated;
drop policy if exists "hide blocked posts" on public.posts;
create policy "hide blocked posts" on public.posts as restrictive for select
 using(not public.has_blocked(author_id) and not public.has_blocked(organization_author_id));
drop policy if exists "hide blocked comments" on public.comments;
create policy "hide blocked comments" on public.comments as restrictive for select using(not public.has_blocked(author_id));
notify pgrst,'reload schema';
commit;
