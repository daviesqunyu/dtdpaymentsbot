-- STEP 1: paste and Run this alone first (clears the constraint error)

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
