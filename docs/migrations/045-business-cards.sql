-- Run before deploying the business-card UI. Only explicitly saved cards are public.
begin;
create table public.business_cards (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  title text not null default '' check (char_length(title) <= 100),
  bio text not null default '' check (char_length(bio) <= 280),
  contact text not null default '' check (char_length(contact) <= 160),
  theme text not null default 'midnight' check (theme in ('midnight', 'paper', 'aurora')),
  layout text not null default 'classic' check (layout in ('classic', 'centered'))
);
create table public.business_card_collection (
  collector_id uuid not null references public.profiles(id) on delete cascade,
  card_owner_id uuid not null references public.business_cards(owner_id) on delete cascade,
  collected_at timestamptz not null default now(),
  primary key (collector_id, card_owner_id),
  check (collector_id <> card_owner_id)
);
alter table public.business_cards enable row level security;
alter table public.business_card_collection enable row level security;
create policy "published cards are readable" on public.business_cards for select to anon, authenticated using (true);
create policy "owners create cards" on public.business_cards for insert to authenticated with check (owner_id = auth.uid());
create policy "owners edit cards" on public.business_cards for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners unpublish cards" on public.business_cards for delete to authenticated using (owner_id = auth.uid());
create policy "collectors read their collection" on public.business_card_collection for select to authenticated using (collector_id = auth.uid());
create policy "collectors save cards" on public.business_card_collection for insert to authenticated with check (collector_id = auth.uid());
create policy "collectors remove cards" on public.business_card_collection for delete to authenticated using (collector_id = auth.uid());
grant select on public.business_cards to anon;
grant select, insert, update, delete on public.business_cards to authenticated;
grant select, insert, delete on public.business_card_collection to authenticated;
commit;
