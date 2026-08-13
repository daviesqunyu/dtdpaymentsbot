-- DTD Store full schema fix
-- Project: iqoffsnkptulvuqmdcce
-- Adds missing columns, tables, RPC, and payment methods.

create extension if not exists pgcrypto;

-- ---------- ORDERS: missing columns ----------
alter table public.orders
  add column if not exists customer_email text,
  add column if not exists payment_reference text,
  add column if not exists product_account text;

-- Expand allowed payment methods.
-- IMPORTANT: drop check BEFORE any update to Paystack (old check rejects Paystack).
alter table public.orders drop constraint if exists orders_payment_method_check;

update public.orders
set payment_method = 'Paystack'
where payment_method is not null
  and payment_method not in (
    'Crypto',
    'Paystack',
    'Card',
    'Bank',
    'USSD',
    'Mobile Money'
  );

alter table public.orders
  add constraint orders_payment_method_check
  check (
    payment_method is null
    or payment_method in (
      'Crypto',
      'Paystack',
      'Card',
      'Bank',
      'USSD',
      'Mobile Money'
    )
  );

-- ---------- RLS: allow inserts (service role also bypasses) ----------
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Anyone can create orders" on public.orders;
create policy "Anyone can create orders"
on public.orders for insert
with check (true);

drop policy if exists "Anyone can create order items" on public.order_items;
create policy "Anyone can create order items"
on public.order_items for insert
with check (true);

-- ---------- RPC: create_store_order ----------
create or replace function public.create_store_order(
  p_customer_name text,
  p_customer_phone text,
  p_telegram_username text,
  p_delivery_details text,
  p_payment_method text,
  p_total_usd numeric,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_product_id uuid;
begin
  insert into public.orders (
    customer_name,
    customer_phone,
    customer_email,
    telegram_username,
    delivery_details,
    payment_method,
    payment_status,
    total_usd
  )
  values (
    p_customer_name,
    p_customer_phone,
    p_customer_phone,
    p_telegram_username,
    p_delivery_details,
    p_payment_method,
    'pending',
    p_total_usd
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    begin
      v_product_id := nullif(v_item->>'product_id', '')::uuid;
    exception when others then
      v_product_id := null;
    end;

    insert into public.order_items (
      order_id,
      product_id,
      product_name,
      quantity,
      unit_price_usd
    )
    values (
      v_order_id,
      v_product_id,
      coalesce(v_item->>'product_name', 'Item'),
      greatest(coalesce((v_item->>'quantity')::integer, 1), 1),
      coalesce((v_item->>'unit_price_usd')::numeric, 0)
    );
  end loop;

  return v_order_id;
end;
$$;

grant execute on function public.create_store_order(
  text, text, text, text, text, numeric, jsonb
) to anon, authenticated, service_role;

-- ---------- ANALYTICS ----------
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

drop policy if exists "Anyone can insert analytics" on public.analytics_events;
create policy "Anyone can insert analytics"
on public.analytics_events for insert
with check (true);

-- ---------- BOT CHECKOUT SESSIONS ----------
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

drop policy if exists "Service can manage bot sessions" on public.bot_checkout_sessions;
-- No public policies: only service_role (bypasses RLS) writes sessions.
