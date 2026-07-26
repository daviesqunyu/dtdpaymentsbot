-- DTD Store analytics events
-- Run this in the Supabase SQL Editor to enable storefront usage tracking
-- and the bot /stats command.

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  client_id text,
  session_id text,
  event_type text not null,
  path text,
  referrer text,
  country text,
  user_agent text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at desc);
create index if not exists analytics_events_type_idx
  on public.analytics_events (event_type);
create index if not exists analytics_events_client_idx
  on public.analytics_events (client_id);

alter table public.analytics_events enable row level security;

-- Anonymous storefront visitors may insert their own events.
drop policy if exists "Anyone can insert analytics" on public.analytics_events;
create policy "Anyone can insert analytics"
on public.analytics_events for insert
with check (true);

-- Reads are performed with the service role (bot /stats), so no public
-- select policy is granted here.
