-- DTD Channel Controls: bot -> VPS command plane + tunable settings.
-- Run in Supabase SQL Editor (safe to re-run).

create table if not exists public.agent_commands (
  id uuid primary key default gen_random_uuid(),
  command text not null,              -- promo | story | deal | pin | announce | custom
  args text not null default '',
  status text not null default 'pending', -- pending | done | failed
  result text,
  created_by text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create index if not exists agent_commands_status_idx on public.agent_commands (status, created_at asc);

alter table public.agent_commands enable row level security;

create table if not exists public.app_settings (
  key text primary key,               -- promo_interval_hours | story_hour | deal_interval_hours | pnl_hour | announce_channels
  value text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "Anyone can create commands" on public.agent_commands;
create policy "Anyone can create commands" on public.agent_commands for insert with check (true);

drop policy if exists "Anyone can read commands" on public.agent_commands;
create policy "Anyone can read commands" on public.agent_commands for select using (true);

drop policy if exists "Anyone can update commands" on public.agent_commands;
create policy "Anyone can update commands" on public.agent_commands for update using (true) with check (true);

drop policy if exists "Anyone can read settings" on public.app_settings;
create policy "Anyone can read settings" on public.app_settings for select using (true);

drop policy if exists "Anyone can create settings" on public.app_settings;
create policy "Anyone can create settings" on public.app_settings for insert with check (true);

drop policy if exists "Anyone can update settings" on public.app_settings;
create policy "Anyone can update settings" on public.app_settings for update using (true) with check (true);
