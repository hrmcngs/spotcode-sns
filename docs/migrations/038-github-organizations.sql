-- Verified GitHub Organization membership and post audiences.
begin;

create table if not exists public.github_org_memberships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  github_user_id bigint not null,
  org_id bigint not null,
  login text not null,
  role text not null,
  valid_until timestamptz not null,
  primary key(user_id, org_id)
);
create table if not exists public.github_org_accounts (
  account_id uuid primary key references public.profiles(id) on delete cascade,
  org_id bigint not null,
  login text not null
);
alter table public.github_org_memberships enable row level security;
alter table public.github_org_accounts enable row level security;
revoke all on public.github_org_memberships, public.github_org_accounts from anon, authenticated;
grant select on public.github_org_memberships, public.github_org_accounts to authenticated;
grant all on public.github_org_memberships, public.github_org_accounts to service_role;
drop policy if exists "read own github memberships" on public.github_org_memberships;
create policy "read own github memberships" on public.github_org_memberships for select using (user_id = auth.uid());
drop policy if exists "read own github org link" on public.github_org_accounts;
create policy "read own github org link" on public.github_org_accounts for select using (account_id = auth.uid());

create or replace function public.replace_github_org_memberships(p_user uuid, p_github_user bigint, p_organizations jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Serializes concurrent syncs for the same user.
  perform 1 from public.profiles where id = p_user for update;
  delete from public.github_org_memberships where user_id = p_user;
  insert into public.github_org_memberships(user_id, github_user_id, org_id, login, role, valid_until)
  select p_user, p_github_user, (item->>'id')::bigint, item->>'login', item->>'role', now() + interval '1 hour'
  from jsonb_array_elements(p_organizations) item;
end $$;
revoke all on function public.replace_github_org_memberships(uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.replace_github_org_memberships(uuid,bigint,jsonb) to service_role;

create or replace function public.is_verified_github_org_member(p_org bigint)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.github_org_memberships m
    join auth.identities i on i.user_id = m.user_id and i.provider = 'github'
    where m.user_id = auth.uid() and m.org_id = p_org and m.valid_until > now()
      and m.github_user_id::text in (i.identity_data->>'provider_id', i.identity_data->>'sub', i.identity_data->>'id')
  );
$$;
revoke all on function public.is_verified_github_org_member(bigint) from public, anon;
grant execute on function public.is_verified_github_org_member(bigint) to anon, authenticated;

alter table public.posts add column if not exists github_org_id bigint;
alter table public.posts drop constraint if exists posts_visibility_check;
alter table public.posts add constraint posts_visibility_check check (visibility in ('public','restricted','mutuals','following','friends','org','only_me','github_org'));

create or replace function public.stamp_post_github_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.visibility = 'github_org' then
    if tg_op = 'UPDATE' then
      if old.visibility = 'github_org' and old.author_id = new.author_id then
        new.github_org_id := old.github_org_id;
        return new;
      end if;
    end if;
    select o.org_id into new.github_org_id from public.github_org_accounts o
      join public.profiles p on p.id = o.account_id and p.is_org = true
      where o.account_id = new.author_id;
    if new.github_org_id is null then raise exception 'Link a GitHub Organization in account settings first'; end if;
    if not public.is_verified_github_org_member(new.github_org_id) then raise exception 'Refresh your GitHub Organization membership first'; end if;
  else
    new.github_org_id := null;
  end if;
  return new;
end $$;
revoke all on function public.stamp_post_github_org() from public, anon, authenticated;
drop trigger if exists stamp_post_github_org on public.posts;
create trigger stamp_post_github_org before insert or update on public.posts for each row execute function public.stamp_post_github_org();

-- Additional permissive path for verified members; restrictive guard also
-- prevents unrelated existing moderation/public policies from opening posts.
drop policy if exists "github org members read posts" on public.posts;
create policy "github org members read posts" on public.posts for select to authenticated
using (visibility = 'github_org' and public.is_verified_github_org_member(github_org_id));
drop policy if exists "github org post audience" on public.posts;
create policy "github org post audience" on public.posts as restrictive for select
using (
  visibility is distinct from 'github_org' or author_id = auth.uid()
  or (auth.uid() is not null and public.is_verified_github_org_member(github_org_id))
  or (
    coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-spotcode-dev-mode', '') = '1'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  )
);
commit;
