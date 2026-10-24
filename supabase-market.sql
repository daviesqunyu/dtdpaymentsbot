-- DTD Market Brain: flash deals, abandoned-checkout recovery, referral surges,
-- social-proof posts, bundles + the market activity log.
-- Run in Supabase SQL Editor (safe to re-run).

create table if not exists public.flash_deals (
  id uuid primary key default gen_random_uuid(),
  product_id text,
  product_name text,
  image_url text,
  original_price_usd numeric,
  flash_price_usd numeric,
  discount_pct numeric,
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  last_chance_at timestamptz,
  status text not null default 'active', -- active | last_chance | expired | cancelled
  last_chance_posted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists flash_deals_status_idx on public.flash_deals (status, expires_at asc);

create table if not exists public.bundles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_ids text[] not null default '{}',
  discount_pct numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.abandoned_nudges (
  id uuid primary key default gen_random_uuid(),
  source text not null,                -- stars | crypto | paystack
  source_id text,
  telegram_user_id text,
  telegram_username text,
  amount_usd numeric,
  product_name text,
  nudge_sent_at timestamptz,
  status text not null default 'pending', -- pending | sent | paid | cancelled
  created_at timestamptz not null default now()
);

create index if not exists abandoned_nudges_status_idx on public.abandoned_nudges (status, created_at asc);

create table if not exists public.social_proof_posts (
  id uuid primary key default gen_random_uuid(),
  payment_id text,
  kind text not null default 'order',   -- order | refer | tip | review
  buyer_name text,
  buyer_username text,
  product_name text,
  amount_usd numeric,
  channel text,
  message text,
  posted_at timestamptz,
  status text not null default 'pending', -- pending | posted | skipped
  created_at timestamptz not null default now()
);

create index if not exists social_proof_status_idx on public.social_proof_posts (status, created_at asc);

create table if not exists public.market_log (
  id bigint generated always as identity primary key,
  action text not null,                -- snapshot | flash_started | flash_expired | nudge_sent | surge_started | proof_posted | ...
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists market_log_created_idx on public.market_log (created_at desc);

-- Channel visitor management: every member seen in the channels + welcome / activation nudges.
create table if not exists public.channel_members (
  telegram_user_id text primary key,
  telegram_username text,
  first_name text,
  last_name text,
  channel text,
  first_seen_at timestamptz not null default now(),
  welcomed_at timestamptz,
  last_activation_at timestamptz,
  order_count integer not null default 0,
  status text not null default 'new'    -- new | welcomed | activated | opted_out
);

create index if not exists channel_members_act_idx on public.channel_members (status, last_activation_at asc);

alter table public.flash_deals enable row level security;
alter table public.bundles enable row level security;
alter table public.abandoned_nudges enable row level security;
alter table public.social_proof_posts enable row level security;
alter table public.market_log enable row level security;
alter table public.channel_members enable row level security;

drop policy if exists "open flash_deals" on public.flash_deals;
create policy "open flash_deals" on public.flash_deals for all using (true) with check (true);

drop policy if exists "open bundles" on public.bundles;
create policy "open bundles" on public.bundles for all using (true) with check (true);

drop policy if exists "open abandoned_nudges" on public.abandoned_nudges;
create policy "open abandoned_nudges" on public.abandoned_nudges for all using (true) with check (true);

drop policy if exists "open social_proof_posts" on public.social_proof_posts;
create policy "open social_proof_posts" on public.social_proof_posts for all using (true) with check (true);

drop policy if exists "open market_log" on public.market_log;
create policy "open market_log" on public.market_log for all using (true) with check (true);

drop policy if exists "open channel_members" on public.channel_members;
create policy "open channel_members" on public.channel_members for all using (true) with check (true);

-- Default market settings (idempotent)
insert into public.app_settings (key, value) values
  ('flash_discount_pct', '35'),
  ('flash_hours', '4'),
  ('flash_gap_hours', '3'),
  ('flash_min_interval_hours', '6'),
  ('abandon_after_minutes', '10'),
  ('referral_multiplier', '1'),
  ('referral_surge_hours', '0'),
  ('referral_surge_started_at', ''),
  ('social_proof_enabled', '1'),
  ('proof_min_usd', '0'),
  ('welcome_enabled', '1'),
  ('welcome_gap_minutes', '3'),
  ('welcome_max_day', '100'),
  ('activation_enabled', '1'),
  ('activation_hours', '48'),
  ('activation_per_cycle', '8')
on conflict (key) do nothing;
