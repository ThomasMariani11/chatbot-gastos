-- Migración 004: Soporte para compras y transacciones en USD (dólares)
alter table public.transactions 
add column if not exists currency text not null default 'ARS' check (currency in ('ARS', 'USD'));

-- Índice para optimizar consultas filtradas por usuario, moneda y fecha
create index if not exists transactions_user_currency_idx 
on public.transactions(user_id, currency, occurred_on desc);
