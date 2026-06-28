-- Run this in Supabase SQL Editor (project: iqoffsnkptulvuqmdcce)
-- Fixes order saves blocked by RLS and missing columns

alter table public.orders
  add column if not exists customer_email text,
  add column if not exists payment_reference text,
  add column if not exists product_account text;

alter table public.orders
  drop constraint if exists orders_payment_method_check;

alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method in ('Crypto', 'Paystack'));

drop policy if exists "Anyone can create orders" on public.orders;
create policy "Anyone can create orders"
on public.orders for insert
with check (true);

drop policy if exists "Anyone can create order items" on public.order_items;
create policy "Anyone can create order items"
on public.order_items for insert
with check (true);

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
begin
  insert into public.orders (
    customer_name,
    customer_phone,
    telegram_username,
    delivery_details,
    payment_method,
    total_usd
  )
  values (
    p_customer_name,
    p_customer_phone,
    p_telegram_username,
    p_delivery_details,
    p_payment_method,
    p_total_usd
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      order_id,
      product_id,
      product_name,
      quantity,
      unit_price_usd
    )
    values (
      v_order_id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price_usd')::numeric
    );
  end loop;

  return v_order_id;
end;
$$;

grant execute on function public.create_store_order to anon, authenticated;
