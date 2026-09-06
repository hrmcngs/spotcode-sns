-- Stage 39: Display member contributions under the linked organization account.
-- Requires Stage 38. author_id remains the actual author for ownership/audiences.
begin;
alter table public.posts add column if not exists organization_author_id uuid
  references public.profiles(id) on delete set null;
-- Also repair installations where the column existed without its foreign key.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.posts'::regclass
    and conname = 'posts_organization_author_id_fkey') then
    alter table public.posts add constraint posts_organization_author_id_fkey
      foreign key (organization_author_id) references public.profiles(id) on delete set null;
  end if;
end $$;
create index if not exists posts_organization_author_idx
  on public.posts(organization_author_id, created_at desc) where organization_author_id is not null;

create or replace function public.stamp_post_organization_author()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  repository text;
  owner_login text;
  candidates uuid[];
begin
  -- Attribution is historical. Body/audience edits must not change it after
  -- the member leaves, the link is removed, or the organization is renamed.
  if tg_op = 'UPDATE' then
    if new.author_id = old.author_id
      and new.repo_full_name is not distinct from old.repo_full_name
      and new.github_link is not distinct from old.github_link then
      select p.id into new.organization_author_id from public.profiles p
        where p.id = old.organization_author_id;
      return new;
    end if;
  end if;
  new.organization_author_id := null;
  -- Official-account overlays and moderation never impersonate a member.
  if new.author_id is distinct from auth.uid() then return new; end if;
  repository := nullif(btrim(new.repo_full_name), '');
  if repository is null then
    repository := substring(new.github_link from '(?i)^https://github\.com/([a-z0-9-]+/[a-z0-9_.-]+)(?:[/?#]|$)');
  end if;
  if repository is null or repository !~* '^[a-z0-9-]+/[a-z0-9_.-]+$' then return new; end if;
  owner_login := lower(split_part(repository, '/', 1));
  select array_agg(a.account_id) into candidates
    from public.github_org_accounts a
    join public.profiles p on p.id = a.account_id and p.is_org = true
    where lower(a.login) = owner_login and public.is_verified_github_org_member(a.org_id)
      and exists (select 1 from public.github_org_memberships m
        where m.user_id = auth.uid() and m.org_id = a.org_id and lower(m.login) = owner_login);
  if cardinality(candidates) > 1 then
    raise exception 'Multiple organization accounts are linked to this GitHub Organization. Keep one account linked before posting.';
  end if;
  new.organization_author_id := candidates[1];
  return new;
end $$;
revoke all on function public.stamp_post_organization_author() from public, anon, authenticated;
drop trigger if exists stamp_post_00_organization_author on public.posts;
-- PostgreSQL runs same-event triggers alphabetically, before the audience stamp.
create trigger stamp_post_00_organization_author before insert or update on public.posts
  for each row execute function public.stamp_post_organization_author();

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
      where o.account_id = coalesce(new.organization_author_id, new.author_id);
    if new.github_org_id is null then raise exception 'Link a GitHub Organization or select its repository first'; end if;
    if not public.is_verified_github_org_member(new.github_org_id) then raise exception 'Refresh your GitHub Organization membership first'; end if;
  else
    new.github_org_id := null;
  end if;
  return new;
end $$;
notify pgrst, 'reload schema';
commit;
