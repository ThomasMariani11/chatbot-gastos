-- Fase 4, grupo de base de datos (P3): SEC-12, SEC-13, SEC-14, SEC-15, SEC-16, SEC-18, SEC-19 y pendientes de 3.2.
-- Decisiones del propietario (28/11/2026): no publicar borrados en tiempo real (la PWA los ve con su refresco
-- de 30 s); SEC-17 queda para cuando exista staging.
--
-- Compatible con la PWA y el webhook publicados: cada escritura directa que hace hoy la PWA sigue permitida
-- (nombre y apellido, edición y borrado de movimientos, presupuestos, tres interruptores de Ajustes y, el admin,
-- configuración y borrado de códigos). Las funciones del bot son SECURITY DEFINER y no dependen de estos privilegios.
begin;
set local lock_timeout = '5s';

-- SEC-12: el cliente solo edita nombre y apellido de su perfil.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (first_name, last_name, updated_at) on public.profiles to authenticated;

-- SEC-13: movimientos y ajustes solo por las columnas que la PWA edita; categorías sin escritura directa.
revoke insert, update on public.transactions from anon, authenticated;
grant update (description, amount_ars, currency, kind, category_id, occurred_on, updated_at) on public.transactions to authenticated;
revoke delete on public.transactions from anon;
revoke insert, update, delete on public.app_settings from anon, authenticated;
grant update (whatsapp_responses_enabled, client_reminders_enabled, monthly_summary_enabled, updated_at) on public.app_settings to authenticated;
revoke insert, update, delete on public.categories from anon, authenticated;
revoke insert, update, delete on public.budgets from anon;

-- SEC-14: la configuración (alias de pago, teléfonos, número del bot) solo con sesión.
drop policy if exists "anyone can read public system config" on public.system_config;
create policy "authenticated read system config" on public.system_config for select to authenticated using (true);

-- SEC-15: los borrados no se emiten por tiempo real (no pasan por RLS); altas y cambios siguen.
do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime set (publish = 'insert, update');
  end if;
end
$realtime$;

-- SEC-16: sin sesión no hacen falta. is_admin() y has_active_subscription() siguen ejecutables por anon
-- porque las políticas RLS las llaman (sin sesión devuelven falso); quitárselas haría fallar consultas vacías.
revoke execute on function public.get_my_role() from public, anon;
revoke execute on function public.get_distinct_transaction_months() from public, anon;
grant execute on function public.get_my_role() to authenticated, service_role;
grant execute on function public.get_distinct_transaction_months() to authenticated, service_role;
alter function public.get_active_draft_group(uuid) set search_path = pg_catalog, public;
alter function public.get_my_role() set search_path = pg_catalog, public;
alter function public.has_active_subscription() set search_path = pg_catalog, public;
-- next_gemini_model_slot() existe en producción pero en ninguna migración del repo (deriva histórica; el
-- código actual no la usa): se endurece solo si existe, sin borrarla.
do $legacy$
begin
  if to_regprocedure('public.next_gemini_model_slot()') is not null then
    alter function public.next_gemini_model_slot() set search_path = pg_catalog, public;
  end if;
end
$legacy$;

-- SEC-18: registro de acciones administrativas y protección del último administrador.
create table public.admin_audit_log(
  id bigserial primary key,
  at timestamptz not null default clock_timestamp(),
  actor uuid,
  action text not null,
  target text not null,
  detail jsonb
);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated, service_role;
revoke all on sequence public.admin_audit_log_id_seq from public, anon, authenticated, service_role;
grant select on public.admin_audit_log to authenticated;
create policy "admins read audit log" on public.admin_audit_log for select to authenticated using (public.is_admin());

create function public.audit_admin_change() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_table_name = 'profiles' then
    insert into public.admin_audit_log(actor, action, target, detail)
      values (auth.uid(), 'profile.role', new.id::text, jsonb_build_object('from', old.role, 'to', new.role));
    return new;
  elsif tg_table_name = 'system_config' then
    insert into public.admin_audit_log(actor, action, target, detail)
      values (auth.uid(), case when tg_op = 'DELETE' then 'system_config.delete' else 'system_config.upsert' end,
              coalesce(new.key, old.key), case when tg_op = 'DELETE' then null else jsonb_build_object('value', new.value) end);
    return coalesce(new, old);
  else
    insert into public.admin_audit_log(actor, action, target) values (auth.uid(), 'invitation_code.delete', old.code);
    return old;
  end if;
end $$;
revoke all on function public.audit_admin_change() from public, anon, authenticated, service_role;

create trigger audit_profile_role after update of role on public.profiles
  for each row when (old.role is distinct from new.role) execute function public.audit_admin_change();
create trigger audit_system_config after insert or update or delete on public.system_config
  for each row execute function public.audit_admin_change();
create trigger audit_invitation_code_delete after delete on public.invitation_codes
  for each row execute function public.audit_admin_change();

create function public.protect_last_admin() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role is distinct from 'admin')
     and not exists (select 1 from public.profiles where role = 'admin' and id <> old.id) then
    raise exception 'LAST_ADMIN' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.protect_last_admin() from public, anon, authenticated, service_role;
create trigger protect_last_admin before update of role or delete on public.profiles
  for each row execute function public.protect_last_admin();

-- SEC-19: una suscripción push no pasa a otra cuenta y solo apunta a servicios de notificación conocidos.
alter table public.push_subscriptions add constraint push_subscriptions_known_host check (endpoint ~ (
  '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|'
  || '[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/'));

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare uid uuid := auth.uid(); saved integer;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_endpoint is null or p_endpoint !~ (
    '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|'
    || '[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/') then
    raise exception 'PUSH_ENDPOINT_HOST' using errcode = '22023';
  end if;
  insert into public.push_subscriptions(user_id, endpoint, p256dh, auth)
  values (uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, created_at = now()
    where public.push_subscriptions.user_id = uid;
  get diagnostics saved = row_count;
  if saved = 0 then raise exception 'PUSH_ENDPOINT_IN_USE' using errcode = '42501'; end if;
  delete from public.push_subscriptions
  where user_id = uid
    and id not in (select id from public.push_subscriptions where user_id = uid order by created_at desc limit 5);
  return true;
end $$;

-- 3.2: borrado de cuenta (redefinido desde 057) con más fuentes de números, bloqueos en el orden del bot
-- (estado por número → cola → perfil), registro de reclasificación y notas de sus códigos.
create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  uid uuid := auth.uid();
  account_role text;
  phones text[];
begin
  if uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  select role into account_role from public.profiles where id = uid;
  if not found then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode = '42501';
  end if;
  if account_role = 'admin' then
    raise exception 'ACCOUNT_DELETION_ADMIN' using errcode = '42501';
  end if;
  -- Irreversible: exige que el token sea de una sesión de esta cuenta creada hace menos de 5 minutos.
  if not exists (
    select 1 from auth.sessions s
     where s.id::text = nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id'
       and s.user_id = uid and s.created_at > clock_timestamp() - interval '5 minutes'
  ) then
    raise exception 'REAUTH_REQUIRED' using errcode = '28000';
  end if;

  -- Números de la cuenta que no estén vinculados hoy a otra cuenta.
  select coalesce(array_agg(distinct p.wa_id), '{}') into phones from (
    select wa_id from public.whatsapp_links where user_id = uid
    union select wa_id from public.whatsapp_worker_state where user_id = uid
    union select wa_id from public.whatsapp_message_queue where user_id = uid
    union select wa_id from public.subscription_renewal_requests where user_id = uid
  ) p
  where p.wa_id is not null
    and not exists (select 1 from public.whatsapp_links l where l.wa_id = p.wa_id and l.status = 'active' and l.user_id <> uid);

  -- Mismo orden de bloqueos que la recepción y el bot: evita esperas cruzadas y mensajes que se cuelen.
  perform 1 from public.whatsapp_worker_state where wa_id = any(phones) order by wa_id for update;
  perform 1 from public.whatsapp_message_queue where user_id = uid or wa_id = any(phones) order by id for update;
  perform 1 from public.profiles where id = uid for update;
  if not found then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode = '42501';
  end if;

  -- Pagos sin datos personales: tipo, fecha, días y estado.
  insert into public.payment_archive(kind, occurred_on, duration_days, state)
    select 'renewal_request', r.paid_at::date, r.duration_days, r.state
      from public.subscription_renewal_requests r where r.user_id = uid and r.state in ('paid', 'redeemed');
  insert into public.payment_archive(kind, occurred_on, duration_days, state)
    select 'admin_renewal', a.created_at::date, a.days_added, 'applied'
      from public.admin_subscription_requests a where a.client_id = uid;
  insert into public.payment_archive(kind, occurred_on, duration_days, state)
    select 'invitation_redeemed', c.used_at::date, c.duration_days, 'redeemed'
      from public.invitation_codes c where c.used_by = uid
       and not exists (select 1 from public.subscription_renewal_requests r where r.code_id = c.id and r.user_id = uid);

  -- Notas del admin sobre los códigos de esta cuenta (pueden nombrar al cliente).
  update public.invitation_codes set notes = null where used_by = uid and renewal_user_id is null and notes is not null;
  -- Códigos de pago: sin dueño ni notas; uno sin canjear queda vencido para que no sirva como invitación.
  perform set_config('pesito.account_deletion', uid::text, true);
  update public.invitation_codes
     set renewal_user_id = null, used_by = null, notes = null,
         expires_at = case when is_used then expires_at else now() - interval '1 second' end
   where renewal_user_id = uid;
  perform set_config('pesito.account_deletion', '', true);

  delete from public.whatsapp_message_queue where wa_id = any(phones);
  delete from public.inbound_events where wa_id = any(phones);
  delete from public.whatsapp_worker_state where wa_id = any(phones);
  delete from public.category_reclass_log where user_id = uid;
  delete from auth.audit_log_entries where payload ->> 'actor_id' = uid::text;

  -- El resto (perfil, movimientos, borradores, vínculo, notificaciones, push, cupos, renovaciones) cae en cascada.
  delete from auth.users where id = uid;
  return jsonb_build_object('deleted', true);
end $$;

do $verify$
declare f regprocedure;
begin
  foreach f in array array['public.save_push_subscription(text,text,text)'::regprocedure, 'public.delete_my_account()'::regprocedure,
                           'public.guard_renewal_code()'::regprocedure, 'public.audit_admin_change()'::regprocedure,
                           'public.protect_last_admin()'::regprocedure] loop
    if not (select prosecdef from pg_proc where oid = f)
       or not (select 'search_path=pg_catalog, public' = any(proconfig) from pg_proc where oid = f) then
      raise exception 'F4_FUNCION_INESPERADA %', f;
    end if;
    if has_function_privilege('anon', f, 'execute') then raise exception 'F4_PERMISOS_ANON %', f; end if;
  end loop;
  if position('pesito.account_deletion' in pg_get_functiondef('public.guard_renewal_code()'::regprocedure)) = 0 then
    raise exception 'F4_GUARD_SIN_EXCEPCION';
  end if;
  if has_function_privilege('service_role', 'public.delete_my_account()', 'execute')
     or not has_function_privilege('authenticated', 'public.delete_my_account()', 'execute')
     or not has_function_privilege('authenticated', 'public.save_push_subscription(text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.get_my_role()', 'execute')
     or has_function_privilege('anon', 'public.get_distinct_transaction_months()', 'execute') then
    raise exception 'F4_PERMISOS_FUNCION';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'email', 'update')
     or has_column_privilege('authenticated', 'public.profiles', 'role', 'update')
     or not has_column_privilege('authenticated', 'public.profiles', 'first_name', 'update')
     or has_table_privilege('authenticated', 'public.transactions', 'insert')
     or has_column_privilege('authenticated', 'public.transactions', 'status', 'update')
     or not has_column_privilege('authenticated', 'public.transactions', 'amount_ars', 'update')
     or has_table_privilege('authenticated', 'public.categories', 'insert')
     or has_table_privilege('authenticated', 'public.admin_audit_log', 'insert')
     or not (select relrowsecurity from pg_class where oid = 'public.admin_audit_log'::regclass) then
    raise exception 'F4_PERMISOS_TABLAS';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_config' and cmd = 'SELECT' and 'public' = any(roles)) then
    raise exception 'F4_CONFIG_PUBLICA';
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and pubdelete) then
    raise exception 'F4_REALTIME_BORRADOS';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
commit;
