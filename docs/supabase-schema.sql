-- spotcode-sns Supabase schema (cumulative, applied incrementally per stage).
-- Each block is re-runnable: tables use `if not exists`, and every policy
-- is preceded by `drop policy if exists` because Postgres has no
-- `create policy if not exists` syntax.

-- ===================================================================
-- Stage 2 / 3 — profiles
-- ===================================================================
-- Mirror of auth.users — one row per user with the social fields the UI
-- needs. The row is created by a trigger on auth.users insert.

create table if not exists public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  handle        text unique not null check (handle ~ '^[A-Za-z0-9_]{2,20}$'),
  name          text not null,
  avatar_url    text,
  avatar_shape  text default 'round' check (avatar_shape in ('round','square')),
  bio           text,
  location      text,
  role          text default 'general' check (role in ('programmer','general')),
  github_handle text,
  created_at    timestamptz default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles are public"           on public.profiles;
drop policy if exists "owner can insert own profile"  on public.profiles;
drop policy if exists "owner can update own profile"  on public.profiles;

create policy "profiles are public"
  on public.profiles for select using (true);
create policy "owner can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);
create policy "owner can update own profile"
  on public.profiles for update using (auth.uid() = id);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into public.profiles (id, handle, name)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'handle', 'u' || substr(new.id::text, 1, 8)),
          coalesce(new.raw_user_meta_data->>'name', 'New user'))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ===================================================================
-- Stage 4 — posts
-- ===================================================================
create table if not exists public.posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (char_length(body) > 0 and char_length(body) <= 1000),
  github_link text,
  spot        jsonb,         -- { lat, lng, label, address, addressDetails }
  status      text default 'wip' check (status in ('wip','active','released','abandoned')),
  created_at  timestamptz default now()
);
create index if not exists posts_author_idx  on public.posts (author_id, created_at desc);
create index if not exists posts_created_idx on public.posts (created_at desc);

alter table public.posts enable row level security;

drop policy if exists "posts are public"                on public.posts;
drop policy if exists "authors can insert their posts"  on public.posts;
drop policy if exists "authors can update their posts"  on public.posts;
drop policy if exists "authors can delete their posts"  on public.posts;

create policy "posts are public"
  on public.posts for select using (true);
create policy "authors can insert their posts"
  on public.posts for insert with check (auth.uid() = author_id);
create policy "authors can update their posts"
  on public.posts for update using (auth.uid() = author_id);
create policy "authors can delete their posts"
  on public.posts for delete using (auth.uid() = author_id);


-- ===================================================================
-- Stage 5 — likes / follows / reports
-- ===================================================================
create table if not exists public.likes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (post_id, user_id)
);
alter table public.likes enable row level security;
drop policy if exists "likes are public"             on public.likes;
drop policy if exists "users manage their own likes" on public.likes;
drop policy if exists "users delete their own likes" on public.likes;
create policy "likes are public"
  on public.likes for select using (true);
create policy "users manage their own likes"
  on public.likes for insert with check (auth.uid() = user_id);
create policy "users delete their own likes"
  on public.likes for delete using (auth.uid() = user_id);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  target_id   uuid not null references public.profiles(id) on delete cascade check (follower_id <> target_id),
  created_at  timestamptz default now(),
  primary key (follower_id, target_id)
);
alter table public.follows enable row level security;
drop policy if exists "follows are public"               on public.follows;
drop policy if exists "users insert their own follows"   on public.follows;
drop policy if exists "users delete their own follows"   on public.follows;
create policy "follows are public"
  on public.follows for select using (true);
create policy "users insert their own follows"
  on public.follows for insert with check (auth.uid() = follower_id);
create policy "users delete their own follows"
  on public.follows for delete using (auth.uid() = follower_id);

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      text not null check (reason in ('spam','inappropriate','harassment','misinfo','other')),
  comment     text check (char_length(comment) <= 400),
  resolved    boolean default false,
  created_at  timestamptz default now(),
  unique (post_id, reporter_id)
);
alter table public.reports enable row level security;
drop policy if exists "reporters see their own reports" on public.reports;
drop policy if exists "anyone can file a report"        on public.reports;
create policy "reporters see their own reports"
  on public.reports for select using (auth.uid() = reporter_id);
create policy "anyone can file a report"
  on public.reports for insert with check (auth.uid() = reporter_id);


-- ===================================================================
-- Stage 6 — avatars bucket (Supabase Storage)
-- ===================================================================
-- Run via Storage UI or:
--   insert into storage.buckets (id, name, public) values ('avatars','avatars', true);
-- Then policies:
--
-- drop policy if exists "avatars are public"             on storage.objects;
-- drop policy if exists "users upload their own avatar"  on storage.objects;
-- drop policy if exists "users update their own avatar"  on storage.objects;
--
-- create policy "avatars are public"
--   on storage.objects for select using (bucket_id = 'avatars');
-- create policy "users upload their own avatar"
--   on storage.objects for insert with check (
--     bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
--   );
-- create policy "users update their own avatar"
--   on storage.objects for update using (
--     bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
--   );
