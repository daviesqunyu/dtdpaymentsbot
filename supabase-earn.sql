-- DTD Earning engine: crypto payments (TON / USDT-TRC20), referral credits, earnings ledger.
-- Run in Supabase SQL Editor (safe to re-run). Requires supabase-secretary-earn.sql (stars_invoices, bot_referrals).

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id text,
  kind text not null default 'product',          -- product | tip | donation
  currency text not null default 'USDT',          -- TON | USDT | BTC | XTR
  amount numeric(20, 8),
  amount_usd numeric(12, 2),
  address text,
  tx_hash text,
  network text,
  telegram_user_id text,
  telegram_username text,
  status text not null default 'pending',         -- pending | confirmed | failed
  confirmations integer not null default 0,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_status_idx on public.payments (status, currency);
create index if not exists payments_tx_idx on public.payments (tx_hash);
create index if not exists payments_user_idx on public.payments (telegram_user_id);

alter table public.payments enable row level security;

create table if not exists public.bot_credits (
  user_id text primary key,
  balance_usd numeric(12, 2) not null default 0,
  lifetime_earned_usd numeric(12, 2) not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.bot_credits enable row level security;

create table if not exists public.earn_events (
  id bigint generated always as identity primary key,
  user_id text not null,
  kind text not null,                              -- referral_conversion | stars_tip | order_commission
  amount_usd numeric(12, 2) not null default 0,
  stars_amount integer not null default 0,
  currency text not null default 'USD',
  note text,
  created_at timestamptz not null default now()
);

create index if not exists earn_events_user_idx on public.earn_events (user_id);

alter table public.earn_events enable row level security;

drop policy if exists "Anyone can create payments" on public.payments;
create policy "Anyone can create payments"
  on public.payments for insert with check (true);

drop policy if exists "Anyone can read payments" on public.payments;
create policy "Anyone can read payments"
  on public.payments for select using (true);

drop policy if exists "Anyone can create earn events" on public.earn_events;
create policy "Anyone can create earn events"
  on public.earn_events for insert with check (true);

drop policy if exists "Anyone can read earn events" on public.earn_events;
create policy "Anyone can read earn events"
  on public.earn_events for select using (true);

drop policy if exists "Anyone can read credits" on public.bot_credits;
create policy "Anyone can read credits"
  on public.bot_credits for select using (true);

drop policy if exists "Anyone can create credits" on public.bot_credits;
create policy "Anyone can create credits"
  on public.bot_credits for insert with check (true);
