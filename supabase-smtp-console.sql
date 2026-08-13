-- SMTP / SMS console access + job logging
-- Apply in Supabase SQL editor.

create table if not exists public.smtp_access (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  email text not null,
  unlocked_at timestamptz not null default now(),
  unique (order_id, email)
);

create index if not exists smtp_access_email_idx on public.smtp_access (lower(email));

create table if not exists public.smtp_jobs (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('email', 'sms')),
  actor_email text,
  order_id uuid references public.orders(id) on delete set null,
  subject text,
  body_preview text,
  recipient_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (
    status in ('queued', 'sending', 'sent', 'partial', 'failed')
  ),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists smtp_jobs_created_idx on public.smtp_jobs (created_at desc);

create table if not exists public.smtp_job_recipients (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.smtp_jobs(id) on delete cascade,
  address text not null,
  status text not null default 'queued' check (
    status in ('queued', 'sent', 'failed', 'skipped')
  ),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists smtp_job_recipients_job_idx on public.smtp_job_recipients (job_id);

-- Seed SMTP catalog product (idempotent by name)
insert into public.products (name, description, price_usd, color, active)
select
  'SMTP',
  'DTD SMTP + SMS console access. Send email from contact@dvtechnologies.xyz via DV Tech mail, and SMS via your Android SIM gateway. Unlock with your paid Order ID + checkout email.',
  49.00,
  '#0f766e',
  true
where not exists (
  select 1 from public.products where lower(name) = 'smtp'
);
