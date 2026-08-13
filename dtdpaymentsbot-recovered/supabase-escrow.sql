-- Escrow Bot schema for DTD Store
-- Apply in Supabase SQL editor. Creates escrow_sessions, escrow_transactions,
-- escrow_messages and RLS policies (admin-only create/release; parties can read).

create extension if not exists pgcrypto;

-- Escrow sessions (like Binance P2P)
create table if not exists public.escrow_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,               -- short human code e.g. ESR-XXXXXX
  title text not null,
  description text,
  amount_usd numeric(12,2) not null check (amount_usd > 0),
  currency text not null default 'USDT',
  asset text not null default 'USDT',
  network text not null default 'TRC20',
  buyer_telegram text not null,
  seller_telegram text not null,
  buyer_payout_address text,               -- buyer's USDT address (refund)
  seller_payout_address text,              -- seller's address to release to
  deposit_address text not null,           -- admin-controlled deposit wallet
  deposit_tx_hash text,
  escrow_fee numeric(6,4) not null default 0.00,
  status text not null default 'open' check (
    status in ('open', 'active', 'funded', 'disputed', 'released', 'cancelled')
  ),
  proof_note text,                         -- admin note re: proof / dispute
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  funded_at timestamptz,
  released_at timestamptz
);

create index if not exists escrow_sessions_code_idx on public.escrow_sessions (code);
create index if not exists escrow_sessions_buyer_idx on public.escrow_sessions (buyer_telegram);
create index if not exists escrow_sessions_seller_idx on public.escrow_sessions (seller_telegram);

-- Timeline / transaction log
create table if not exists public.escrow_transactions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.escrow_sessions(id) on delete cascade,
  kind text not null check (
    kind in ('created', 'funded', 'disputed', 'released', 'cancelled', 'note')
  ),
  actor text not null default 'admin',     -- admin / buyer / seller / system
  amount_usd numeric(12,2),
  tx_hash text,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists escrow_transactions_session_idx on public.escrow_transactions (session_id);

-- Message thread between parties + admin
create table if not exists public.escrow_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.escrow_sessions(id) on delete cascade,
  author text not null,                    -- @username or 'admin'
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists escrow_messages_session_idx on public.escrow_messages (session_id);

-- RLS
alter table public.escrow_sessions enable row level security;
alter table public.escrow_transactions enable row level security;
alter table public.escrow_messages enable row level security;

drop policy if exists "Admins all escrow" on public.escrow_sessions;
drop policy if exists "Party read escrow" on public.escrow_sessions;
drop policy if exists "Admins all escrow transactions" on public.escrow_transactions;
drop policy if exists "Party read escrow transactions" on public.escrow_transactions;
drop policy if exists "Admins all escrow messages" on public.escrow_messages;
drop policy if exists "Party read escrow messages" on public.escrow_messages;

-- Admin (authenticated user in admin_users) can do everything
create policy "Admins all escrow"
on public.escrow_sessions for all
to authenticated
using (
  exists (select 1 from public.admin_users where admin_users.user_id = auth.uid())
)
with check (
  exists (select 1 from public.admin_users where admin_users.user_id = auth.uid())
);

-- Parties can read sessions by code link; sensitive release stays admin-only.
-- We keep this permissive for read so the public session view works without auth,
-- while all writes (create / release / cancel) require admin via the policy above.
create policy "Party read escrow"
on public.escrow_sessions for select
using (true);

create policy "Admins all escrow transactions"
on public.escrow_transactions for all
to authenticated
using (
  exists (select 1 from public.admin_users where admin_users.user_id = auth.uid())
)
with check (
  exists (select 1 from public.admin_users where admin_users.user_id = auth.uid())
);

create policy "Party read escrow transactions"
on public.escrow_transactions for select
using (true);

create policy "Admins all escrow messages"
on public.escrow_messages for all
to authenticated
using (
  exists (select 1 from public.admin_users where admin_users.user_id = auth.uid())
)
with check (
  exists (select 1 from public.admin_users where admin_users.user_id = auth.uid())
);

create policy "Party read escrow messages"
on public.escrow_messages for select
using (true);

-- Seed an example admin (the same admin user id as the store schema)
insert into public.admin_users (user_id)
values ('1bff7596-c62b-4702-a5fb-ab86b9e71882')
on conflict (user_id) do nothing;
