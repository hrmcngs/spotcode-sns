-- Requires the Organization setup repair (Stages 38, 39, 41).
begin;
alter table public.github_org_accounts add column if not exists verification_method text;
alter table public.github_org_accounts add column if not exists verification_token text;
create table if not exists public.github_org_file_challenges (
  account_id uuid primary key references public.profiles(id) on delete cascade,
  org_id bigint not null,
  login text not null,
  token text not null,
  expires_at timestamptz not null
);
alter table public.github_org_file_challenges enable row level security;
revoke all on public.github_org_file_challenges from public, anon, authenticated;
grant all on public.github_org_file_challenges to service_role;

create or replace function public.confirm_github_org_file(p_account uuid, p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.github_org_file_challenges;
begin
  perform 1 from public.profiles where id = p_account and is_org = true for update;
  if not found then raise exception 'Organization account required'; end if;
  select * into c from public.github_org_file_challenges where account_id = p_account for update;
  if not found or c.token <> p_token or c.expires_at <= now() then raise exception 'Verification code expired or replaced'; end if;
  insert into public.github_org_accounts(account_id,org_id,login,verification_method,verification_token)
  values(p_account,c.org_id,c.login,'file',c.token)
  on conflict(account_id) do update set org_id=excluded.org_id,login=excluded.login,verification_method='file',verification_token=excluded.verification_token;
  update public.profiles set github_handle=c.login,github_verified=true where id=p_account;
  perform public.replace_github_org_memberships(p_account,0,jsonb_build_array(jsonb_build_object('id',c.org_id,'login',c.login,'role','organization_file')));
  delete from public.github_org_file_challenges where account_id=p_account;
end $$;
revoke all on function public.confirm_github_org_file(uuid,text) from public,anon,authenticated;
grant execute on function public.confirm_github_org_file(uuid,text) to service_role;

create or replace function public.is_verified_github_org_member(p_org bigint)
returns boolean language sql stable security definer set search_path = public,auth as $$
  select exists (
    select 1 from public.github_org_memberships m
    where m.user_id=auth.uid() and m.org_id=p_org and m.valid_until>now() and (
      exists(select 1 from auth.identities i where i.user_id=m.user_id and i.provider='github'
        and m.github_user_id::text in(i.identity_data->>'provider_id',i.identity_data->>'sub',i.identity_data->>'id'))
      or exists(select 1 from public.github_org_accounts a join public.profiles p on p.id=a.account_id
        where a.account_id=m.user_id and a.org_id=m.org_id and p.is_org=true
        and ((m.role='organization_file' and a.verification_method='file') or (m.role='admin' and a.verification_method is distinct from 'file')))
    )
  );
$$;
revoke all on function public.is_verified_github_org_member(bigint) from public,anon;
grant execute on function public.is_verified_github_org_member(bigint) to anon,authenticated;
notify pgrst, 'reload schema';
commit;
