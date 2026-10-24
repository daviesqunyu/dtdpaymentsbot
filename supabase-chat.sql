-- DTD Store community chat
-- Run in Supabase SQL Editor (safe to re-run).

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  telegram_username text not null,
  display_name text not null default '',
  body text not null default '' check (char_length(body) <= 12000),
  media_url text,
  media_type text check (media_type is null or media_type in ('image', 'video')),
  likes_count integer not null default 0 check (likes_count >= 0),
  comments_count integer not null default 0 check (comments_count >= 0),
  created_at timestamptz not null default now()
);

alter table public.chat_messages add column if not exists media_url text;
alter table public.chat_messages add column if not exists media_type text;
alter table public.chat_messages add column if not exists comments_count integer not null default 0;
alter table public.chat_messages add column if not exists is_premium boolean not null default false;
alter table public.chat_messages add column if not exists source text not null default 'user';
alter table public.chat_messages add column if not exists tg_message_id bigint;
alter table public.chat_messages add column if not exists tg_chat_id bigint;

create unique index if not exists chat_messages_tg_uniq
  on public.chat_messages (tg_chat_id, tg_message_id)
  where tg_message_id is not null;

alter table public.chat_messages drop constraint if exists chat_messages_body_check;
alter table public.chat_messages
  add constraint chat_messages_body_check check (char_length(body) <= 12000);

create index if not exists chat_messages_created_at_idx
  on public.chat_messages (created_at desc);

create index if not exists chat_messages_user_idx
  on public.chat_messages (telegram_user_id, created_at desc);

create index if not exists chat_messages_username_idx
  on public.chat_messages (lower(telegram_username), created_at desc);

create table if not exists public.chat_likes (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  telegram_user_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (message_id, telegram_user_id)
);

create table if not exists public.chat_comments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  telegram_user_id bigint not null,
  telegram_username text not null,
  display_name text not null default '',
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists chat_comments_message_idx
  on public.chat_comments (message_id, created_at asc);

create index if not exists chat_comments_user_idx
  on public.chat_comments (telegram_user_id, created_at desc);

create table if not exists public.chat_link_codes (
  code text primary key,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'expired')),
  telegram_user_id bigint,
  telegram_username text,
  display_name text,
  is_premium boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz
);

create index if not exists chat_link_codes_expires_idx
  on public.chat_link_codes (expires_at);

-- Registered chat users (avatars, display names)
create table if not exists public.chat_users (
  telegram_user_id bigint primary key,
  telegram_username text not null default '',
  display_name text not null default '',
  photo_file_id text,
  photo_path text,
  is_premium boolean not null default false,
  last_seen timestamptz not null default now()
);

-- Web session tokens for the store chat (opaque bearer tokens)
create table if not exists public.chat_sessions (
  token text primary key,
  telegram_user_id bigint not null,
  telegram_username text not null default '',
  display_name text not null default '',
  photo_file_id text,
  photo_path text,
  is_premium boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Phone call / callback requests from the chat page
create table if not exists public.call_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  phone text not null default '',
  telegram text not null default '',
  topic text not null default '',
  message text not null default '',
  preferred_time text not null default '',
  telegram_user_id bigint,
  telegram_username text not null default '',
  status text not null default 'new' check (status in ('new', 'contacted', 'done', 'skipped')),
  created_at timestamptz not null default now()
);

create index if not exists call_requests_created_idx
  on public.call_requests (created_at desc);

alter table public.chat_users enable row level security;
alter table public.chat_sessions enable row level security;

alter table public.chat_messages enable row level security;
alter table public.chat_likes enable row level security;
alter table public.chat_comments enable row level security;
alter table public.chat_link_codes enable row level security;
alter table public.call_requests enable row level security;

drop policy if exists "Anyone can read chat messages" on public.chat_messages;
create policy "Anyone can read chat messages"
on public.chat_messages for select
using (true);

drop policy if exists "Anyone can read chat likes" on public.chat_likes;
create policy "Anyone can read chat likes"
on public.chat_likes for select
using (true);

drop policy if exists "Anyone can read chat comments" on public.chat_comments;
create policy "Anyone can read chat comments"
on public.chat_comments for select
using (true);

drop policy if exists "Anyone can read chat users" on public.chat_users;
create policy "Anyone can read chat users"
on public.chat_users for select
using (true);

drop policy if exists "Anyone can read call requests" on public.call_requests;
create policy "Anyone can read call requests"
on public.call_requests for select
using (true);

drop policy if exists "Anyone can insert call requests" on public.call_requests;
create policy "Anyone can insert call requests"
on public.call_requests for insert
with check (true);
