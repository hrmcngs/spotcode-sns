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


-- ===================================================================
-- Stage 7 — GitHub bio-token verification
-- ===================================================================
-- Adds two columns so the app can record which profiles have proved
-- they own the GitHub handle they're claiming. The token is wiped
-- once verification succeeds; only `github_verified` stays.
alter table public.profiles add column if not exists github_verified boolean default false;
alter table public.profiles add column if not exists github_verify_token text;


-- ===================================================================
-- Stage 8 — Twitter-style private accounts + approve-follow flow
-- ===================================================================
-- Adds a privacy flag and a pending/accepted status on follows so a
-- private account's posts are RLS-hidden from anyone who isn't an
-- approved follower.

alter table public.profiles
  add column if not exists is_private boolean default false;

alter table public.follows
  add column if not exists status text default 'accepted'
  check (status in ('pending', 'accepted'));

-- Posts: replace the "public to all" SELECT with the privacy-aware one.
drop policy if exists "posts are public" on public.posts;
drop policy if exists "posts visible to allowed viewers" on public.posts;
create policy "posts visible to allowed viewers"
  on public.posts for select using (
    -- Public author → anyone can read.
    not exists (
      select 1 from public.profiles where id = author_id and is_private = true
    )
    -- Or the viewer is the author.
    or author_id = auth.uid()
    -- Or the viewer has an accepted follow for the author.
    or exists (
      select 1 from public.follows
      where target_id = author_id
        and follower_id = auth.uid()
        and status = 'accepted'
    )
  );

-- Follows: stay publicly readable so follower counts / follow lists work.
-- But also grant targets the ability to update (accept) or delete pending
-- rows that name them, and let either side delete an accepted row.
drop policy if exists "follows are public" on public.follows;
create policy "follows are public"
  on public.follows for select using (true);

drop policy if exists "targets can update their pending follows" on public.follows;
create policy "targets can update their pending follows"
  on public.follows for update using (target_id = auth.uid())
                       with check (target_id = auth.uid());

drop policy if exists "users delete their own follows" on public.follows;
drop policy if exists "follower or target can delete a follow" on public.follows;
create policy "follower or target can delete a follow"
  on public.follows for delete using (
    follower_id = auth.uid() or target_id = auth.uid()
  );


-- ===================================================================
-- Stage 9 — Profile social links
-- ===================================================================
-- Three optional URLs / handles the user can show on their profile.
-- Validation is intentionally loose at the DB layer (just length); the
-- UI normalises and renders them.
alter table public.profiles add column if not exists website   text;
alter table public.profiles add column if not exists twitter   text;
alter table public.profiles add column if not exists instagram text;


-- ===================================================================
-- Stage 10 — Comments + denormalised counts
-- ===================================================================
-- Comments are public per-post (anyone who can read the parent post
-- can read its comments). The denormalised `comments_count` column on
-- posts is kept in sync by trigger so the timeline can show the count
-- without an extra round trip per post.

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (char_length(body) > 0 and char_length(body) <= 500),
  created_at  timestamptz default now()
);
create index if not exists comments_post_id_idx on public.comments(post_id, created_at);

alter table public.comments enable row level security;

drop policy if exists "comments visible like parent" on public.comments;
create policy "comments visible like parent"
  on public.comments for select using (
    -- EXISTS hits posts under RLS — if the post isn't visible to the
    -- current user (private author, no follow), the comment isn't either.
    exists (select 1 from public.posts p where p.id = post_id)
  );
drop policy if exists "users insert their own comments" on public.comments;
create policy "users insert their own comments"
  on public.comments for insert with check (auth.uid() = author_id);
drop policy if exists "users delete their own comments" on public.comments;
create policy "users delete their own comments"
  on public.comments for delete using (auth.uid() = author_id);

-- Denormalised count column + trigger. Default 0 so existing rows are
-- valid as soon as the column appears; the trailing UPDATE backfills
-- the real counts in one pass.
alter table public.posts
  add column if not exists comments_count integer not null default 0;

create or replace function public.bump_post_comments_count() returns trigger
language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT') then
    update public.posts set comments_count = comments_count + 1
      where id = new.post_id;
  elsif (tg_op = 'DELETE') then
    update public.posts set comments_count = greatest(0, comments_count - 1)
      where id = old.post_id;
  end if;
  return null;
end $$;

drop trigger if exists comments_count_trg on public.comments;
create trigger comments_count_trg
  after insert or delete on public.comments
  for each row execute procedure public.bump_post_comments_count();

-- Backfill so any pre-existing comments (or rows imported manually) are
-- counted correctly the first time this migration runs.
update public.posts p
   set comments_count = coalesce(
     (select count(*) from public.comments c where c.post_id = p.id), 0
   );


-- ===================================================================
-- Stage 11 — Reposts / Bookmarks / Quotes / per-post denormalised counts
-- ===================================================================
-- Backs the 4 placeholder tiles in /post/<id>/analytics + the
-- formerly-decorative fork / star / share buttons on the post card.
--
-- Privacy model (matches the user spec):
--   reposts:    rows publicly readable (count = public, who = public)
--   bookmarks:  rows readable only by the bookmarker OR the post author
--   quotes:     implemented as posts with `quote_of_post_id` set,
--               inherits standard post visibility (already private-
--               account-aware via Stage 8 policy).

create table if not exists public.reposts (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (post_id, user_id)
);
alter table public.reposts enable row level security;
drop policy if exists "reposts are public"            on public.reposts;
drop policy if exists "users insert their own reposts" on public.reposts;
drop policy if exists "users delete their own reposts" on public.reposts;
create policy "reposts are public"
  on public.reposts for select using (true);
create policy "users insert their own reposts"
  on public.reposts for insert with check (auth.uid() = user_id);
create policy "users delete their own reposts"
  on public.reposts for delete using (auth.uid() = user_id);

create table if not exists public.bookmarks (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (post_id, user_id)
);
alter table public.bookmarks enable row level security;
drop policy if exists "bookmarks visible to owner or post author" on public.bookmarks;
drop policy if exists "users insert their own bookmarks"          on public.bookmarks;
drop policy if exists "users delete their own bookmarks"          on public.bookmarks;
create policy "bookmarks visible to owner or post author"
  on public.bookmarks for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()
    )
  );
create policy "users insert their own bookmarks"
  on public.bookmarks for insert with check (auth.uid() = user_id);
create policy "users delete their own bookmarks"
  on public.bookmarks for delete using (auth.uid() = user_id);

-- Quote = a post that points back at another post. Self-FK on posts.
-- on delete set null so deleting the quoted post leaves the quoting
-- post intact (the embed just renders as "投稿は削除されました").
alter table public.posts
  add column if not exists quote_of_post_id uuid references public.posts(id) on delete set null;

-- Denormalised counts on posts. Same pattern as Stage 10's comments_count.
alter table public.posts add column if not exists reposts_count   integer not null default 0;
alter table public.posts add column if not exists bookmarks_count integer not null default 0;
alter table public.posts add column if not exists quotes_count    integer not null default 0;

create or replace function public.bump_post_reposts_count() returns trigger
language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT') then
    update public.posts set reposts_count = reposts_count + 1 where id = new.post_id;
  elsif (tg_op = 'DELETE') then
    update public.posts set reposts_count = greatest(0, reposts_count - 1) where id = old.post_id;
  end if;
  return null;
end $$;
drop trigger if exists reposts_count_trg on public.reposts;
create trigger reposts_count_trg
  after insert or delete on public.reposts
  for each row execute procedure public.bump_post_reposts_count();

create or replace function public.bump_post_bookmarks_count() returns trigger
language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT') then
    update public.posts set bookmarks_count = bookmarks_count + 1 where id = new.post_id;
  elsif (tg_op = 'DELETE') then
    update public.posts set bookmarks_count = greatest(0, bookmarks_count - 1) where id = old.post_id;
  end if;
  return null;
end $$;
drop trigger if exists bookmarks_count_trg on public.bookmarks;
create trigger bookmarks_count_trg
  after insert or delete on public.bookmarks
  for each row execute procedure public.bump_post_bookmarks_count();

-- Quotes counted via the posts.quote_of_post_id self-FK.
create or replace function public.bump_post_quotes_count() returns trigger
language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT' and new.quote_of_post_id is not null) then
    update public.posts set quotes_count = quotes_count + 1 where id = new.quote_of_post_id;
  elsif (tg_op = 'DELETE' and old.quote_of_post_id is not null) then
    update public.posts set quotes_count = greatest(0, quotes_count - 1) where id = old.quote_of_post_id;
  elsif (tg_op = 'UPDATE') then
    if (old.quote_of_post_id is distinct from new.quote_of_post_id) then
      if (old.quote_of_post_id is not null) then
        update public.posts set quotes_count = greatest(0, quotes_count - 1) where id = old.quote_of_post_id;
      end if;
      if (new.quote_of_post_id is not null) then
        update public.posts set quotes_count = quotes_count + 1 where id = new.quote_of_post_id;
      end if;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists quotes_count_trg on public.posts;
create trigger quotes_count_trg
  after insert or update or delete on public.posts
  for each row execute procedure public.bump_post_quotes_count();

-- Backfill so any rows that pre-existed the trigger are counted right.
update public.posts p
   set reposts_count   = coalesce((select count(*) from public.reposts   r where r.post_id = p.id), 0),
       bookmarks_count = coalesce((select count(*) from public.bookmarks b where b.post_id = p.id), 0),
       quotes_count    = coalesce((select count(*) from public.posts     q where q.quote_of_post_id = p.id), 0);

-- ----------------------------------------------------------------------
-- Stage 12 — Photo attachments on posts
-- ----------------------------------------------------------------------
--
-- Composer-attached photos live as data URLs in a jsonb array on each
-- post row. Sized client-side to ~1080px JPEG before upload so a
-- 4-photo post stays under ~700KB. Avoids needing a Supabase Storage
-- bucket + signed URL flow for now; if storage size becomes an issue
-- later, migrate to Storage with `posts.photo_paths text[]` instead.

alter table public.posts add column if not exists photos jsonb default '[]'::jsonb;

-- ----------------------------------------------------------------------
-- Stage 13 — Polls with per-user vote tracking
-- ----------------------------------------------------------------------
--
-- posts.poll holds the question + options + deadline as a single jsonb
-- blob (immutable once attached — there is no edit-poll UI). Each
-- vote lands as a separate row in poll_votes so concurrent votes
-- don't contend on a jsonb update. (post_id, user_id) is the primary
-- key so re-voting just UPSERTs over the old row.

alter table public.posts add column if not exists poll jsonb;

create table if not exists public.poll_votes (
  post_id    uuid not null references public.posts(id)  on delete cascade,
  user_id    uuid not null references auth.users(id)    on delete cascade,
  option_idx int  not null,
  created_at timestamptz default now(),
  primary key (post_id, user_id)
);
create index if not exists poll_votes_post_idx on public.poll_votes (post_id);

alter table public.poll_votes enable row level security;
drop policy if exists "poll votes are public"            on public.poll_votes;
drop policy if exists "voters can insert their own vote" on public.poll_votes;
drop policy if exists "voters can change their own vote" on public.poll_votes;
drop policy if exists "voters can drop their own vote"   on public.poll_votes;
create policy "poll votes are public"
  on public.poll_votes for select using (true);
create policy "voters can insert their own vote"
  on public.poll_votes for insert with check (auth.uid() = user_id);
create policy "voters can change their own vote"
  on public.poll_votes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "voters can drop their own vote"
  on public.poll_votes for delete using (auth.uid() = user_id);

-- ----------------------------------------------------------------------
-- Stage 14 — Post kind tag ("idea" or unset)
-- ----------------------------------------------------------------------
--
-- A simple text column so a post can be marked as "an idea" vs. a
-- regular note. NULL = regular. Kept open-ended on purpose so future
-- additions (e.g. 'question', 'bug', 'release') don't need another
-- ALTER. The renderer only highlights 'idea' today.

alter table public.posts add column if not exists kind text;
create index if not exists posts_kind_idx on public.posts (kind) where kind is not null;

-- ----------------------------------------------------------------------
-- Stage 15 — Server-side admin flag so the client-side ALLOWED_HANDLES
-- list in dev-mode.js translates to actual delete permission.
-- ----------------------------------------------------------------------
--
-- Without this, dev mode shows the trash button on every post but the
-- backend RLS only matches "delete your OWN post". The delete attempt
-- comes back with "削除権限がありません" and the moderator is stuck.
--
-- Editing someone else's post is a different threat model (rewriting
-- someone's words) — there's no matching update policy here on
-- purpose. Admins get the delete hammer, not the keyboard.

alter table public.profiles add column if not exists is_admin boolean default false;

-- Seed: handle(s) that match the dev-mode.js allowlist. Adjust as the
-- ALLOWED_HANDLES list grows.
update public.profiles set is_admin = true where handle in ('hrmcngs');

drop policy if exists "admins can delete any post" on public.posts;
create policy "admins can delete any post"
  on public.posts for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

-- ----------------------------------------------------------------------
-- Stage 16 — Restricted post visibility (close friends + organization)
-- ----------------------------------------------------------------------
--
-- A per-post visibility tag plus two new profile fields so a viewer
-- can be checked against "is this author's close friend OR in the
-- same organization". Filtering is done client-side today (matches
-- the existing geo-gate pattern); RLS still returns the row to any
-- authenticated user, so this is a "soft" privacy setting and not a
-- security boundary. Tightening to RLS-enforced visibility is a
-- follow-up.
--
-- `close_friends` stores handles (not ids) so the author can edit the
-- list from the profile UI without a profiles-id round trip per name.
-- `organization` is free-text — a GitHub org, a company name, a
-- school, whatever the user wants to use as the cohort key.

alter table public.profiles
  add column if not exists close_friends text[] default '{}',
  add column if not exists organization  text;

alter table public.posts
  add column if not exists visibility text default 'public'
    check (visibility in ('public', 'restricted'));
