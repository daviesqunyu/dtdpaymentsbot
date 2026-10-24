-- DTD Store bot events / traffic log + admin monitoring
-- Run this in the Supabase SQL Editor (safe to re-run).
-- Creates the table the bot uses for /stats, /traffic, /users, /logs, /activity.

create table if not exists public.bot_events (
  id uuid primary key default gen_random_uuid(),
  chat_id text,
  user_id text,
  username text,
  first_name text,
  event_type text not null,
  command text,
  payload text,
  path text,
  source text not null default 'bot',
  created_at timestamptz not null default now()
);

create index if not exists bot_events_created_at_idx
  on public.bot_events (created_at desc);
create index if not exists bot_events_user_idx
  on public.bot_events (user_id);
create index if not exists bot_events_type_idx
  on public.bot_events (event_type);

alter table public.bot_events enable row level security;

-- Only the bot (service role) writes and reads these logs; the service role
-- bypasses RLS, so no extra policies are required.
