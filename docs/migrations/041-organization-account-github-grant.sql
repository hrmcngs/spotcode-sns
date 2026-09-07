-- Organization accounts authorize through a GitHub organization owner.
-- Personal identity linking remains required for personal memberships.
begin;
create or replace function public.is_verified_github_org_member(p_org bigint)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.github_org_memberships m
    where m.user_id = auth.uid() and m.org_id = p_org and m.valid_until > now()
      and (
        exists (select 1 from auth.identities i where i.user_id = m.user_id and i.provider = 'github'
          and m.github_user_id::text in (i.identity_data->>'provider_id', i.identity_data->>'sub', i.identity_data->>'id'))
        or (m.role = 'admin' and exists (
          select 1 from public.github_org_accounts a join public.profiles p on p.id = a.account_id
          where a.account_id = m.user_id and a.org_id = m.org_id and p.is_org = true
        ))
      )
  );
$$;
revoke all on function public.is_verified_github_org_member(bigint) from public, anon;
grant execute on function public.is_verified_github_org_member(bigint) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
