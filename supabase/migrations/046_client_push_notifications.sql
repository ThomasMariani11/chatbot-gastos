-- FE-25 / NOTIF-01: notificaciones push al celular del cliente.
-- Publicar después de 045. Expansiva: tablas nuevas, RPC nuevas y un cron horario.
-- El envío lo hace el webhook (?action=client-push) con claves VAPID en secretos Edge.
-- Sin claves VAPID el webhook responde 503 y la bandeja queda pendiente, sin envíos.
begin;

-- Suscripciones push por dispositivo. Solo accesibles mediante RPC.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_=-]{80,100}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_=-]{16,32}$'),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id, created_at desc);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;

-- Bandeja idempotente: un aviso por cliente, tipo y período.
create table public.client_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('subscription_7', 'subscription_1', 'registration_noon', 'registration_night')),
  period_key text not null check (char_length(period_key) between 1 and 64),
  days integer check (days is null or days between 0 and 3650),
  state text not null default 'pending' check (state in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (user_id, kind, period_key)
);
create index client_notifications_pending_idx on public.client_notifications(state, created_at) where state in ('pending', 'sending');
alter table public.client_notifications enable row level security;
revoke all on public.client_notifications from public, anon, authenticated;

-- Cliente: guardar la suscripción de este dispositivo (máximo 5 por cuenta).
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  insert into public.push_subscriptions(user_id, endpoint, p256dh, auth)
  values (uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  delete from public.push_subscriptions
  where user_id = uid
    and id not in (select id from public.push_subscriptions where user_id = uid order by created_at desc limit 5);
  return true;
end $$;

-- Cliente: quitar la suscripción de este dispositivo.
create function public.delete_push_subscription(p_endpoint text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  delete from public.push_subscriptions where user_id = uid and endpoint = p_endpoint;
  return found;
end $$;

revoke all on function public.save_push_subscription(text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- Decide a quién avisar (hora argentina):
--   vencimiento entre las 9 y las 21; registro diario a las 12 y a las 21
--   (con una hora de margen si el cron no corrió), solo si ese día no registró nada.
create function public.enqueue_client_notifications(p_now timestamptz default clock_timestamp()) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  local_time timestamp := p_now at time zone 'America/Argentina/Buenos_Aires';
  local_hour integer := extract(hour from local_time);
  day_start timestamptz := date_trunc('day', local_time) at time zone 'America/Argentina/Buenos_Aires';
  slot text := case when local_hour in (12, 13) then 'registration_noon'
                    when local_hour in (21, 22) then 'registration_night' end;
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

  -- Registro: recordatorio diario si hoy (día argentino) no hay movimientos confirmados.
  if slot is null then return total; end if;
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
  return total + inserted;
end $$;

-- Webhook: reclamar avisos pendientes con sus suscripciones.
create function public.claim_client_notifications(p_token uuid, p_limit integer default 50) returns jsonb
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
    returning n.id, n.user_id, n.kind, n.days
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'days', c.days,
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
      from public.push_subscriptions s where s.user_id = c.user_id
    ), '[]'::jsonb)
  )), '[]'::jsonb) into result
  from claimed c;
  return result;
end $$;

-- Webhook: cerrar un aviso y quitar suscripciones caducadas (404/410).
create function public.finish_client_notification(p_id uuid, p_token uuid, p_outcome text, p_gone_endpoints text[] default '{}')
returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare owner uuid;
begin
  if p_outcome not in ('sent', 'failed', 'skipped') then raise exception 'INVALID_OUTCOME'; end if;
  update public.client_notifications
  set state = p_outcome, finished_at = clock_timestamp(), lease_until = null
  where id = p_id and token = p_token and state = 'sending'
  returning user_id into owner;
  if owner is null then return false; end if;
  delete from public.push_subscriptions where user_id = owner and endpoint = any(coalesce(p_gone_endpoints, '{}'));
  return true;
end $$;

revoke all on function public.enqueue_client_notifications(timestamptz) from public, anon, authenticated;
revoke all on function public.claim_client_notifications(uuid, integer) from public, anon, authenticated;
revoke all on function public.finish_client_notification(uuid, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.claim_client_notifications(uuid, integer) to service_role;
grant execute on function public.finish_client_notification(uuid, uuid, text, text[]) to service_role;

-- Cron: encolar y, si hay pendientes, despertar al webhook (HTTP síncrono como 022).
create function public.dispatch_client_push() returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare worker_secret text; response_status integer;
begin
  perform public.enqueue_client_notifications();
  if not exists (select 1 from public.client_notifications where state = 'pending') then return null; end if;
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name = 'whatsapp_worker_secret';
  if worker_secret is null then raise exception 'CLIENT_PUSH_SECRET_MISSING'; end if;
  begin
    if not extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '2000')
       or not extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '5000') then
      raise exception 'CLIENT_PUSH_TIMEOUT_CONFIGURATION_FAILED';
    end if;
    select status into response_status from extensions.http((
      'POST',
      'https://ystyatotldslfmucvgsq.supabase.co/functions/v1/whatsapp-webhook?action=client-push',
      array[extensions.http_header('x-worker-secret', worker_secret)],
      'application/json', '{}'
    )::extensions.http_request);
    perform extensions.http_reset_curlopt();
  exception when others then
    perform extensions.http_reset_curlopt();
    raise exception 'CLIENT_PUSH_HTTP_FAILED';
  end;
  if response_status <> 200 then raise exception 'CLIENT_PUSH_HTTP_REJECTED status=%', response_status; end if;
  return response_status;
end $$;
revoke all on function public.dispatch_client_push() from public, anon, authenticated, service_role;
comment on function public.dispatch_client_push() is 'Cron horario FE-25; timeout HTTP 5s; sin persistir headers ni credenciales.';

select cron.schedule('pesito-client-push', '7 * * * *', 'select public.dispatch_client_push()');

notify pgrst, 'reload schema';
commit;
