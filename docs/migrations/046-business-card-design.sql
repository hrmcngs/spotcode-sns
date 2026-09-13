-- Apply after 045. Existing cards keep their original preset appearance.
begin;
alter table public.business_cards add column design jsonb not null default '{}'::jsonb
  check (jsonb_typeof(design) = 'object' and octet_length(design::text) <= 2048);
commit;
