-- Apply before releasing clients. Only owners and collectors can read card data.
begin;
drop policy if exists "published cards are readable" on public.business_cards;
create policy "owners and collectors read cards"
on public.business_cards for select to authenticated
using (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.business_card_collection c
    where c.card_owner_id = business_cards.owner_id
      and c.collector_id = (select auth.uid())
  )
);
revoke select on public.business_cards from anon;
-- Collection INSERT remains scoped to auth.uid(); its foreign key checks that
-- the card exists without requiring SELECT access before it is collected.
commit;
