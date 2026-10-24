-- ==================================================================
-- DTD TOOLS — customer capture table (supabase)
-- Run this in the Supabase SQL Editor (or psql) BEFORE going live.
-- Customers who download a tool are stored here as plain text.
-- ==================================================================

create table if not exists public.tool_downloads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  tool text,
  tool_name text,
  kind text default 'free',
  price_usd numeric,
  file text,
  source text default 'web',
  ip text,
  user_agent text,
  created_at timestamptz default now()
);

alter table public.tool_downloads enable row level security;

-- The service-role key bypasses RLS anyway; this keeps admin app inserts
-- working too, and lets logged-in admins view the customer list.
create policy "tool_downloads public insert"
  on public.tool_downloads for insert
  with check (true);

create policy "tool_downloads admin read"
  on public.tool_downloads for select
  to authenticated
  using (true);

create index if not exists tool_downloads_created_at_idx
  on public.tool_downloads (created_at desc);