begin;
create table if not exists public.user_mutes (
 user_id uuid not null references public.profiles(id) on delete cascade,
 muted_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(user_id,muted_id), check(user_id<>muted_id)
);
alter table public.user_mutes enable row level security;
revoke all on public.user_mutes from anon,authenticated;
grant select,insert,delete on public.user_mutes to authenticated;
drop policy if exists "manage own mutes" on public.user_mutes;
create policy "manage own mutes" on public.user_mutes to authenticated
 using(user_id=auth.uid()) with check(user_id=auth.uid());

-- Modify one list membership atomically so concurrent selections do not
-- replace other members or unrelated profile preferences.
create or replace function public.set_audience_member(p_target uuid,p_kind text,p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
declare target_handle text; members text[];
begin
 if auth.uid() is null or p_target=auth.uid() or p_kind is null or p_kind not in ('friends','org') or p_enabled is null then
  raise exception 'Invalid audience member';
 end if;
 select handle into target_handle from profiles where id=p_target;
 if target_handle is null then raise exception 'User not found'; end if;
 if p_enabled and not exists(select 1 from follows where follower_id=auth.uid() and target_id=p_target and status='accepted') then
  raise exception '先にこのユーザーをフォローしてください';
 end if;
 select case when p_kind='friends' then close_friends else org_members end into members
 from profiles where id=auth.uid() for update;
 members := array_remove(coalesce(members,'{}'),target_handle);
 if p_enabled then members := array_append(members,target_handle); end if;
 if p_kind='friends' then update profiles set close_friends=members where id=auth.uid();
 else update profiles set org_members=members where id=auth.uid(); end if;
end $$;
revoke all on function public.set_audience_member(uuid,text,boolean) from public,anon;
grant execute on function public.set_audience_member(uuid,text,boolean) to authenticated;

-- Invoker rights preserve posts RLS (private accounts and every audience).
-- Only the coarse district is returned as notification context, never GPS.
create or replace function public.followed_post_notifications(p_scope text default 'off',p_limit integer default 30)
returns table(post jsonb,district text)
language sql stable security invoker set search_path=public as $$
 select to_jsonb(p) || jsonb_build_object('author',jsonb_build_object(
   'id',a.id,'handle',a.handle,'name',a.name,'avatar_url',a.avatar_url),
   'organization_author',case when o.id is null then null else jsonb_build_object(
   'id',o.id,'handle',o.handle,'name',o.name,'avatar_url',o.avatar_url) end),
   coalesce(nullif(btrim(p.spot->'addressDetails'->>'city'),''),
     substring(p.spot->>'address' from '[一-龠ぁ-んァ-ヶー]+[市区町村]'),'地区未設定')
 from posts p join profiles a on a.id=p.author_id
 left join profiles o on o.id=p.organization_author_id
 where p.created_at<=now() and auth.uid() is not null and p_scope in ('following','mutuals')
 and p.author_id<>auth.uid() and coalesce(p.organization_author_id,p.author_id)<>auth.uid()
 and exists(select 1 from follows f where f.follower_id=auth.uid()
   and f.target_id=coalesce(p.organization_author_id,p.author_id) and f.status='accepted')
 and (p_scope='following' or exists(select 1 from follows f where f.target_id=auth.uid()
   and f.follower_id=coalesce(p.organization_author_id,p.author_id) and f.status='accepted'))
 and not exists(select 1 from user_mutes m where m.user_id=auth.uid() and m.muted_id in(p.author_id,p.organization_author_id))
 and not exists(select 1 from user_blocks b where b.blocker_id=auth.uid() and b.blocked_id in(p.author_id,p.organization_author_id))
 order by p.created_at desc,p.id desc limit greatest(1,least(coalesce(p_limit,30),100));
$$;
revoke all on function public.followed_post_notifications(text,integer) from public,anon;
grant execute on function public.followed_post_notifications(text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
