-- Bot in-Telegram checkout sessions (email / BTC tx follow-ups)
-- Run in Supabase SQL Editor.

create table if not exists public.bot_checkout_sessions (
  telegram_user_id text primary key,
  product_id text,
  product_name text,
  price_usd numeric(10, 2),
  method text,
  step text,
  email text,
  order_id text,
  pay_key text,
  updated_at timestamptz not null default now()
);

alter table public.bot_checkout_sessions
  add column if not exists pay_key text;

alter table public.bot_checkout_sessions enable row level security;

-- Service role writes from the bot; no public policies needed.
