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
    check (visibility in ('public', 'restricted'));

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
  check (visibility in ('public', 'restricted', 'mutuals', 'following', 'friends', 'org'));

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
-- Stage 23 — official account + operator role
-- ===================================================================
-- Goal:
--   • A shared "official" profile (@spotcode_official) that the admin
--     and operators can post AS — like a brand account on Twitter,
--     where multiple staffers post under the same identity without
--     sharing the underlying credentials.
--   • Server-side knowledge of who's an operator so RLS can decide
--     whether a "post as official" request is allowed.
--
-- The auth.users row for @spotcode_official is created via the normal
-- /signup UI flow (with a dev+official@... email) — Supabase doesn't
-- expose user-creation to the anon key, so it has to come through
-- signup. After signup, run the `update … set is_official = true`
-- statement below to mark that profile as THE official account.
-- (Same one-time bootstrap pattern as is_admin in Stage 15.)
--
-- @spotcode_dev is just a regular test profile — no schema flag.

-- 1. Operator flag, mirroring the client-side OPERATOR_HANDLES list
--    in src/js/dev-mode.js. Admins are implicitly operators (the
--    RLS policies below check either flag).
alter table public.profiles
  add column if not exists is_operator boolean default false;
update public.profiles
  set is_operator = true
  where handle in ('hrmcngs', 'aya526dev');

-- 2. Official-account flag. Partial unique index enforces "at most
--    one official account at a time" — flipping the flag on a second
--    profile fails loudly instead of silently producing two officials.
alter table public.profiles
  add column if not exists is_official boolean default false;
drop index if exists profiles_one_official_uniq;
create unique index profiles_one_official_uniq
  on public.profiles ((true)) where is_official = true;

-- 3. Posts INSERT: allow author_id = auth.uid() (the existing rule)
--    OR author_id = (the official account's id) when the requester
--    is admin or operator. This is what lets the Composer's
--    "Post as @spotcode_official" toggle work.
drop policy if exists "authors can insert their posts" on public.posts;
drop policy if exists "authors or staff-as-official can insert posts" on public.posts;
create policy "authors or staff-as-official can insert posts"
  on public.posts for insert with check (
    auth.uid() = author_id
    or (
      exists (select 1 from public.profiles where id = author_id   and is_official = true)
      and
      exists (select 1 from public.profiles where id = auth.uid()  and (is_admin = true or is_operator = true))
    )
  );

-- 4. Posts UPDATE / DELETE on official posts: same staff-only rule.
--    Admin already had a global delete via Stage 15; we add the
--    operator-side coverage here so an operator can take down (or
--    edit a typo on) an official post without escalating to admin.
drop policy if exists "authors can update their posts" on public.posts;
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

drop policy if exists "authors can delete their posts" on public.posts;
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

-- 5. One-shot bootstrap — uncomment and run AFTER signing up
--    @spotcode_official via the /signup UI (with the dev+official@…
--    email). Marks that profile as the unique official account.
--
-- update public.profiles set is_official = true where handle = 'spotcode_official';

-- ===================================================================
-- Stage 24 — revert Stage 23 (official-account flag + post-as plumbing)
-- ===================================================================
-- Stage 23 added an `is_official` flag + a Composer "Post as
-- @spotcode_official" toggle so admins/operators could publish under
-- the brand account without sharing credentials. We've dropped the
-- toggle UI: the brand account is now just a normal Supabase user
-- (with shared password) that staff log into via the existing
-- account-switcher. None of the schema plumbing is needed any more.
--
-- This stage restores the simple "author = auth.uid()" posts policies
-- and drops the columns + partial unique index added by Stage 23.
-- Safe to run on a DB where Stage 23 was never applied (the DROP …
-- IF EXISTS calls are idempotent).

drop policy if exists "authors or staff-as-official can insert posts" on public.posts;
drop policy if exists "authors or staff can insert posts"             on public.posts;
drop policy if exists "authors can insert their posts"                on public.posts;
create policy "authors can insert their posts"
  on public.posts for insert with check (auth.uid() = author_id);

drop policy if exists "authors or staff can update posts" on public.posts;
drop policy if exists "authors can update their posts"   on public.posts;
create policy "authors can update their posts"
  on public.posts for update using (auth.uid() = author_id);

drop policy if exists "authors or staff can delete posts" on public.posts;
drop policy if exists "authors can delete their posts"   on public.posts;
create policy "authors can delete their posts"
  on public.posts for delete using (auth.uid() = author_id);
-- (Stage 15's "admins can delete any post" stays — moderators still
-- need the global delete hammer for spam / harassment cleanup.)

drop index if exists profiles_one_official_uniq;
alter table public.profiles drop column if exists is_official;
alter table public.profiles drop column if exists is_operator;

-- ===================================================================
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
-- Stage 27 — bootstrap the @spotcode_dev QA test account
-- ===================================================================
-- Same shape as Stage 25's official-account bootstrap, just for the
-- QA test login. Unlike the brand account this one IS meant to be
-- logged into directly (admin uses it to QA the regular-user
-- surface), so pick a real password before running the block — the
-- placeholder `CHANGE_ME_BEFORE_RUNNING` is rejected on purpose so
-- you can't accidentally provision a weak account.
--
-- Idempotent: re-running on a DB that already has the row only
-- repairs handle / name / role fields, never touches the password.

do $$
declare
  v_id      uuid;
  v_pass    text := 'CHANGE_ME_BEFORE_RUNNING';
  v_email   text := 'dev.test.account@spotcode-sns.local';
  v_handle  text := 'spotcode_dev';
  v_name    text := 'spotcode dev';
begin
  if v_pass = 'CHANGE_ME_BEFORE_RUNNING' then
    raise exception 'Set v_pass to your chosen QA password before running Stage 27 (then save it in your password manager).';
  end if;

  select id into v_id from auth.users where email = v_email;
  if v_id is null then
    -- auth.users.id has no DEFAULT in some Supabase project versions,
    -- so generate it explicitly. Same pattern as Stage 25.
    insert into auth.users (
      id, instance_id, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      aud, role,
      raw_user_meta_data, raw_app_meta_data
    )
    values (
      gen_random_uuid(),
      '00000000-0000-0000-0000-000000000000',
      v_email,
      crypt(v_pass, gen_salt('bf')),
      now(), now(), now(),
      'authenticated', 'authenticated',
      jsonb_build_object('handle', v_handle, 'name', v_name),
      '{"provider":"email","providers":["email"]}'::jsonb
    )
    returning id into v_id;
    -- The handle_new_user trigger (Stage 2/3) already created the
    -- profiles row using the metadata above.
  end if;

  -- Heal the profile row in case the trigger ran with empty metadata
  -- on older DBs, or someone manually edited it.
  insert into public.profiles (id, handle, name, role)
  values (v_id, v_handle, v_name, 'general')
  on conflict (id) do update set
    handle = excluded.handle,
    name   = excluded.name,
    role   = excluded.role;
end $$;
-- (No is_official / is_admin / is_operator flags — @spotcode_dev is
-- explicitly a plain user; the admin uses it to QA what a regular
-- viewer sees.)

-- ===================================================================
-- Stage 28 — one-line dev-password helper for the SQL Editor
-- ===================================================================
-- Stage 27 requires editing a `v_pass :=` line inside its DO block
-- before pasting — easy to mess up, can't be aliased in a snippet.
-- This SECURITY DEFINER function takes the password as an argument
-- so the SQL Editor call is a single line you can keep in your
-- password manager's "Notes" field:
--
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
    raise exception 'Run Stage 27 first — it provisions the @spotcode_dev auth.users row.';
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
create policy "users read own issue preferences" on public.issue_display_preferences
  for select using (auth.uid() = user_id);
create policy "users insert own issue preferences" on public.issue_display_preferences
  for insert with check (auth.uid() = user_id);
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
begin;

alter table public.posts drop constraint if exists posts_visibility_check;
alter table public.posts add constraint posts_visibility_check
  check (visibility in ('public', 'restricted', 'mutuals', 'following', 'friends', 'org', 'only_me'));

drop policy if exists "only-me posts belong to their author" on public.posts;
create policy "only-me posts belong to their author"
  on public.posts as restrictive for all
  using (visibility is distinct from 'only_me' or auth.uid() = author_id)
  with check (visibility is distinct from 'only_me' or auth.uid() = author_id);

commit;

-- Stage 36 — Admin read access to only-me posts in developer mode.
begin;

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

commit;
