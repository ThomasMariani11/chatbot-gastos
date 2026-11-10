-- NOTIF-02: resumen de fin de mes por Web Push.
-- Publicar después de 050. Expansiva: una columna con valor por defecto y un tipo nuevo de aviso.
-- Sin cambios de permisos: se redefinen enqueue/claim con los mismos revoke/grant de 046.
begin;

-- Preferencia del cliente: el resumen mensual está activo salvo que lo apague.
alter table public.app_settings add column if not exists monthly_summary_enabled boolean not null default true;
comment on column public.app_settings.monthly_summary_enabled is 'NOTIF-02: el cliente recibe el resumen del mes anterior por Web Push (día 1, 10:00 hora argentina).';

-- Quinto tipo de aviso: reemplazar el check de client_notifications.kind.
do $$
declare con record;
begin
  for con in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.client_notifications'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%subscription_7%'
  loop
    execute format('alter table public.client_notifications drop constraint %I', con.conname);
  end loop;
end $$;
alter table public.client_notifications add constraint client_notifications_kind_check
  check (kind in ('subscription_7', 'subscription_1', 'registration_noon', 'registration_night', 'monthly_summary'));

-- Decide a quién avisar (hora argentina). Igual que 046 más el resumen mensual:
--   día 1 a las 10 u 11 (margen si el cron no corrió), del mes anterior, solo con movimientos confirmados
--   en ese mes, dispositivo registrado, preferencia activa y cuenta vigente. period_key = 'YYYY-MM'.
create or replace function public.enqueue_client_notifications(p_now timestamptz default clock_timestamp()) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  local_time timestamp := p_now at time zone 'America/Argentina/Buenos_Aires';
  local_hour integer := extract(hour from local_time);
  day_start timestamptz := date_trunc('day', local_time) at time zone 'America/Argentina/Buenos_Aires';
  slot text := case when local_hour in (12, 13) then 'registration_noon'
                    when local_hour in (21, 22) then 'registration_night' end;
  summary_month date := (date_trunc('month', local_time) - interval '1 month')::date;
  inserted integer;
  total integer := 0;
begin
  -- Vencimiento: clientes activos a 7 días o menos (y otro aviso dentro de las últimas 24 h).
  insert into public.client_notifications(user_id, kind, period_key, days)
  select p.id,
         case when p.subscription_until <= p_now + interval '1 day' then 'subscription_1' else 'subscription_7' end,
         to_char(p.subscription_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'),
         ceil(extract(epoch from p.subscription_until - p_now) / 86400)::integer
  from public.profiles p
  where local_hour between 9 and 20
    and p.role = 'client' and p.subscription_status = 'active'
    and p.subscription_until > p_now and p.subscription_until <= p_now + interval '7 days'
    and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  total := total + inserted;

  -- Resumen mensual: el día 1 a las 10 u 11, del mes anterior; solo si ese mes tuvo movimientos confirmados.
  if extract(day from local_time) = 1 and local_hour in (10, 11) then
    insert into public.client_notifications(user_id, kind, period_key, days)
    select p.id, 'monthly_summary', to_char(summary_month, 'YYYY-MM'), null
    from public.profiles p
    join public.app_settings a on a.user_id = p.id and a.monthly_summary_enabled
    where (p.role = 'admin'
           or (p.role = 'client' and p.subscription_status = 'active'
               and (p.subscription_until is null or p.subscription_until > p_now)))
      and exists (
        select 1 from public.transactions t
        where t.user_id = p.id and t.status = 'confirmed'
          and t.occurred_on >= summary_month and t.occurred_on < (summary_month + interval '1 month')::date
      )
      and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
    on conflict do nothing;
    get diagnostics inserted = row_count;
    total := total + inserted;
  end if;

  -- Registro: recordatorio diario si hoy (día argentino) no hay movimientos confirmados.
  if slot is not null then
    insert into public.client_notifications(user_id, kind, period_key, days)
    select p.id, slot, to_char(local_time, 'YYYY-MM-DD'), null
    from public.profiles p
    join public.app_settings a on a.user_id = p.id and a.client_reminders_enabled
    where (p.role = 'admin'
           or (p.role = 'client' and p.subscription_status = 'active'
               and (p.subscription_until is null or p.subscription_until > p_now)))
      and not exists (
        select 1 from public.transactions t
        where t.user_id = p.id and t.status = 'confirmed' and t.created_at >= day_start
      )
      and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
    on conflict do nothing;
    get diagnostics inserted = row_count;
    total := total + inserted;
  end if;
  return total;
end $$;

-- Webhook: reclamar avisos pendientes con sus suscripciones (ahora con period_key).
create or replace function public.claim_client_notifications(p_token uuid, p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  -- Un envío interrumpido no se repite: se cierra como fallido.
  update public.client_notifications set state = 'failed', finished_at = clock_timestamp(), lease_until = null
  where state = 'sending' and lease_until < clock_timestamp();
  -- Revalidar antes de enviar: preferencia apagada o movimiento registrado después de encolar.
  update public.client_notifications n set state = 'skipped', finished_at = clock_timestamp()
  where n.state = 'pending' and n.kind in ('registration_noon', 'registration_night')
    and (exists (select 1 from public.app_settings a where a.user_id = n.user_id and not a.client_reminders_enabled)
         or exists (select 1 from public.transactions t
                    where t.user_id = n.user_id and t.status = 'confirmed' and t.created_at >= n.created_at));
  -- El resumen mensual solo depende de su propia preferencia.
  update public.client_notifications n set state = 'skipped', finished_at = clock_timestamp()
  where n.state = 'pending' and n.kind = 'monthly_summary'
    and exists (select 1 from public.app_settings a where a.user_id = n.user_id and not a.monthly_summary_enabled);

  with picked as (
    select n.id from public.client_notifications n
    where n.state = 'pending'
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
    for update skip locked
  ), claimed as (
    update public.client_notifications n
    set state = 'sending', token = p_token, lease_until = clock_timestamp() + interval '2 minutes'
    from picked where n.id = picked.id
    returning n.id, n.user_id, n.kind, n.days, n.period_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'days', c.days, 'period_key', c.period_key,
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
      from public.push_subscriptions s where s.user_id = c.user_id
    ), '[]'::jsonb)
  )), '[]'::jsonb) into result
  from claimed c;
  return result;
end $$;

revoke all on function public.enqueue_client_notifications(timestamptz) from public, anon, authenticated;
revoke all on function public.claim_client_notifications(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_client_notifications(uuid, integer) to service_role;

notify pgrst, 'reload schema';
commit;
