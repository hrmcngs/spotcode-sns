-- Shorten newly created codes; existing codes remain usable until expiry.
begin;
create or replace function public.new_business_card_exchange_code()
returns text language plpgsql set search_path = public, pg_temp as $$
declare
  candidate text;
begin
  for attempt in 1..100 loop
    candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    -- Serialize equal candidates until their inserts commit, so concurrent
    -- creations cannot collide with this code or an existing receipt.
    perform pg_advisory_xact_lock(hashtext('card-exchange:' || candidate));
    if not exists(select 1 from public.business_card_exchanges where code = candidate) then
      return candidate;
    end if;
  end loop;
  raise exception 'Could not allocate exchange code';
end;
$$;
revoke all on function public.new_business_card_exchange_code() from public, anon, authenticated;
alter table public.business_card_exchanges alter column code
  set default public.new_business_card_exchange_code();
commit;
