-- Función RPC optimizada para devolver de manera directa y agregada
-- los meses únicos con transacciones confirmadas del usuario autenticado,
-- evitando transferir miles de filas completas de transacciones por la red.

create or replace function public.get_distinct_transaction_months()
returns table(month text) language sql stable security invoker as $$
  select distinct to_char(occurred_on, 'YYYY-MM') as month
  from public.transactions
  where user_id = auth.uid()
    and status = 'confirmed'
    and occurred_on is not null
  order by month asc;
$$;
