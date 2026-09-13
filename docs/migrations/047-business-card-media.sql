begin;
alter table public.business_cards
  add column image_url text not null default '' check (octet_length(image_url) <= 1000000),
  add column image_side text not null default 'front' check (image_side in ('front','back')),
  add column image_shape text not null default 'square' check (image_shape in ('square','round')),
  add column image_size integer not null default 64 check (image_size between 48 and 100),
  add column image_link text not null default '' check (char_length(image_link) <= 2048),
  add column links_side text not null default 'front' check (links_side in ('front','back')),
  add column links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 3 and octet_length(links::text) <= 10000);
commit;
