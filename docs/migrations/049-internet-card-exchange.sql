-- Internet transport for card exchange. Apply after 048.
begin;
create table public.business_card_exchanges (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  host_id uuid not null references public.business_cards(owner_id) on delete cascade,
  guest_id uuid references public.business_cards(owner_id) on delete cascade,
  state text not null default 'waiting' check (state in ('waiting','pending','completed','cancelled','expired')),
  expires_at timestamptz not null default now() + interval '10 minutes',
  check (guest_id is null or guest_id <> host_id)
);
alter table public.business_card_exchanges enable row level security;
-- Clients use the RPC only; no public code directory or direct mutations.
revoke all on public.business_card_exchanges from anon, authenticated;

create or replace function public.exchange_business_cards(
  p_action text, p_id uuid default null, p_code text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  exchange public.business_card_exchanges%rowtype;
begin
  if actor is null then raise exception 'Sign in required'; end if;
  if p_action = 'create' then
    if not exists(select 1 from public.business_cards where owner_id = actor) then
      raise exception 'Publish your business card first';
    end if;
    -- At most one active code per host. Old/completed exchanges retain receipts.
    perform 1 from public.business_cards where owner_id = actor for update;
    update public.business_card_exchanges set state = 'cancelled'
      where host_id = actor and state in ('waiting','pending');
    insert into public.business_card_exchanges(host_id) values(actor) returning * into exchange;
  elsif p_action = 'join' then
    select * into exchange from public.business_card_exchanges
      where code = upper(regexp_replace(coalesce(p_code,''), '[^a-zA-Z0-9]', '', 'g')) for update;
    if not found or exchange.expires_at <= now() or exchange.host_id = actor
       or exchange.state not in ('waiting','pending')
       or (exchange.guest_id is not null and exchange.guest_id <> actor) then
      raise exception 'Invalid or expired exchange code';
    end if;
    if not exists(select 1 from public.business_cards where owner_id = actor) then
      raise exception 'Publish your business card first';
    end if;
    if exists(select 1 from public.user_blocks where
        (blocker_id = actor and blocked_id = exchange.host_id) or
        (blocked_id = actor and blocker_id = exchange.host_id)) then
      raise exception 'Exchange unavailable';
    end if;
    update public.business_card_exchanges set guest_id = actor, state = 'pending'
      where id = exchange.id returning * into exchange;
  else
    select * into exchange from public.business_card_exchanges where id = p_id for update;
    if not found or (actor <> exchange.host_id and actor is distinct from exchange.guest_id) then
      raise exception 'Exchange unavailable';
    end if;
    if exchange.state in ('waiting','pending') and exchange.expires_at <= now() then
      update public.business_card_exchanges set state = 'expired' where id = exchange.id returning * into exchange;
    end if;
    if p_action = 'accept' then
      if actor <> exchange.host_id then raise exception 'Only the host may confirm'; end if;
      if exchange.state = 'pending' then
        if exists(select 1 from public.user_blocks where
            (blocker_id = exchange.host_id and blocked_id = exchange.guest_id) or
            (blocked_id = exchange.host_id and blocker_id = exchange.guest_id)) then
          raise exception 'Exchange unavailable';
        end if;
        -- Join is guest consent; accept is host consent. Save both or neither.
        insert into public.business_card_collection(collector_id, card_owner_id)
          values(exchange.host_id, exchange.guest_id), (exchange.guest_id, exchange.host_id)
          on conflict do nothing;
        update public.business_card_exchanges set state = 'completed' where id = exchange.id returning * into exchange;
      elsif exchange.state <> 'completed' then raise exception 'Exchange is not pending';
      end if;
    elsif p_action = 'cancel' then
      if exchange.state in ('waiting','pending') then
        update public.business_card_exchanges set state = 'cancelled' where id = exchange.id returning * into exchange;
      end if;
    elsif p_action <> 'status' then raise exception 'Unknown action';
    end if;
  end if;
  return jsonb_build_object('id',exchange.id,'code',exchange.code,'hostID',exchange.host_id,
    'guestID',exchange.guest_id,'state',exchange.state,'expiresAt',exchange.expires_at,
    'hostHandle',(select handle from public.profiles where id = exchange.host_id),
    'guestHandle',(select handle from public.profiles where id = exchange.guest_id));
end;
$$;
revoke all on function public.exchange_business_cards(text,uuid,text) from public, anon;
grant execute on function public.exchange_business_cards(text,uuid,text) to authenticated;
commit;
