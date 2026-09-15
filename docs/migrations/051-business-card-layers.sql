-- Preserve existing preset cards while allowing bounded per-layer geometry.
begin;
alter table public.business_cards drop constraint if exists business_cards_design_check;
alter table public.business_cards add constraint business_cards_design_check
  check (jsonb_typeof(design) = 'object' and octet_length(design::text) <= 16384);
commit;
