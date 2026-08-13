create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  price_usd numeric(10, 2) not null check (price_usd > 0),
  color text not null default '#0f766e',
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_phone text,
  telegram_username text,
  delivery_details text not null,
  customer_email text,
  payment_reference text,
  product_account text,
  payment_method text not null check (
    payment_method in ('Crypto', 'Paystack')
  ),
  payment_status text not null default 'pending' check (
    payment_status in ('pending', 'paid', 'failed', 'refunded')
  ),
  order_status text not null default 'new' check (
    order_status in ('new', 'confirmed', 'delivered', 'cancelled')
  ),
  total_usd numeric(10, 2) not null check (total_usd >= 0),
  created_at timestamptz not null default now()
);

alter table public.orders
  alter column customer_phone drop not null;

alter table public.orders
  add column if not exists customer_email text,
  add column if not exists payment_reference text,
  add column if not exists product_account text;

alter table public.orders
  drop constraint if exists orders_payment_method_check;

alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method in ('Crypto', 'Paystack'));

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_usd numeric(10, 2) not null check (unit_price_usd >= 0)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;

create trigger products_set_updated_at
before update on public.products
for each row
execute function public.set_updated_at();

alter table public.admin_users enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Admins can read admin list" on public.admin_users;
drop policy if exists "Public can read active products" on public.products;
drop policy if exists "Admins can manage products" on public.products;
drop policy if exists "Authenticated admins manage products" on public.products;
drop policy if exists "Anyone can create orders" on public.orders;
drop policy if exists "Anyone can create order items" on public.order_items;
drop policy if exists "Admins can read orders" on public.orders;
drop policy if exists "Admins can update orders" on public.orders;
drop policy if exists "Authenticated admins read orders" on public.orders;
drop policy if exists "Admins can read order items" on public.order_items;
drop policy if exists "Authenticated admins read order items" on public.order_items;

create policy "Admins can read admin list"
on public.admin_users for select
to authenticated
using (user_id = auth.uid());

create policy "Public can read active products"
on public.products for select
using (active = true);

create policy "Admins can manage products"
on public.products for all
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = auth.uid()
  )
);

create policy "Anyone can create orders"
on public.orders for insert
with check (true);

create policy "Anyone can create order items"
on public.order_items for insert
with check (true);

create policy "Admins can read orders"
on public.orders for select
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = auth.uid()
  )
);

create policy "Admins can update orders"
on public.orders for update
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = auth.uid()
  )
);

create policy "Admins can read order items"
on public.order_items for select
to authenticated
using (
  exists (
    select 1 from public.admin_users
    where admin_users.user_id = auth.uid()
  )
);

insert into public.admin_users (user_id)
values ('1bff7596-c62b-4702-a5fb-ab86b9e71882')
on conflict (user_id) do nothing;
