-- BE-09: agregación mensual exacta por moneda; no modifica movimientos ni presupuestos.
begin;
set local lock_timeout='5s';
create function public.whatsapp_monthly_summary(p_user_id uuid,p_month date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare first_day date;next_month date;result jsonb;valid_account boolean;
begin
 if p_month is null or not isfinite(p_month) or p_month<date '0001-01-01' or p_month>date '9998-12-31' then raise exception 'FINANCE_INVALID_MONTH';end if;
 if p_user_id is null then raise exception 'FINANCE_ACCOUNT_UNAVAILABLE';end if;
 select role='admin' or (role='client' and subscription_status='active' and (subscription_until is null or subscription_until>now())) into valid_account from public.profiles where id=p_user_id;
 if valid_account is distinct from true then raise exception 'FINANCE_ACCOUNT_UNAVAILABLE';end if;
 first_day:=date_trunc('month',p_month::timestamp)::date;
 next_month:=(first_day+interval '1 month')::date;
 -- Confirmados sin fecha no pueden asignarse a un mes; no mostrar un saldo falso.
 if exists(select 1 from public.transactions where user_id=p_user_id and status='confirmed' and (occurred_on is null or not isfinite(occurred_on))) then raise exception 'FINANCE_INVALID_DATA';end if;
 with month_rows as materialized (
  select kind,currency,amount_ars from public.transactions where user_id=p_user_id and status='confirmed' and occurred_on>=first_day and occurred_on<next_month
 ), totals as (
  select c.currency,coalesce(sum(r.amount_ars)filter(where r.kind='expense'),0::numeric) as expenses,coalesce(sum(r.amount_ars)filter(where r.kind='income'),0::numeric) as income,count(r.kind) as operations
  from (values('ARS'),('USD'))c(currency) left join month_rows r on r.currency=c.currency group by c.currency
 ), budget as (select amount_ars from public.budgets where user_id=p_user_id and month=first_day)
 select case when exists(select 1 from month_rows where amount_ars is null or amount_ars<=0 or amount_ars::text in('NaN','Infinity','-Infinity')) or exists(select 1 from budget where amount_ars<=0 or amount_ars::text in('NaN','Infinity','-Infinity')) then null else
 jsonb_build_object('version',1,'month',to_char(first_day,'YYYY-MM'),'budget_ars',(select amount_ars::text from budget),'remaining_budget_ars',(select (amount_ars-(select expenses from totals where currency='ARS'))::text from budget),
 'currencies',(select jsonb_agg(jsonb_build_object('currency',currency,'expenses',expenses::text,'income',income::text,'balance',(income-expenses)::text,'operations',operations::text) order by currency)from totals)) end into result;
 if result is null then raise exception 'FINANCE_INVALID_DATA';end if;
 return result;
end $$;
revoke all on function public.whatsapp_monthly_summary(uuid,date) from public,anon,authenticated;
grant execute on function public.whatsapp_monthly_summary(uuid,date) to service_role;

-- Compatibilidad: misma firma/columnas numéricas, ahora exclusivamente ARS.
-- USD se consulta en el contrato nuevo del backend; nunca convertir/sumar monedas.
create or replace function public.monthly_summary(target_month date)
returns table(expenses numeric,income numeric,balance numeric)
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare first_day date;next_month date;
begin
 if auth.uid() is null then raise exception 'FINANCE_AUTH_REQUIRED';end if;
 if not public.has_active_subscription() then raise exception 'FINANCE_ACCOUNT_UNAVAILABLE';end if;
 if target_month is null or not isfinite(target_month) or target_month<date '0001-01-01' or target_month>date '9998-12-31' then raise exception 'FINANCE_INVALID_MONTH';end if;
 first_day:=date_trunc('month',target_month::timestamp)::date;next_month:=(first_day+interval '1 month')::date;
 if exists(select 1 from public.transactions t where t.user_id=auth.uid() and t.status='confirmed' and (t.occurred_on is null or not isfinite(t.occurred_on) or (t.currency='ARS' and t.occurred_on>=first_day and t.occurred_on<next_month and (t.amount_ars is null or t.amount_ars<=0 or t.amount_ars::text in('NaN','Infinity','-Infinity'))))) then raise exception 'FINANCE_INVALID_DATA';end if;
 return query select coalesce(sum(t.amount_ars)filter(where t.kind='expense'),0::numeric),coalesce(sum(t.amount_ars)filter(where t.kind='income'),0::numeric),coalesce(sum(case when t.kind='income' then t.amount_ars else -t.amount_ars end),0::numeric)
 from public.transactions t where t.user_id=auth.uid() and t.status='confirmed' and t.currency='ARS' and t.occurred_on>=first_day and t.occurred_on<next_month;
end $$;
revoke all on function public.monthly_summary(date) from public,anon,service_role;
grant execute on function public.monthly_summary(date) to authenticated;
notify pgrst, 'reload schema';
commit;
