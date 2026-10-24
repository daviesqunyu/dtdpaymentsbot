-- DTD PREMIUM membership (20 Stars payment) — run in Supabase SQL Editor.

create table if not exists public.premium_members (
  telegram_user_id text primary key,
  telegram_username text,
  first_name text,
  last_name text,
  paid_at timestamptz not null default now(),
  stars_amount numeric not null default 0,
  expires_at timestamptz,
  status text not null default 'active',  -- active | expired
  created_at timestamptz not null default now()
);

create index if not exists premium_members_expires_idx on public.premium_members (expires_at asc);

alter table public.premium_members enable row level security;

drop policy if exists "open premium_members" on public.premium_members;
create policy "open premium_members" on public.premium_members for all using (true) with check (true);
