-- Secretary mode + Stars invoices + referrals
-- Run in Supabase SQL Editor (safe to re-run).

create table if not exists public.stars_invoices (
  id text primary key,
  kind text,
  status text not null default 'pending',
  telegram_user_id text,
  customer_name text,
  customer_email text,
  telegram_username text,
  product_id text,
  product_name text,
  items_json jsonb default '[]'::jsonb,
  total_usd numeric(12, 2),
  stars_amount integer,
  chat_id text,
  order_id text,
  charge_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stars_invoices_status_idx on public.stars_invoices (status);
create index if not exists stars_invoices_user_idx on public.stars_invoices (telegram_user_id);

alter table public.stars_invoices enable row level security;

create table if not exists public.bot_reminders (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  created_by text,
  message text not null,
  meta text,
  due_at timestamptz not null,
  status text not null default 'pending',
  fired_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists bot_reminders_due_idx
  on public.bot_reminders (status, due_at);

alter table public.bot_reminders enable row level security;

create table if not exists public.bot_secretary_notes (
  id uuid primary key default gen_random_uuid(),
  created_by text,
  note text not null,
  created_at timestamptz not null default now()
);

alter table public.bot_secretary_notes enable row level security;

create table if not exists public.bot_referrals (
  referred_user_id text primary key,
  referrer_user_id text not null,
  referred_username text,
  status text not null default 'joined',
  created_at timestamptz not null default now(),
  converted_at timestamptz
);

create index if not exists bot_referrals_referrer_idx
  on public.bot_referrals (referrer_user_id);

alter table public.bot_referrals enable row level security;
