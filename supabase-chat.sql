-- DTD Store community chat (Twitter-style feed)
-- Run in Supabase SQL Editor once.

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  telegram_username text not null,
  display_name text not null default '',
  body text not null check (char_length(body) between 1 and 500),
  likes_count integer not null default 0 check (likes_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_created_at_idx
  on public.chat_messages (created_at desc);

create index if not exists chat_messages_user_idx
  on public.chat_messages (telegram_user_id, created_at desc);

create table if not exists public.chat_likes (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  telegram_user_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (message_id, telegram_user_id)
);

create table if not exists public.chat_link_codes (
  code text primary key,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'expired')),
  telegram_user_id bigint,
  telegram_username text,
  display_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz
);

create index if not exists chat_link_codes_expires_idx
  on public.chat_link_codes (expires_at);

alter table public.chat_messages enable row level security;
alter table public.chat_likes enable row level security;
alter table public.chat_link_codes enable row level security;

-- Public read of feed (anon); writes go through Workers with service role.
drop policy if exists "Anyone can read chat messages" on public.chat_messages;
create policy "Anyone can read chat messages"
on public.chat_messages for select
using (true);

drop policy if exists "Anyone can read chat likes" on public.chat_likes;
create policy "Anyone can read chat likes"
on public.chat_likes for select
using (true);
