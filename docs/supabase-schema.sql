-- spotcode-sns: single entry point for Supabase SQL Editor (Stages 2–53).
-- Paste this entire file and run once, for either setup or upgrade.
-- Existing data is retained. Historical migrations remain in docs/migrations.
-- Requires a Supabase project (Auth and Vault); run as the SQL Editor owner.
-- Optional QA account provisioning is available in Settings, not automatic.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
set local search_path = public, extensions;

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

drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public"
  on public.profiles for select using (true);
drop policy if exists "owner can insert own profile" on public.profiles;
create policy "owner can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "owner can update own profile" on public.profiles;
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

drop policy if exists "posts are public" on public.posts;
create policy "posts are public"
  on public.posts for select using (true);
drop policy if exists "authors can insert their posts" on public.posts;
create policy "authors can insert their posts"
  on public.posts for insert with check (auth.uid() = author_id);
drop policy if exists "authors can update their posts" on public.posts;
create policy "authors can update their posts"
  on public.posts for update using (auth.uid() = author_id);
drop policy if exists "authors can delete their posts" on public.posts;
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
drop policy if exists "likes are public" on public.likes;
create policy "likes are public"
  on public.likes for select using (true);
drop policy if exists "users manage their own likes" on public.likes;
create policy "users manage their own likes"
  on public.likes for insert with check (auth.uid() = user_id);
drop policy if exists "users delete their own likes" on public.likes;
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
drop policy if exists "follows are public" on public.follows;
create policy "follows are public"
  on public.follows for select using (true);
drop policy if exists "users insert their own follows" on public.follows;
create policy "users insert their own follows"
  on public.follows for insert with check (auth.uid() = follower_id);
drop policy if exists "users delete their own follows" on public.follows;
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
drop policy if exists "reporters see their own reports" on public.reports;
create policy "reporters see their own reports"
  on public.reports for select using (auth.uid() = reporter_id);
drop policy if exists "anyone can file a report" on public.reports;
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
drop policy if exists "reposts are public" on public.reposts;
create policy "reposts are public"
  on public.reposts for select using (true);
drop policy if exists "users insert their own reposts" on public.reposts;
create policy "users insert their own reposts"
  on public.reposts for insert with check (auth.uid() = user_id);
drop policy if exists "users delete their own reposts" on public.reposts;
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
drop policy if exists "bookmarks visible to owner or post author" on public.bookmarks;
create policy "bookmarks visible to owner or post author"
  on public.bookmarks for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()
    )
  );
drop policy if exists "users insert their own bookmarks" on public.bookmarks;
create policy "users insert their own bookmarks"
  on public.bookmarks for insert with check (auth.uid() = user_id);
drop policy if exists "users delete their own bookmarks" on public.bookmarks;
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
drop policy if exists "poll votes are public" on public.poll_votes;
create policy "poll votes are public"
  on public.poll_votes for select using (true);
drop policy if exists "voters can insert their own vote" on public.poll_votes;
create policy "voters can insert their own vote"
  on public.poll_votes for insert with check (auth.uid() = user_id);
drop policy if exists "voters can change their own vote" on public.poll_votes;
create policy "voters can change their own vote"
  on public.poll_votes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "voters can drop their own vote" on public.poll_votes;
create policy "voters can drop their own vote"
  on public.poll_votes for delete using (auth.uid() = user_id);

-- ----------------------------------------------------------------------
-- Stage 14 — Post kind tag ("idea" or unset)
-- ----------------------------------------------------------------------
--
-- A simple text column so a post can be marked as "an idea" vs. a
-- regular note. NULL = regular. Kept open-ended on purpose so future
-- additions (e.g. 'question', 'bug', 'release') don't need another
-- ALTER. The renderer supports 'idea' and 'bug'.

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
    check (visibility in ('public','restricted','mutuals','following','friends','org','only_me','github_org'));

-- ----------------------------------------------------------------------
-- Stage 17 — Server-side enforcement of visibility / privacy
-- ----------------------------------------------------------------------
--
-- Replaces the wide-open "posts are public" SELECT policy. The old
-- policy let anyone (even anon) read every row, so the "private
-- account" flag (Stage 8) and "restricted" visibility (Stage 16)
-- were soft — client-side filtering only. This stage moves the gate
-- into the database so a curl request with the anon key can't see
-- what it isn't supposed to.
--
-- Rules:
--   • Anonymous viewer: only public posts from public accounts.
--   • Author: always sees their own.
--   • Authenticated viewer + post from public account + public
--     visibility: visible.
--   • Authenticated viewer + post from private account + public
--     visibility: visible only if (a) approved follower, or (b)
--     on the author's close-friends list, or (c) same organization.
--   • Restricted visibility: visible only to author + close friends
--     + same-org viewers, regardless of public/private account.
--   • Admins (Stage 15 `is_admin`) see everything — needed for
--     moderation (reports, deletes).

drop policy if exists "posts are public" on public.posts;
drop policy if exists "posts visible to allowed viewers" on public.posts;

create policy "posts visible to allowed viewers"
  on public.posts for select
  using (
    -- Anonymous + public/public is the cheapest branch — keep it first.
    (
      posts.visibility = 'public'
      and exists (
        select 1 from public.profiles ap
        where ap.id = posts.author_id and not ap.is_private
      )
    )
    -- Author themselves.
    or auth.uid() = posts.author_id
    -- Admins (moderation).
    or exists (
      select 1 from public.profiles vp
      where vp.id = auth.uid() and vp.is_admin = true
    )
    -- Authenticated viewer rules.
    or exists (
      select 1 from public.profiles ap
      left join public.profiles vp on vp.id = auth.uid()
      where ap.id = posts.author_id
      and (
        -- Public post on a private account → approved follower OR
        -- close friend OR same-org viewer.
        (
          ap.is_private and posts.visibility = 'public' and (
            exists (
              select 1 from public.follows f
              where f.follower_id = auth.uid()
              and f.target_id = ap.id
              and f.status = 'accepted'
            )
            or (vp.id is not null and vp.handle = any(ap.close_friends))
            or (
              ap.organization is not null and vp.organization is not null
              and lower(trim(ap.organization)) = lower(trim(vp.organization))
            )
          )
        )
        -- Restricted visibility → close friends or same org, regardless
        -- of whether the account itself is public or private.
        or (
          posts.visibility = 'restricted' and vp.id is not null and (
            vp.handle = any(ap.close_friends)
            or (
              ap.organization is not null and vp.organization is not null
              and lower(trim(ap.organization)) = lower(trim(vp.organization))
            )
          )
        )
      )
    )
  );

-- Likes / comments / bookmarks / reposts inherit visibility from the
-- referenced post — drop their public-select policies and rebuild
-- with an EXISTS check on the post being visible. Otherwise someone
-- could enumerate likes/comments on restricted posts and infer
-- existence/content.

drop policy if exists "likes are public" on public.likes;
drop policy if exists "likes visible only on viewable posts" on public.likes;
create policy "likes visible only on viewable posts"
  on public.likes for select
  using (
    exists (select 1 from public.posts p where p.id = likes.post_id)
  );

-- Reposts / bookmarks / poll_votes follow the same pattern — if you
-- can't see the parent post, you shouldn't be able to enumerate its
-- engagement either (otherwise existence + popularity leaks).

drop policy if exists "users see reposts" on public.reposts;
drop policy if exists "reposts visible only on viewable posts" on public.reposts;
create policy "reposts visible only on viewable posts"
  on public.reposts for select
  using (
    exists (select 1 from public.posts p where p.id = reposts.post_id)
  );

drop policy if exists "users see bookmarks" on public.bookmarks;
drop policy if exists "bookmarks visible only on viewable posts" on public.bookmarks;
-- Bookmarks were already author-scoped in Stage 11; we still want to
-- prevent OTHER users from probing whether someone bookmarked a given
-- restricted post.
drop policy if exists "bookmarks visible only on viewable posts" on public.bookmarks;
create policy "bookmarks visible only on viewable posts"
  on public.bookmarks for select
  using (
    auth.uid() = user_id
    or exists (select 1 from public.posts p where p.id = bookmarks.post_id)
  );

drop policy if exists "poll votes are public" on public.poll_votes;
drop policy if exists "poll votes visible only on viewable posts" on public.poll_votes;
create policy "poll votes visible only on viewable posts"
  on public.poll_votes for select
  using (
    exists (select 1 from public.posts p where p.id = poll_votes.post_id)
  );

-- Note: posts.select RLS already filters, so the EXISTS effectively
-- becomes "the viewer can see the parent post". Postgres optimises
-- the join through.

-- ----------------------------------------------------------------------
-- Stage 18 — Granular post visibility (5 audience options)
-- ----------------------------------------------------------------------
--
-- Stage 16 shipped a binary public / restricted toggle. Stage 18
-- swaps it for five named audiences so the author can pick exactly
-- who sees a given post:
--
--   public     — anyone (current default)
--   mutuals    — viewers who follow the author AND are followed by
--                the author back (accepted both ways)
--   following  — viewers the author follows (one-way)
--   friends    — viewers on the author's close_friends list
--   org        — viewers in the same organization as the author
--
-- 'restricted' (Stage 16) is kept in the CHECK so old rows stay
-- valid; it's treated as "friends OR org" in the policy (same
-- behaviour as before this stage). The composer no longer offers
-- it as a new value.

alter table public.posts drop constraint if exists posts_visibility_check;
alter table public.posts add constraint posts_visibility_check
  check (visibility in ('public','restricted','mutuals','following','friends','org','only_me','github_org'));

drop policy if exists "posts visible to allowed viewers" on public.posts;
create policy "posts visible to allowed viewers"
  on public.posts for select
  using (
    -- Anonymous + public-from-public-account.
    (
      posts.visibility = 'public'
      and exists (
        select 1 from public.profiles ap
        where ap.id = posts.author_id and not ap.is_private
      )
    )
    -- Author themselves.
    or auth.uid() = posts.author_id
    -- Admins (moderation).
    or exists (
      select 1 from public.profiles vp
      where vp.id = auth.uid() and vp.is_admin = true
    )
    -- Authenticated viewer rules.
    or exists (
      select 1 from public.profiles ap
      left join public.profiles vp on vp.id = auth.uid()
      where ap.id = posts.author_id
      and (
        -- Public post on a private account → approved follower OR
        -- close friend OR same-org viewer.
        (
          ap.is_private and posts.visibility = 'public' and (
            exists (
              select 1 from public.follows f
              where f.follower_id = auth.uid()
              and f.target_id = ap.id
              and f.status = 'accepted'
            )
            or (vp.id is not null and vp.handle = any(ap.close_friends))
            or (
              ap.organization is not null and vp.organization is not null
              and lower(trim(ap.organization)) = lower(trim(vp.organization))
            )
          )
        )
        -- Mutual-only: both directions of follow must be accepted.
        or (
          posts.visibility = 'mutuals' and vp.id is not null
          and exists (
            select 1 from public.follows f1
            where f1.follower_id = auth.uid() and f1.target_id = ap.id
            and f1.status = 'accepted'
          )
          and exists (
            select 1 from public.follows f2
            where f2.follower_id = ap.id and f2.target_id = auth.uid()
            and f2.status = 'accepted'
          )
        )
        -- Following-only: the author follows the viewer (author chose
        -- to share with people they themselves follow).
        or (
          posts.visibility = 'following' and vp.id is not null
          and exists (
            select 1 from public.follows f
            where f.follower_id = ap.id and f.target_id = auth.uid()
            and f.status = 'accepted'
          )
        )
        -- Close friends only.
        or (
          posts.visibility = 'friends' and vp.id is not null
          and vp.handle = any(ap.close_friends)
        )
        -- Same organization only.
        or (
          posts.visibility = 'org' and vp.id is not null
          and ap.organization is not null and vp.organization is not null
          and lower(trim(ap.organization)) = lower(trim(vp.organization))
        )
        -- Legacy "restricted" (Stage 16) — friends OR org.
        or (
          posts.visibility = 'restricted' and vp.id is not null and (
            vp.handle = any(ap.close_friends)
            or (
              ap.organization is not null and vp.organization is not null
              and lower(trim(ap.organization)) = lower(trim(vp.organization))
            )
          )
        )
      )
    )
  );

-- ----------------------------------------------------------------------
-- Stage 19 — Org membership as an explicit handle list
-- ----------------------------------------------------------------------
--
-- Stage 16's `organization` was a free-text label and the org-match
-- rule (Stage 18) compared two users' text values. That has two
-- failure modes:
--   • Casing / whitespace / typos let people in by accident.
--   • A viewer can SET their `organization` to any string the author
--     used and silently join the audience.
--
-- Stage 19 replaces the comparison with an explicit allow-list
-- maintained by the author — same UX as close_friends but a second
-- list. The text `organization` field stays as a free-form label
-- (still shown on profiles) but is NOT used for visibility matching
-- anymore. Old `organization`-only profiles fall back to a manual
-- migration: the author needs to add the relevant handles to
-- `org_members` once.

alter table public.profiles
  add column if not exists org_members text[] default '{}';

drop policy if exists "posts visible to allowed viewers" on public.posts;
create policy "posts visible to allowed viewers"
  on public.posts for select
  using (
    -- Anonymous + public-from-public-account.
    (
      posts.visibility = 'public'
      and exists (
        select 1 from public.profiles ap
        where ap.id = posts.author_id and not ap.is_private
      )
    )
    -- Author themselves.
    or auth.uid() = posts.author_id
    -- Admins (moderation).
    or exists (
      select 1 from public.profiles vp
      where vp.id = auth.uid() and vp.is_admin = true
    )
    -- Authenticated viewer rules.
    or exists (
      select 1 from public.profiles ap
      left join public.profiles vp on vp.id = auth.uid()
      where ap.id = posts.author_id
      and (
        -- Public post on a private account → approved follower OR
        -- close friend OR explicit org member.
        (
          ap.is_private and posts.visibility = 'public' and (
            exists (
              select 1 from public.follows f
              where f.follower_id = auth.uid()
              and f.target_id = ap.id
              and f.status = 'accepted'
            )
            or (vp.id is not null and vp.handle = any(ap.close_friends))
            or (vp.id is not null and vp.handle = any(ap.org_members))
          )
        )
        -- Mutual-only: both directions of follow must be accepted.
        or (
          posts.visibility = 'mutuals' and vp.id is not null
          and exists (
            select 1 from public.follows f1
            where f1.follower_id = auth.uid() and f1.target_id = ap.id
            and f1.status = 'accepted'
          )
          and exists (
            select 1 from public.follows f2
            where f2.follower_id = ap.id and f2.target_id = auth.uid()
            and f2.status = 'accepted'
          )
        )
        -- Following-only: the author follows the viewer.
        or (
          posts.visibility = 'following' and vp.id is not null
          and exists (
            select 1 from public.follows f
            where f.follower_id = ap.id and f.target_id = auth.uid()
            and f.status = 'accepted'
          )
        )
        -- Close friends only — viewer is on the author's curated list.
        or (
          posts.visibility = 'friends' and vp.id is not null
          and vp.handle = any(ap.close_friends)
        )
        -- Same-org only — viewer is on the author's curated org_members.
        or (
          posts.visibility = 'org' and vp.id is not null
          and vp.handle = any(ap.org_members)
        )
        -- Legacy "restricted" (Stage 16) — friends OR (curated org member).
        or (
          posts.visibility = 'restricted' and vp.id is not null and (
            vp.handle = any(ap.close_friends)
            or vp.handle = any(ap.org_members)
          )
        )
      )
    )
  );

-- ===================================================================
-- Stage 20 — organization accounts
-- ===================================================================
-- A plain boolean flag on profiles so an account can self-identify as
-- an organization (company / school / community) instead of a person.
-- It's surface-only: no RLS branches off this, all visibility logic
-- still uses `org_members` and `close_friends`. The UI uses it to
-- render an "Organization" badge and to seed the sign-up form's
-- account-type radio.

alter table public.profiles
  add column if not exists is_org boolean default false;

-- ===================================================================
-- Stage 21 — allow hyphens in handles
-- ===================================================================
-- Match GitHub's rule: alphanumerics, underscore and hyphen, 2–20
-- chars total, leading character can't be a hyphen. Lets people use
-- handles like `Drowse-Lab`. The original check rejected anything
-- with a hyphen because the character class was [A-Za-z0-9_].

alter table public.profiles
  drop constraint if exists profiles_handle_check;
alter table public.profiles
  add constraint profiles_handle_check
  check (handle ~ '^[A-Za-z0-9_][A-Za-z0-9_-]{1,19}$');

-- ===================================================================
-- Stage 22 — self-selected skill badges
-- ===================================================================
-- Replaces the GitHub-API-derived badge auto-detection. The previous
-- approach burned the unauth 60/h rate limit too fast and left users
-- with empty caches that took 24h to recover; we now let the user
-- pick which language badges they want to display.
--
-- text[] of badge ids matching the BADGES catalog in
-- src/js/badges.js (e.g. ['typescripter', 'pythoneer', ...]).
-- The existing "owner can update own profile" RLS policy on
-- public.profiles already covers writes, so no separate policy is
-- needed here.

alter table public.profiles
  add column if not exists skills text[] default '{}';

-- ===================================================================
-- Stages 23–24 were superseded by Stage 25; do not drop live role columns.

-- Stage 25 — bring back the "post as official via privilege" plumbing
-- ===================================================================
-- We tried two flavours:
--   • Stage 23: schema flag + Composer "Post as official" toggle (PR
--     #174). The toggle UX confused the user — felt like a
--     per-post checkbox.
--   • Stage 24 + PR #176/#177: revert; the brand account becomes a
--     normal shared-password Supabase user, accessed via the account
--     switcher (with the auth modal pre-filling the shared email on
--     first sign-in).
--
-- New direction (user: 「hrmc.ngs+official@gmail.comいらない、運営者と
-- 管理者全員がログインできる特例アカウントなの」): the brand
-- account's password should be *irrelevant* to day-to-day use. Admin
-- and operator privileges ARE the authorization — clicking the
-- 「公式」 row in the account switcher should just put the staffer
-- "into" the brand identity (no password prompt, no separate
-- session). Server-side RLS validates the privilege on each insert.
--
-- This re-adds the columns + relaxed posts policies from Stage 23.
-- Safe to run after Stage 24 wiped them: ADD COLUMN IF NOT EXISTS is
-- idempotent, the DROP POLICY IF EXISTS lines clear any leftover
-- names from earlier attempts.

-- 1. Operator flag mirrors OPERATOR_HANDLES in src/js/dev-mode.js.
alter table public.profiles
  add column if not exists is_operator boolean default false;
update public.profiles
  set is_operator = true
  where handle in ('hrmcngs', 'aya526dev');

-- 2. Official flag. Partial unique index keeps exactly one row hot —
--    flipping a second profile fails loudly instead of silently
--    creating two officials.
alter table public.profiles
  add column if not exists is_official boolean default false;
drop index if exists profiles_one_official_uniq;
create unique index profiles_one_official_uniq
  on public.profiles ((true)) where is_official = true;

-- 3. Posts INSERT: own author_id (the normal case) OR author_id =
--    the official profile when the requester is admin or operator.
--    The client-side mode flag (src/js/posting-identity.js) drives
--    the substitution; this policy is what makes it actually go
--    through.
drop policy if exists "authors or staff-as-official can insert posts" on public.posts;
drop policy if exists "authors or staff can insert posts"             on public.posts;
drop policy if exists "authors can insert their posts"                on public.posts;
drop policy if exists "authors or staff-as-official can insert posts" on public.posts;
create policy "authors or staff-as-official can insert posts"
  on public.posts for insert with check (
    auth.uid() = author_id
    or (
      exists (select 1 from public.profiles where id = author_id  and is_official = true)
      and
      exists (select 1 from public.profiles where id = auth.uid() and (is_admin = true or is_operator = true))
    )
  );

-- 4. Posts UPDATE / DELETE on the official account: same admin-or-
--    operator gate, so a staffer who posted as official can fix a
--    typo or take it down without escalating to another role.
drop policy if exists "authors or staff can update posts" on public.posts;
drop policy if exists "authors can update their posts"   on public.posts;
drop policy if exists "authors or staff can update posts" on public.posts;
create policy "authors or staff can update posts"
  on public.posts for update using (
    auth.uid() = author_id
    or (
      exists (select 1 from public.profiles where id = author_id  and is_official = true)
      and
      exists (select 1 from public.profiles where id = auth.uid() and (is_admin = true or is_operator = true))
    )
  );

drop policy if exists "authors or staff can delete posts" on public.posts;
drop policy if exists "authors can delete their posts"   on public.posts;
drop policy if exists "authors or staff can delete posts" on public.posts;
create policy "authors or staff can delete posts"
  on public.posts for delete using (
    auth.uid() = author_id
    or (
      exists (select 1 from public.profiles where id = author_id  and is_official = true)
      and
      exists (select 1 from public.profiles where id = auth.uid() and (is_admin = true or is_operator = true))
    )
  );
-- (Stage 15's "admins can delete any post" stays too — global
-- moderation override still applies.)

-- 5. Bootstrap the "virtual" official account in one shot.
--    Idempotent — re-running this block on a DB that already has
--    the row is a no-op.
--
--    The auth.users row is created here with an **unrecoverable
--    random password**. Nobody logs into this account directly —
--    admin / operator privileges are the only path to acting as
--    it (the account-switcher overlay in PR #179 substitutes
--    author_id without calling signInWithPassword). This is what
--    makes the account "virtual" from the user's perspective:
--    no signup flow, no shared password, no auth modal.
--
--    Runs in the SQL Editor as the project's postgres role, so
--    it has the privilege to write into the `auth` schema —
--    same path Supabase itself uses for user provisioning.

do $$
declare
  v_id uuid;
begin
  -- Look up by the sentinel email so re-running the block is
  -- idempotent (auth.users has a unique constraint on email).
  select id into v_id
  from auth.users
  where email = 'official@spotcode-sns.local';

  if v_id is null then
    -- auth.users.id has no DEFAULT in some Supabase project versions
    -- (Postgres throws NOT NULL on insert if we omit it). Generate
    -- the uuid explicitly so the block works regardless of which
    -- version provisioned the project. RETURNING captures it for
    -- the profiles upsert below.
    insert into auth.users (
      id, instance_id, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      aud, role,
      raw_user_meta_data, raw_app_meta_data
    )
    values (
      gen_random_uuid(),
      '00000000-0000-0000-0000-000000000000',
      'official@spotcode-sns.local',
      crypt(gen_random_uuid()::text, gen_salt('bf')),
      now(), now(), now(),
      'authenticated', 'authenticated',
      jsonb_build_object('handle', 'spotcode_official', 'name', 'spotcode'),
      '{"provider":"email","providers":["email"]}'::jsonb
    )
    returning id into v_id;
    -- The handle_new_user trigger (Stage 2/3) already created the
    -- matching profiles row using the metadata above.
  end if;

  -- Upsert the profile fields, since the trigger may have run with
  -- empty metadata on older DBs, and we want re-runs to repair any
  -- drift (renamed handle / is_official set back to true / etc.).
  insert into public.profiles (id, handle, name, is_official)
  values (v_id, 'spotcode_official', 'spotcode', true)
  on conflict (id) do update set
    handle      = excluded.handle,
    name        = excluded.name,
    is_official = true;
end $$;

-- ===================================================================
-- Stage 26 — let admins / operators follow as the official account
-- ===================================================================
-- Mirrors Stage 25's INSERT / UPDATE / DELETE policy relaxation for
-- posts. The client (src/js/interactions.js#toggleFollow) accepts an
-- `actorUserId` override that gets passed as `follower_id` when the
-- "post as official" overlay is on, so the brand account can build
-- its own following / follower graph. RLS validates that the
-- substitution is allowed (admin or operator only).

drop policy if exists "users insert their own follows"          on public.follows;
drop policy if exists "users or staff-as-official insert follows" on public.follows;
create policy "users or staff-as-official insert follows"
  on public.follows for insert with check (
    auth.uid() = follower_id
    or (
      exists (select 1 from public.profiles where id = follower_id and is_official = true)
      and
      exists (select 1 from public.profiles where id = auth.uid() and (is_admin = true or is_operator = true))
    )
  );

drop policy if exists "users delete their own follows"          on public.follows;
drop policy if exists "users or staff-as-official delete follows" on public.follows;
create policy "users or staff-as-official delete follows"
  on public.follows for delete using (
    auth.uid() = follower_id
    or (
      exists (select 1 from public.profiles where id = follower_id and is_official = true)
      and
      exists (select 1 from public.profiles where id = auth.uid() and (is_admin = true or is_operator = true))
    )
  );
-- (SELECT stays public — `follows are public` from Stage 5.)

-- ===================================================================
-- Stage 27 (optional QA account) is not run automatically.
-- Staff can provision it through Settings using ensure_dev_account (Stage 29).

-- Stage 28 — one-line dev-password helper for the SQL Editor
-- ===================================================================
-- Optional password rotation for a QA account already provisioned via Settings
-- (ensure_dev_account in Stage 29). SQL Editor only:
--   select public.set_dev_password('your-strong-pass');
--
-- @spotcode_official is intentionally NOT covered — by design the
-- brand account has an unrecoverable random password (Stage 25)
-- and is only acted on via the「公式」overlay (admins/operators
-- with their own auth session). Don't add a set_official_password
-- helper unless that design changes.
--
-- The function lives in `public` but EXECUTE access is revoked from
-- `anon` and `authenticated` — only the `postgres` role (which the
-- Supabase SQL Editor runs as) can call it. The `service_role`
-- keeps default access as a backup path for tooling. PostgREST
-- clients with an end-user JWT can NOT rotate the dev password.

create or replace function public.set_dev_password(new_pass text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_id uuid;
begin
  if new_pass is null or length(new_pass) < 8 then
    raise exception 'new_pass must be at least 8 characters';
  end if;
  select id into v_id from auth.users where email = 'dev.test.account@spotcode-sns.local';
  if v_id is null then
    raise exception 'Create the QA account in Settings first (ensure_dev_account).';
  end if;
  update auth.users
  set encrypted_password = crypt(new_pass, gen_salt('bf')),
      updated_at         = now()
  where id = v_id;
end $$;

revoke execute on function public.set_dev_password(text) from public, anon, authenticated;

-- ===================================================================
-- Stage 29 — RPC: ensure dev account exists + set password
-- ===================================================================
-- Backs the「dev test アカウントのパスワード」card on /settings.
-- One call handles both initial provisioning AND rotation, so the
-- admin / operator doesn't have to chain Stage 27 → set_dev_password
-- (or remember which is which).
--
-- Auth check lives INSIDE the function: only an authenticated user
-- whose profiles row has is_admin OR is_operator true can call it.
-- EXECUTE is granted to `authenticated` so PostgREST forwards the
-- request; the in-function check is the actual gate (a regular
-- end-user JWT will hit the friendly exception, not silently
-- succeed in writing).

create or replace function public.ensure_dev_account(new_pass text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_caller uuid := auth.uid();
  v_email  text := 'dev.test.account@spotcode-sns.local';
  v_handle text := 'spotcode_dev';
  v_name   text := 'spotcode dev';
  v_id     uuid;
  v_is_staff boolean;
begin
  if v_caller is null then
    raise exception 'Sign in first.';
  end if;
  select (coalesce(is_admin, false) or coalesce(is_operator, false))
    into v_is_staff
  from public.profiles
  where id = v_caller;
  if not coalesce(v_is_staff, false) then
    raise exception 'admin / operator のみ実行できます。';
  end if;
  if new_pass is null or length(new_pass) < 8 then
    raise exception 'パスワードは 8 文字以上で設定してください。';
  end if;

  select id into v_id from auth.users where email = v_email;

  if v_id is null then
    insert into auth.users (
      id, instance_id, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      aud, role, raw_user_meta_data, raw_app_meta_data
    )
    values (
      gen_random_uuid(),
      '00000000-0000-0000-0000-000000000000',
      v_email,
      crypt(new_pass, gen_salt('bf')),
      now(), now(), now(),
      'authenticated', 'authenticated',
      jsonb_build_object('handle', v_handle, 'name', v_name),
      '{"provider":"email","providers":["email"]}'::jsonb
    )
    returning id into v_id;
  else
    update auth.users
    set encrypted_password = crypt(new_pass, gen_salt('bf')),
        updated_at         = now()
    where id = v_id;
  end if;

  insert into public.profiles (id, handle, name, role)
  values (v_id, v_handle, v_name, 'general')
  on conflict (id) do update set
    handle = excluded.handle,
    name   = excluded.name,
    role   = excluded.role;
end $$;

revoke execute on function public.ensure_dev_account(text) from public, anon;
grant  execute on function public.ensure_dev_account(text) to   authenticated;

-- ===================================================================
-- Stage 30 — posts.repo_full_name (GitHub repo tagging)
-- ===================================================================
-- Backs the /repos view: when a post is "about" a particular GitHub
-- repository, we store its `owner/repo` slug so /repos can show
-- per-repo activity (posts tagged with that repo) alongside the
-- public GitHub data (recent commits, language, stars).
--
-- The tagging UI itself ships in a follow-up — for now the column
-- is nullable and the existing compose flow leaves it null. The
-- /repos view degrades gracefully (shows「まだ投稿なし」) on empty.
--
-- The case-insensitive index supports the equality scan we do from
-- `postsByRepo(fullName)` — GitHub treats owner/repo as case-folded
-- so the index keeps lookups O(log n) regardless of how the user
-- typed it.

alter table public.posts
  add column if not exists repo_full_name text;

create index if not exists posts_repo_full_name_idx
  on public.posts (lower(repo_full_name))
  where repo_full_name is not null;

-- ===================================================================
-- Stage 31 — posts.event_url (connpass event tagging)
-- ===================================================================
-- Backs the /event/<connpass-id> view. When a post is "about" a
-- particular connpass event, we store the canonical URL
-- (https://connpass.com/event/<id>/) so /event/<id> can aggregate
-- every post that references the same event and connpass metadata
-- (title / date / venue) can be fetched from the public API at
-- render time.
--
-- Nullable — pre-existing posts have no event tag and the compose UI
-- only sets this when the user opens the "+ イベントを追加" input and
-- pastes a connpass URL. Client-side parseConnpassUrl() normalises
-- the URL before insert so grouping by exact string match works.
--
-- A partial index on `event_url is not null` keeps the /event/<id>
-- lookup O(log n) without indexing the tail of untagged rows.

alter table public.posts
  add column if not exists event_url text;

create index if not exists posts_event_url_idx
  on public.posts (event_url)
  where event_url is not null;

-- ===================================================================
-- Stage 32 — staff may edit the shared official profile
-- ===================================================================
-- The normal owner policy remains unchanged. This narrowly permits an
-- authenticated admin/operator to update only @spotcode_official; it does
-- not grant staff blanket write access to other users' profiles.

drop policy if exists "staff can update official profile" on public.profiles;
create or replace function public.can_manage_official_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (is_admin = true or is_operator = true)
  );
$$;
revoke execute on function public.can_manage_official_profile() from public, anon;
grant execute on function public.can_manage_official_profile() to authenticated;

drop policy if exists "staff can update official profile" on public.profiles;
create policy "staff can update official profile"
  on public.profiles for update
  using (
    handle = 'spotcode_official'
    and public.can_manage_official_profile()
  )
  with check (handle = 'spotcode_official');

-- ===================================================================
-- Stage 33 — cross-device Open Issue display preferences
-- ===================================================================
create table if not exists public.issue_display_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hidden_repos text[] not null default '{}',
  include_private boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.issue_display_preferences enable row level security;
drop policy if exists "users read own issue preferences" on public.issue_display_preferences;
drop policy if exists "users insert own issue preferences" on public.issue_display_preferences;
drop policy if exists "users update own issue preferences" on public.issue_display_preferences;
drop policy if exists "users read own issue preferences" on public.issue_display_preferences;
create policy "users read own issue preferences" on public.issue_display_preferences
  for select using (auth.uid() = user_id);
drop policy if exists "users insert own issue preferences" on public.issue_display_preferences;
create policy "users insert own issue preferences" on public.issue_display_preferences
  for insert with check (auth.uid() = user_id);
drop policy if exists "users update own issue preferences" on public.issue_display_preferences;
create policy "users update own issue preferences" on public.issue_display_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ===================================================================
-- Stage 34 — encrypted cross-device GitHub private-Issue grant
-- ===================================================================
create extension if not exists supabase_vault cascade;

create table if not exists public.github_private_issue_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  secret_id uuid not null unique,
  updated_at timestamptz not null default now()
);
alter table public.github_private_issue_grants enable row level security;
revoke all on public.github_private_issue_grants from public, anon, authenticated;

create or replace function public.save_github_private_issue_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_user uuid := auth.uid();
  v_secret uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if nullif(trim(p_token), '') is null then raise exception 'empty token'; end if;
  select secret_id into v_secret from public.github_private_issue_grants where user_id = v_user;
  if v_secret is null then
    v_secret := vault.create_secret(p_token, 'spotcode-github-' || v_user::text, 'GitHub private Issue OAuth token');
    insert into public.github_private_issue_grants(user_id, secret_id)
    values (v_user, v_secret)
    on conflict (user_id) do update set secret_id = excluded.secret_id, updated_at = now();
  else
    perform vault.update_secret(v_secret, p_token);
    update public.github_private_issue_grants set updated_at = now() where user_id = v_user;
  end if;
  return true;
end $$;

create or replace function public.get_github_private_issue_token()
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets d
  join public.github_private_issue_grants g on g.secret_id = d.id
  where g.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.delete_github_private_issue_token()
returns boolean
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_secret uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.github_private_issue_grants where user_id = auth.uid() returning secret_id into v_secret;
  if v_secret is not null then delete from vault.secrets where id = v_secret; end if;
  return true;
end $$;

revoke execute on function public.save_github_private_issue_token(text) from public, anon;
revoke execute on function public.get_github_private_issue_token() from public, anon;
revoke execute on function public.delete_github_private_issue_token() from public, anon;
grant execute on function public.save_github_private_issue_token(text) to authenticated;
grant execute on function public.get_github_private_issue_token() to authenticated;
grant execute on function public.delete_github_private_issue_token() to authenticated;

-- ===================================================================
-- Stage 35 — Only-me posts (apply before deploying the clients).
-- Restrictive policy also blocks the existing staff moderation exceptions.
-- Existing audience policies still decide access to all other posts.

alter table public.posts drop constraint if exists posts_visibility_check;
alter table public.posts add constraint posts_visibility_check
  check (visibility in ('public','restricted','mutuals','following','friends','org','only_me','github_org'));

drop policy if exists "only-me posts belong to their author" on public.posts;
create policy "only-me posts belong to their author"
  on public.posts as restrictive for all
  using (visibility is distinct from 'only_me' or auth.uid() = author_id)
  with check (visibility is distinct from 'only_me' or auth.uid() = author_id);


-- Stage 36 — Admin read access to only-me posts in developer mode.

drop policy if exists "only-me posts belong to their author" on public.posts;

drop policy if exists "only-me read access" on public.posts;
create policy "only-me read access" on public.posts as restrictive for select
using (
  visibility is distinct from 'only_me'
  or auth.uid() = author_id
  or (
    coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-spotcode-dev-mode', '') = '1'
    and exists (select 1 from public.profiles viewer where viewer.id = auth.uid() and viewer.is_admin = true)
  )
);

-- Preserve author-only writes; developer mode adds viewing access only.
drop policy if exists "only-me insert access" on public.posts;
create policy "only-me insert access" on public.posts as restrictive for insert
with check (visibility is distinct from 'only_me' or auth.uid() = author_id);

drop policy if exists "only-me update access" on public.posts;
create policy "only-me update access" on public.posts as restrictive for update
using (visibility is distinct from 'only_me' or auth.uid() = author_id)
with check (visibility is distinct from 'only_me' or auth.uid() = author_id);

drop policy if exists "only-me delete access" on public.posts;
create policy "only-me delete access" on public.posts as restrictive for delete
using (visibility is distinct from 'only_me' or auth.uid() = author_id);


-- Verified GitHub Organization membership and post audiences.

create table if not exists public.github_org_memberships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  github_user_id bigint not null,
  org_id bigint not null,
  login text not null,
  role text not null,
  valid_until timestamptz not null,
  primary key(user_id, org_id)
);
create table if not exists public.github_org_accounts (
  account_id uuid primary key references public.profiles(id) on delete cascade,
  org_id bigint not null,
  login text not null
);
alter table public.github_org_memberships enable row level security;
alter table public.github_org_accounts enable row level security;
revoke all on public.github_org_memberships, public.github_org_accounts from anon, authenticated;
grant select on public.github_org_memberships, public.github_org_accounts to authenticated;
grant all on public.github_org_memberships, public.github_org_accounts to service_role;
drop policy if exists "read own github memberships" on public.github_org_memberships;
create policy "read own github memberships" on public.github_org_memberships for select using (user_id = auth.uid());
drop policy if exists "read own github org link" on public.github_org_accounts;
create policy "read own github org link" on public.github_org_accounts for select using (account_id = auth.uid());

create or replace function public.replace_github_org_memberships(p_user uuid, p_github_user bigint, p_organizations jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Serializes concurrent syncs for the same user.
  perform 1 from public.profiles where id = p_user for update;
  delete from public.github_org_memberships where user_id = p_user;
  insert into public.github_org_memberships(user_id, github_user_id, org_id, login, role, valid_until)
  select p_user, p_github_user, (item->>'id')::bigint, item->>'login', item->>'role', now() + interval '1 hour'
  from jsonb_array_elements(p_organizations) item;
end $$;
revoke all on function public.replace_github_org_memberships(uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.replace_github_org_memberships(uuid,bigint,jsonb) to service_role;

create or replace function public.is_verified_github_org_member(p_org bigint)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.github_org_memberships m
    join auth.identities i on i.user_id = m.user_id and i.provider = 'github'
    where m.user_id = auth.uid() and m.org_id = p_org and m.valid_until > now()
      and m.github_user_id::text in (i.identity_data->>'provider_id', i.identity_data->>'sub', i.identity_data->>'id')
  );
$$;
revoke all on function public.is_verified_github_org_member(bigint) from public, anon;
grant execute on function public.is_verified_github_org_member(bigint) to anon, authenticated;

alter table public.posts add column if not exists github_org_id bigint;
alter table public.posts drop constraint if exists posts_visibility_check;
alter table public.posts add constraint posts_visibility_check check (visibility in ('public','restricted','mutuals','following','friends','org','only_me','github_org'));

create or replace function public.stamp_post_github_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.visibility = 'github_org' then
    if tg_op = 'UPDATE' then
      if old.visibility = 'github_org' and old.author_id = new.author_id then
        new.github_org_id := old.github_org_id;
        return new;
      end if;
    end if;
    select o.org_id into new.github_org_id from public.github_org_accounts o
      join public.profiles p on p.id = o.account_id and p.is_org = true
      where o.account_id = new.author_id;
    if new.github_org_id is null then raise exception 'Link a GitHub Organization in account settings first'; end if;
    if not public.is_verified_github_org_member(new.github_org_id) then raise exception 'Refresh your GitHub Organization membership first'; end if;
  else
    new.github_org_id := null;
  end if;
  return new;
end $$;
revoke all on function public.stamp_post_github_org() from public, anon, authenticated;
drop trigger if exists stamp_post_github_org on public.posts;
create trigger stamp_post_github_org before insert or update on public.posts for each row execute function public.stamp_post_github_org();

-- Additional permissive path for verified members; restrictive guard also
-- prevents unrelated existing moderation/public policies from opening posts.
drop policy if exists "github org members read posts" on public.posts;
create policy "github org members read posts" on public.posts for select to authenticated
using (visibility = 'github_org' and public.is_verified_github_org_member(github_org_id));
drop policy if exists "github org post audience" on public.posts;
create policy "github org post audience" on public.posts as restrictive for select
using (
  visibility is distinct from 'github_org' or author_id = auth.uid()
  or (auth.uid() is not null and public.is_verified_github_org_member(github_org_id))
  or (
    coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-spotcode-dev-mode', '') = '1'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  )
);

-- Stage 39: Display member contributions under the linked organization account.
-- Requires Stage 38. author_id remains the actual author for ownership/audiences.

alter table public.posts add column if not exists organization_author_id uuid
  references public.profiles(id) on delete set null;
-- Also repair installations where the column existed without its foreign key.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.posts'::regclass
    and conname = 'posts_organization_author_id_fkey') then
    alter table public.posts add constraint posts_organization_author_id_fkey
      foreign key (organization_author_id) references public.profiles(id) on delete set null;
  end if;
end $$;
create index if not exists posts_organization_author_idx
  on public.posts(organization_author_id, created_at desc) where organization_author_id is not null;

create or replace function public.stamp_post_organization_author()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  repository text;
  owner_login text;
  candidates uuid[];
begin
  -- Attribution is historical. Body/audience edits must not change it after
  -- the member leaves, the link is removed, or the organization is renamed.
  if tg_op = 'UPDATE' then
    if new.author_id = old.author_id
      and new.repo_full_name is not distinct from old.repo_full_name
      and new.github_link is not distinct from old.github_link then
      select p.id into new.organization_author_id from public.profiles p
        where p.id = old.organization_author_id;
      return new;
    end if;
  end if;
  new.organization_author_id := null;
  -- Official-account overlays and moderation never impersonate a member.
  if new.author_id is distinct from auth.uid() then return new; end if;
  repository := nullif(btrim(new.repo_full_name), '');
  if repository is null then
    repository := substring(new.github_link from '(?i)^https://github\.com/([a-z0-9-]+/[a-z0-9_.-]+)(?:[/?#]|$)');
  end if;
  if repository is null or repository !~* '^[a-z0-9-]+/[a-z0-9_.-]+$' then return new; end if;
  owner_login := lower(split_part(repository, '/', 1));
  select array_agg(a.account_id) into candidates
    from public.github_org_accounts a
    join public.profiles p on p.id = a.account_id and p.is_org = true
    where lower(a.login) = owner_login and public.is_verified_github_org_member(a.org_id)
      and exists (select 1 from public.github_org_memberships m
        where m.user_id = auth.uid() and m.org_id = a.org_id and lower(m.login) = owner_login);
  if cardinality(candidates) > 1 then
    raise exception 'Multiple organization accounts are linked to this GitHub Organization. Keep one account linked before posting.';
  end if;
  new.organization_author_id := candidates[1];
  return new;
end $$;
revoke all on function public.stamp_post_organization_author() from public, anon, authenticated;
drop trigger if exists stamp_post_00_organization_author on public.posts;
-- PostgreSQL runs same-event triggers alphabetically, before the audience stamp.
create trigger stamp_post_00_organization_author before insert or update on public.posts
  for each row execute function public.stamp_post_organization_author();

create or replace function public.stamp_post_github_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.visibility = 'github_org' then
    if tg_op = 'UPDATE' then
      if old.visibility = 'github_org' and old.author_id = new.author_id then
        new.github_org_id := old.github_org_id;
        return new;
      end if;
    end if;
    select o.org_id into new.github_org_id from public.github_org_accounts o
      join public.profiles p on p.id = o.account_id and p.is_org = true
      where o.account_id = coalesce(new.organization_author_id, new.author_id);
    if new.github_org_id is null then raise exception 'Link a GitHub Organization or select its repository first'; end if;
    if not public.is_verified_github_org_member(new.github_org_id) then raise exception 'Refresh your GitHub Organization membership first'; end if;
  else
    new.github_org_id := null;
  end if;
  return new;
end $$;
notify pgrst, 'reload schema';

-- Explicit opt-in: existing implicit 'all repositories' is not a selection.

alter table public.issue_display_preferences
  add column if not exists selected_repos text[] not null default '{}';
notify pgrst, 'reload schema';

-- Organization accounts authorize through a GitHub organization owner.
-- Personal identity linking remains required for personal memberships.

create or replace function public.is_verified_github_org_member(p_org bigint)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.github_org_memberships m
    where m.user_id = auth.uid() and m.org_id = p_org and m.valid_until > now()
      and (
        exists (select 1 from auth.identities i where i.user_id = m.user_id and i.provider = 'github'
          and m.github_user_id::text in (i.identity_data->>'provider_id', i.identity_data->>'sub', i.identity_data->>'id'))
        or (m.role = 'admin' and exists (
          select 1 from public.github_org_accounts a join public.profiles p on p.id = a.account_id
          where a.account_id = m.user_id and a.org_id = m.org_id and p.is_org = true
        ))
      )
  );
$$;
revoke all on function public.is_verified_github_org_member(bigint) from public, anon;
grant execute on function public.is_verified_github_org_member(bigint) to anon, authenticated;
notify pgrst, 'reload schema';

-- Requires the Organization setup repair (Stages 38, 39, 41).

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


create table if not exists public.user_blocks (
 blocker_id uuid not null references public.profiles(id) on delete cascade,
 blocked_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(blocker_id,blocked_id), check(blocker_id<>blocked_id)
);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon,authenticated;
grant select,delete on public.user_blocks to authenticated;
drop policy if exists "read own blocks" on public.user_blocks;
create policy "read own blocks" on public.user_blocks for select to authenticated using(blocker_id=auth.uid());
drop policy if exists "remove own blocks" on public.user_blocks;
create policy "remove own blocks" on public.user_blocks for delete to authenticated using(blocker_id=auth.uid());
create table if not exists public.moderation_events (
 id uuid primary key default gen_random_uuid(),
 reporter_id uuid references public.profiles(id) on delete set null,
 target_id uuid references public.profiles(id) on delete set null,
 post_id uuid references public.posts(id) on delete set null,
 kind text not null, detail text not null,
 created_at timestamptz not null default now()
);
alter table public.moderation_events enable row level security;
revoke all on public.moderation_events from anon,authenticated;
grant select on public.moderation_events to authenticated;
drop policy if exists "staff read safety notifications" on public.moderation_events;
create policy "staff read safety notifications" on public.moderation_events for select to authenticated
 using(exists(select 1 from public.profiles where id=auth.uid() and (is_admin or is_operator)));
create or replace function public.block_user(p_target uuid,p_post uuid default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or auth.uid()=p_target then raise exception 'Invalid block target'; end if;
 if p_post is not null then
  if not exists(select 1 from posts where id=p_post) then p_post := null;
  elsif not exists(select 1 from posts where id=p_post and (author_id=p_target or organization_author_id=p_target)) then raise exception 'Invalid post'; end if;
 end if;
 insert into user_blocks(blocker_id,blocked_id) values(auth.uid(),p_target) on conflict do nothing;
 if found then
  insert into moderation_events(reporter_id,target_id,post_id,kind,detail)
  values(auth.uid(),p_target,p_post,'block','User blocked this account. Review the account and associated content.');
 end if;
end $$;
revoke all on function public.block_user(uuid,uuid) from public,anon;
grant execute on function public.block_user(uuid,uuid) to authenticated;
create or replace function public.notify_content_report()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into moderation_events(reporter_id,target_id,post_id,kind,detail)
 select new.reporter_id,p.author_id,new.post_id,'report',new.reason || ': ' || coalesce(new.comment,'') from posts p where p.id=new.post_id;
 return new;
end $$;
revoke all on function public.notify_content_report() from public,anon,authenticated;
drop trigger if exists notify_content_report on public.reports;
create trigger notify_content_report after insert on public.reports for each row execute function public.notify_content_report();
create or replace function public.has_blocked(p_target uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from user_blocks where blocker_id=auth.uid() and blocked_id=p_target);
$$;
revoke all on function public.has_blocked(uuid) from public;
grant execute on function public.has_blocked(uuid) to anon,authenticated;
drop policy if exists "hide blocked posts" on public.posts;
create policy "hide blocked posts" on public.posts as restrictive for select
 using(not public.has_blocked(author_id) and not public.has_blocked(organization_author_id));
drop policy if exists "hide blocked comments" on public.comments;
create policy "hide blocked comments" on public.comments as restrictive for select using(not public.has_blocked(author_id));
notify pgrst,'reload schema';

-- Stage 44: social controls and followed-post district notifications

create table if not exists public.user_mutes (
 user_id uuid not null references public.profiles(id) on delete cascade,
 muted_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(user_id,muted_id), check(user_id<>muted_id)
);
alter table public.user_mutes enable row level security;
revoke all on public.user_mutes from anon,authenticated;
grant select,insert,delete on public.user_mutes to authenticated;
drop policy if exists "manage own mutes" on public.user_mutes;
create policy "manage own mutes" on public.user_mutes to authenticated
 using(user_id=auth.uid()) with check(user_id=auth.uid());

-- Modify one list membership atomically so concurrent selections do not
-- replace other members or unrelated profile preferences.
create or replace function public.set_audience_member(p_target uuid,p_kind text,p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
declare target_handle text; members text[];
begin
 if auth.uid() is null or p_target=auth.uid() or p_kind is null or p_kind not in ('friends','org') or p_enabled is null then
  raise exception 'Invalid audience member';
 end if;
 select handle into target_handle from profiles where id=p_target;
 if target_handle is null then raise exception 'User not found'; end if;
 if p_enabled and not exists(select 1 from follows where follower_id=auth.uid() and target_id=p_target and status='accepted') then
  raise exception '先にこのユーザーをフォローしてください';
 end if;
 select case when p_kind='friends' then close_friends else org_members end into members
 from profiles where id=auth.uid() for update;
 members := array_remove(coalesce(members,'{}'),target_handle);
 if p_enabled then members := array_append(members,target_handle); end if;
 if p_kind='friends' then update profiles set close_friends=members where id=auth.uid();
 else update profiles set org_members=members where id=auth.uid(); end if;
end $$;
revoke all on function public.set_audience_member(uuid,text,boolean) from public,anon;
grant execute on function public.set_audience_member(uuid,text,boolean) to authenticated;

-- Invoker rights preserve posts RLS (private accounts and every audience).
-- Only the coarse district is returned as notification context, never GPS.
create or replace function public.followed_post_notifications(p_scope text default 'off',p_limit integer default 30)
returns table(post jsonb,district text)
language sql stable security invoker set search_path=public as $$
 select to_jsonb(p) || jsonb_build_object('author',jsonb_build_object(
   'id',a.id,'handle',a.handle,'name',a.name,'avatar_url',a.avatar_url),
   'organization_author',case when o.id is null then null else jsonb_build_object(
   'id',o.id,'handle',o.handle,'name',o.name,'avatar_url',o.avatar_url) end),
   coalesce(nullif(btrim(p.spot->'addressDetails'->>'city'),''),
     substring(p.spot->>'address' from '[一-龠ぁ-んァ-ヶー]+[市区町村]'),'地区未設定')
 from posts p join profiles a on a.id=p.author_id
 left join profiles o on o.id=p.organization_author_id
 where p.created_at<=now() and auth.uid() is not null and p_scope in ('following','mutuals')
 and p.author_id<>auth.uid() and coalesce(p.organization_author_id,p.author_id)<>auth.uid()
 and exists(select 1 from follows f where f.follower_id=auth.uid()
   and f.target_id=coalesce(p.organization_author_id,p.author_id) and f.status='accepted')
 and (p_scope='following' or exists(select 1 from follows f where f.target_id=auth.uid()
   and f.follower_id=coalesce(p.organization_author_id,p.author_id) and f.status='accepted'))
 and not exists(select 1 from user_mutes m where m.user_id=auth.uid() and m.muted_id in(p.author_id,p.organization_author_id))
 and not exists(select 1 from user_blocks b where b.blocker_id=auth.uid() and b.blocked_id in(p.author_id,p.organization_author_id))
 order by p.created_at desc,p.id desc limit greatest(1,least(coalesce(p_limit,30),100));
$$;
revoke all on function public.followed_post_notifications(text,integer) from public,anon;
grant execute on function public.followed_post_notifications(text,integer) to authenticated;
notify pgrst,'reload schema';

-- ===================================================================
-- Stage 45 — business-cards
-- ===================================================================
-- Run before deploying the business-card UI. Only explicitly saved cards are public.

create table if not exists public.business_cards (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  title text not null default '' check (char_length(title) <= 100),
  bio text not null default '' check (char_length(bio) <= 280),
  contact text not null default '' check (char_length(contact) <= 160),
  theme text not null default 'midnight' check (theme in ('midnight', 'paper', 'aurora')),
  layout text not null default 'classic' check (layout in ('classic', 'centered'))
);
create table if not exists public.business_card_collection (
  collector_id uuid not null references public.profiles(id) on delete cascade,
  card_owner_id uuid not null references public.business_cards(owner_id) on delete cascade,
  collected_at timestamptz not null default now(),
  primary key (collector_id, card_owner_id),
  check (collector_id <> card_owner_id)
);
alter table public.business_cards enable row level security;
alter table public.business_card_collection enable row level security;
drop policy if exists "published cards are readable" on public.business_cards;
create policy "published cards are readable" on public.business_cards for select to anon, authenticated using (true);
drop policy if exists "owners create cards" on public.business_cards;
create policy "owners create cards" on public.business_cards for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "owners edit cards" on public.business_cards;
create policy "owners edit cards" on public.business_cards for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "owners unpublish cards" on public.business_cards;
create policy "owners unpublish cards" on public.business_cards for delete to authenticated using (owner_id = auth.uid());
drop policy if exists "collectors read their collection" on public.business_card_collection;
create policy "collectors read their collection" on public.business_card_collection for select to authenticated using (collector_id = auth.uid());
drop policy if exists "collectors save cards" on public.business_card_collection;
create policy "collectors save cards" on public.business_card_collection for insert to authenticated with check (collector_id = auth.uid());
drop policy if exists "collectors remove cards" on public.business_card_collection;
create policy "collectors remove cards" on public.business_card_collection for delete to authenticated using (collector_id = auth.uid());
grant select on public.business_cards to anon;
grant select, insert, update, delete on public.business_cards to authenticated;
grant select, insert, delete on public.business_card_collection to authenticated;

-- ===================================================================
-- Stage 46 — business-card-design
-- ===================================================================
-- Apply after 045. Existing cards keep their original preset appearance.

alter table public.business_cards add column if not exists design jsonb not null default '{}'::jsonb
  check (jsonb_typeof(design) = 'object' and octet_length(design::text) <= 2048);

-- ===================================================================
-- Stage 47 — business-card-media
-- ===================================================================

alter table public.business_cards
  add column if not exists image_url text not null default '' check (octet_length(image_url) <= 1000000),
  add column if not exists image_side text not null default 'front' check (image_side in ('front','back')),
  add column if not exists image_shape text not null default 'square' check (image_shape in ('square','round')),
  add column if not exists image_size integer not null default 64 check (image_size between 48 and 100),
  add column if not exists image_link text not null default '' check (char_length(image_link) <= 2048),
  add column if not exists links_side text not null default 'front' check (links_side in ('front','back')),
  add column if not exists links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 3 and octet_length(links::text) <= 10000);

-- ===================================================================
-- Stage 48 — business-card-collection-read
-- ===================================================================
-- Apply before releasing clients. Only owners and collectors can read card data.

drop policy if exists "published cards are readable" on public.business_cards;
drop policy if exists "owners and collectors read cards" on public.business_cards;
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

-- ===================================================================
-- Stage 49 — internet-card-exchange
-- ===================================================================
-- Internet transport for card exchange. Apply after 048.

create table if not exists public.business_card_exchanges (
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

-- ===================================================================
-- Stage 50 — short-card-exchange-code
-- ===================================================================
-- Shorten newly created codes; existing codes remain usable until expiry.

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

-- ===================================================================
-- Stage 51 — business-card-layers
-- ===================================================================
-- Preserve existing preset cards while allowing bounded per-layer geometry.

alter table public.business_cards drop constraint if exists business_cards_design_check;
alter table public.business_cards add constraint business_cards_design_check
  check (jsonb_typeof(design) = 'object' and octet_length(design::text) <= 16384);



-- Stage 52 — multiple event days
-- Multiple calendar-day/link pairs for one event post. Existing posts are unchanged.
alter table public.posts add column if not exists event_days jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'posts_event_days_array' and conrelid = 'public.posts'::regclass) then
    alter table public.posts add constraint posts_event_days_array
      check (event_days is null or jsonb_typeof(event_days) = 'array');
  end if;
end $$;
notify pgrst, 'reload schema';

-- Stage 53 — security boundaries (same as standalone migration).

-- A first-factor session remains useful for accounts without verified MFA.
-- Enrollment is read from Auth's trusted table, never user-editable metadata.
create or replace function public.session_has_required_aal()
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth as $$
 select auth.uid() is null
   or coalesce(auth.jwt()->>'aal', '') = 'aal2'
   or not exists (select 1 from auth.mfa_factors f
                  where f.user_id = auth.uid() and f.status = 'verified');
$$;
revoke all on function public.session_has_required_aal() from public;
grant execute on function public.session_has_required_aal() to anon, authenticated, service_role;

create or replace function public.require_session_aal()
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
 if not public.session_has_required_aal() then
  raise exception 'Second factor required' using errcode = '42501';
 end if;
end $$;
revoke all on function public.require_session_aal() from public;
grant execute on function public.require_session_aal() to anon, authenticated, service_role;

-- Restrictive policies cannot be bypassed by another permissive policy.
do $$ declare t record; begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relkind='r' and c.relrowsecurity loop
  execute format('drop policy if exists "require enrolled MFA" on public.%I', t.relname);
  execute format('create policy "require enrolled MFA" on public.%I as restrictive for all to anon, authenticated using (public.session_has_required_aal()) with check (public.session_has_required_aal())', t.relname);
 end loop;
end $$;

-- Definer functions intentionally bypass RLS, so callable mutations/secrets
-- receive the same check inside their trusted entry point (definitions below).

-- Staff and official-account designations are managed only by SQL/service roles.
-- Invoker trigger retains current_user: owner-side Auth provisioning still works.
create or replace function public.protect_profile_authority()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if current_user in ('anon','authenticated') then
  if tg_op = 'INSERT' then
   if coalesce(new.is_admin,false) or coalesce(new.is_operator,false) or coalesce(new.is_official,false) then
    raise exception 'Profile authority is server managed' using errcode='42501';
   end if;
  elsif new.is_admin is distinct from old.is_admin
     or new.is_operator is distinct from old.is_operator
     or new.is_official is distinct from old.is_official then
   raise exception 'Profile authority is server managed' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.protect_profile_authority() from public,anon,authenticated;
drop trigger if exists protect_profile_authority on public.profiles;
create trigger protect_profile_authority before insert or update on public.profiles
 for each row execute function public.protect_profile_authority();

-- Target approval is required even for a staff member following as official.
create or replace function public.protect_follow_identity()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' and (new.follower_id is distinct from old.follower_id or new.target_id is distinct from old.target_id) then
  raise exception 'Follow identity is immutable' using errcode='42501';
 end if;
 if tg_op='INSERT' and current_user in ('anon','authenticated') then
  if exists(select 1 from public.profiles where id=new.target_id and is_private) then
   new.status := 'pending';
  else
   new.status := 'accepted';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.protect_follow_identity() from public,anon,authenticated;
drop trigger if exists protect_follow_identity on public.follows;
create trigger protect_follow_identity before insert or update on public.follows
 for each row execute function public.protect_follow_identity();

-- Resolve legacy handles ONCE. Historical recycling before this upgrade cannot
-- be reconstructed; owners should review pre-existing curated memberships.
-- NULL marks an unmigrated list. Empty UUID arrays are already migrated.
alter table public.profiles add column if not exists close_friend_ids uuid[];
alter table public.profiles add column if not exists org_member_ids uuid[];
update public.profiles p set close_friend_ids = array(
 select q.id from unnest(p.close_friends) with ordinality h(handle,ord)
 join public.profiles q on q.handle=h.handle order by h.ord)
 where close_friend_ids is null;
update public.profiles p set org_member_ids = array(
 select q.id from unnest(p.org_members) with ordinality h(handle,ord)
 join public.profiles q on q.handle=h.handle order by h.ord)
 where org_member_ids is null;
-- Normalize legacy display arrays to the same positions as their stable IDs.
update public.profiles p set close_friends = array(
 select q.handle from unnest(p.close_friend_ids) with ordinality i(id,ord)
 join public.profiles q on q.id=i.id order by i.ord),
 org_members = array(select q.handle from unnest(p.org_member_ids) with ordinality i(id,ord)
 join public.profiles q on q.id=i.id order by i.ord)
 where close_friends is distinct from array(select q.handle from unnest(p.close_friend_ids) with ordinality i(id,ord) join public.profiles q on q.id=i.id order by i.ord)
 or org_members is distinct from array(select q.handle from unnest(p.org_member_ids) with ordinality i(id,ord) join public.profiles q on q.id=i.id order by i.ord);
alter table public.profiles alter column close_friend_ids set default '{}';
alter table public.profiles alter column org_member_ids set default '{}';

-- Handles remain display snapshots for older readers. Legacy handle-only writes
-- fail closed: a stale retry after a rename cannot prove which principal the
-- editor selected. Updated clients submit UUIDs or use set_audience_member.
create or replace function public.sync_audience_identities()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if current_user in ('anon','authenticated') then
  if tg_op='INSERT' then
   if (coalesce(cardinality(new.close_friends),0)>0 and coalesce(cardinality(new.close_friend_ids),0)=0)
      or (coalesce(cardinality(new.org_members),0)>0 and coalesce(cardinality(new.org_member_ids),0)=0) then
    raise exception 'Audience edits require stable user IDs' using errcode='42501';
   end if;
  elsif (new.close_friends is distinct from old.close_friends and new.close_friend_ids is not distinct from old.close_friend_ids)
     or (new.org_members is distinct from old.org_members and new.org_member_ids is not distinct from old.org_member_ids) then
   raise exception 'Audience edits require stable user IDs' using errcode='42501';
  end if;
 end if;
 -- Preserve identities through renames, remove deleted principals, deduplicate.
 select coalesce(array_agg(q.id order by i.ord),'{}'),coalesce(array_agg(q.handle order by i.ord),'{}')
 into new.close_friend_ids,new.close_friends
 from (select id,min(ord) ord from unnest(coalesce(new.close_friend_ids,'{}')) with ordinality a(id,ord) group by id) i
 join public.profiles q on q.id=i.id;
 select coalesce(array_agg(q.id order by i.ord),'{}'),coalesce(array_agg(q.handle order by i.ord),'{}')
 into new.org_member_ids,new.org_members
 from (select id,min(ord) ord from unnest(coalesce(new.org_member_ids,'{}')) with ordinality a(id,ord) group by id) i
 join public.profiles q on q.id=i.id;
 return new;
end $$;
revoke all on function public.sync_audience_identities() from public,anon,authenticated;
drop trigger if exists sync_audience_identities on public.profiles;
create trigger sync_audience_identities before insert or update of close_friends,org_members,close_friend_ids,org_member_ids
 on public.profiles for each row execute function public.sync_audience_identities();

create or replace function public.set_audience_member(p_target uuid,p_kind text,p_enabled boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare members uuid[];
begin
 perform public.require_session_aal();
 if auth.uid() is null or p_target is null or p_target=auth.uid() or p_kind is null or p_kind not in ('friends','org') or p_enabled is null then
  raise exception 'Invalid audience member';
 end if;
 if not exists(select 1 from public.profiles where id=p_target) then raise exception 'User not found'; end if;
 if p_enabled and not exists(select 1 from public.follows where follower_id=auth.uid() and target_id=p_target and status='accepted') then
  raise exception '先にこのユーザーをフォローしてください';
 end if;
 select case when p_kind='friends' then close_friend_ids else org_member_ids end into members
 from public.profiles where id=auth.uid() for update;
 members:=array_remove(coalesce(members,'{}'),p_target);
 if p_enabled then members:=array_append(members,p_target); end if;
 if p_kind='friends' then update public.profiles set close_friend_ids=members where id=auth.uid();
 else update public.profiles set org_member_ids=members where id=auth.uid(); end if;
end $$;
revoke all on function public.set_audience_member(uuid,text,boolean) from public,anon;
grant execute on function public.set_audience_member(uuid,text,boolean) to authenticated;

drop policy if exists "posts visible to allowed viewers" on public.posts;
create policy "posts visible to allowed viewers"
  on public.posts for select
  using (
    -- Anonymous + public-from-public-account.
    (
      posts.visibility = 'public'
      and exists (
        select 1 from public.profiles ap
        where ap.id = posts.author_id and not ap.is_private
      )
    )
    -- Author themselves.
    or auth.uid() = posts.author_id
    -- Admins (moderation).
    or exists (
      select 1 from public.profiles vp
      where vp.id = auth.uid() and vp.is_admin = true
    )
    -- Authenticated viewer rules.
    or exists (
      select 1 from public.profiles ap
      left join public.profiles vp on vp.id = auth.uid()
      where ap.id = posts.author_id
      and (
        -- Public post on a private account → approved follower OR
        -- close friend OR explicit org member.
        (
          ap.is_private and posts.visibility = 'public' and (
            exists (
              select 1 from public.follows f
              where f.follower_id = auth.uid()
              and f.target_id = ap.id
              and f.status = 'accepted'
            )
            or (vp.id is not null and vp.id = any(ap.close_friend_ids))
            or (vp.id is not null and vp.id = any(ap.org_member_ids))
          )
        )
        -- Mutual-only: both directions of follow must be accepted.
        or (
          posts.visibility = 'mutuals' and vp.id is not null
          and exists (
            select 1 from public.follows f1
            where f1.follower_id = auth.uid() and f1.target_id = ap.id
            and f1.status = 'accepted'
          )
          and exists (
            select 1 from public.follows f2
            where f2.follower_id = ap.id and f2.target_id = auth.uid()
            and f2.status = 'accepted'
          )
        )
        -- Following-only: the author follows the viewer.
        or (
          posts.visibility = 'following' and vp.id is not null
          and exists (
            select 1 from public.follows f
            where f.follower_id = ap.id and f.target_id = auth.uid()
            and f.status = 'accepted'
          )
        )
        -- Close friends only — viewer is on the author's curated list.
        or (
          posts.visibility = 'friends' and vp.id is not null
          and vp.id = any(ap.close_friend_ids)
        )
        -- Same-org only — viewer is on the author's curated org_members.
        or (
          posts.visibility = 'org' and vp.id is not null
          and vp.id = any(ap.org_member_ids)
        )
        -- Legacy "restricted" (Stage 16) — friends OR (curated org member).
        or (
          posts.visibility = 'restricted' and vp.id is not null and (
            vp.id = any(ap.close_friend_ids)
            or vp.id = any(ap.org_member_ids)
          )
        )
      )
    )
  );

-- Remove every historical permissive SELECT alternative before replacement.
drop policy if exists "reposts are public" on public.reposts;
drop policy if exists "users see reposts" on public.reposts;
drop policy if exists "reposts visible only on viewable posts" on public.reposts;
create policy "reposts visible only on viewable posts" on public.reposts for select
 using(exists(select 1 from public.posts p where p.id=reposts.post_id));
drop policy if exists "users see bookmarks" on public.bookmarks;
drop policy if exists "bookmarks visible only on viewable posts" on public.bookmarks;
drop policy if exists "bookmarks visible to owner or post author" on public.bookmarks;
create policy "bookmarks visible to owner or post author" on public.bookmarks for select
 using(auth.uid()=user_id or exists(select 1 from public.posts p where p.id=bookmarks.post_id and p.author_id=auth.uid()));

-- Public interactions require current authority to view their parent. Existing
-- personal bookmarks/references remain retained; their SELECT policies decide reads.
drop policy if exists "comments require readable parent" on public.comments;
create policy "comments require readable parent" on public.comments as restrictive for insert
 with check(exists(select 1 from public.posts p where p.id=comments.post_id));
drop policy if exists "likes require readable parent" on public.likes;
create policy "likes require readable parent" on public.likes as restrictive for insert
 with check(exists(select 1 from public.posts p where p.id=likes.post_id));
drop policy if exists "reposts require readable parent" on public.reposts;
create policy "reposts require readable parent" on public.reposts as restrictive for insert
 with check(exists(select 1 from public.posts p where p.id=reposts.post_id));

-- Ignore optional post context uniformly: blocking an account must not reveal
-- whether an inaccessible/deleted post UUID exists. Account review still works.
create or replace function public.block_user(p_target uuid,p_post uuid default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.require_session_aal();
 if auth.uid() is null or p_target is null or auth.uid()=p_target then raise exception 'Invalid block target'; end if;
 insert into public.user_blocks(blocker_id,blocked_id) values(auth.uid(),p_target) on conflict do nothing;
 if found then
  insert into public.moderation_events(reporter_id,target_id,post_id,kind,detail)
  values(auth.uid(),p_target,null,'block','User blocked this account. Review the account.');
 end if;
end $$;
revoke all on function public.block_user(uuid,uuid) from public,anon;
grant execute on function public.block_user(uuid,uuid) to authenticated;

-- Invoker trigger reads the parent under the caller's RLS, including MFA.
-- Numeric deadlineAt is milliseconds since epoch in both shipped clients.
create or replace function public.validate_poll_vote()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare definition jsonb;
begin
 if tg_op='UPDATE' and (new.post_id is distinct from old.post_id or new.user_id is distinct from old.user_id) then
  raise exception 'Vote identity is immutable' using errcode='42501';
 end if;
 select p.poll into definition from public.posts p where p.id=new.post_id;
 if definition is null or jsonb_typeof(definition->'options') is distinct from 'array'
    or jsonb_typeof(definition->'deadlineAt') is distinct from 'number' then
  raise exception 'Poll unavailable' using errcode='42501';
 end if;
 if new.option_idx < 0 or new.option_idx >= jsonb_array_length(definition->'options')
    or (definition->>'deadlineAt')::numeric <= extract(epoch from clock_timestamp())*1000 then
  raise exception 'Poll closed or invalid option' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function public.validate_poll_vote() from public,anon,authenticated;
drop trigger if exists validate_poll_vote on public.poll_votes;
create trigger validate_poll_vote before insert or update on public.poll_votes
 for each row execute function public.validate_poll_vote();

create or replace function public.ensure_dev_account(new_pass text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_caller uuid := auth.uid();
  v_email  text := 'dev.test.account@spotcode-sns.local';
  v_handle text := 'spotcode_dev';
  v_name   text := 'spotcode dev';
  v_id     uuid;
  v_is_staff boolean;
begin
  perform public.require_session_aal();
  if v_caller is null then
    raise exception 'Sign in first.';
  end if;
  select (coalesce(is_admin, false) or coalesce(is_operator, false))
    into v_is_staff
  from public.profiles
  where id = v_caller;
  if not coalesce(v_is_staff, false) then
    raise exception 'admin / operator のみ実行できます。';
  end if;
  if new_pass is null or length(new_pass) < 8 then
    raise exception 'パスワードは 8 文字以上で設定してください。';
  end if;

  select id into v_id from auth.users where email = v_email;

  if v_id is null then
    insert into auth.users (
      id, instance_id, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      aud, role, raw_user_meta_data, raw_app_meta_data
    )
    values (
      gen_random_uuid(),
      '00000000-0000-0000-0000-000000000000',
      v_email,
      crypt(new_pass, gen_salt('bf')),
      now(), now(), now(),
      'authenticated', 'authenticated',
      jsonb_build_object('handle', v_handle, 'name', v_name),
      '{"provider":"email","providers":["email"]}'::jsonb
    )
    returning id into v_id;
  else
    update auth.users
    set encrypted_password = crypt(new_pass, gen_salt('bf')),
        updated_at         = now()
    where id = v_id;
  end if;

  insert into public.profiles (id, handle, name, role)
  values (v_id, v_handle, v_name, 'general')
  on conflict (id) do update set
    handle = excluded.handle,
    name   = excluded.name,
    role   = excluded.role;
end $$;

create or replace function public.save_github_private_issue_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_user uuid := auth.uid();
  v_secret uuid;
begin
  perform public.require_session_aal();
  if v_user is null then raise exception 'not authenticated'; end if;
  if nullif(trim(p_token), '') is null then raise exception 'empty token'; end if;
  select secret_id into v_secret from public.github_private_issue_grants where user_id = v_user;
  if v_secret is null then
    v_secret := vault.create_secret(p_token, 'spotcode-github-' || v_user::text, 'GitHub private Issue OAuth token');
    insert into public.github_private_issue_grants(user_id, secret_id)
    values (v_user, v_secret)
    on conflict (user_id) do update set secret_id = excluded.secret_id, updated_at = now();
  else
    perform vault.update_secret(v_secret, p_token);
    update public.github_private_issue_grants set updated_at = now() where user_id = v_user;
  end if;
  return true;
end $$;

create or replace function public.delete_github_private_issue_token()
returns boolean
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_secret uuid;
begin
  perform public.require_session_aal();
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.github_private_issue_grants where user_id = auth.uid() returning secret_id into v_secret;
  if v_secret is not null then delete from vault.secrets where id = v_secret; end if;
  return true;
end $$;

create or replace function public.exchange_business_cards(
  p_action text, p_id uuid default null, p_code text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  exchange public.business_card_exchanges%rowtype;
begin
  perform public.require_session_aal();
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

create or replace function public.get_github_private_issue_token()
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets d
  join public.github_private_issue_grants g on g.secret_id = d.id
  where g.user_id = auth.uid() and public.session_has_required_aal()
  limit 1;
$$;

-- Policy helper RPCs also withhold account-specific answers before MFA.
create or replace function public.can_manage_official_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.session_has_required_aal() and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (is_admin = true or is_operator = true)
  );
$$;

create or replace function public.is_verified_github_org_member(p_org bigint)
returns boolean language sql stable security definer set search_path = public,auth as $$
  select public.session_has_required_aal() and exists (
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

create or replace function public.has_blocked(p_target uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.session_has_required_aal() and exists(select 1 from user_blocks where blocker_id=auth.uid() and blocked_id=p_target);
$$;

notify pgrst, 'reload schema';
commit;
