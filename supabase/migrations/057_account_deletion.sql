-- 3.2 (LEG-01): el cliente borra su cuenta desde la PWA, en un solo paso atómico.
-- Decisiones del propietario (26/11/2026): borrado inmediato; los registros de pago se conservan
-- anonimizados (tipo, fecha, días y estado, sin datos de la cuenta).
--
-- Expansiva y compatible: una tabla nueva y una RPC nueva; no cambia funciones existentes.
-- Borrar auth.users arrastra en cascada casi todo; esta función agrega lo que la cascada no cubre:
--   - invitation_codes.renewal_user_id (NO ACTION) bloqueaba el borrado de quien renovó con código;
--   - los restos guardados solo por teléfono (cola previa al vínculo, inbound_events, whatsapp_worker_state),
--     salvo los de un número vinculado hoy a otra cuenta.
begin;
set local lock_timeout = '5s';

create table public.payment_archive(
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('renewal_request', 'admin_renewal', 'invitation_redeemed')),
  occurred_on date,
  duration_days integer,
  state text not null,
  archived_on date not null default current_date
);
alter table public.payment_archive enable row level security;
revoke all on public.payment_archive from public, anon, authenticated, service_role;

-- guard_renewal_code (043, única definición) protege los códigos de pago: no deja cambiar su dueño ni su canje.
-- Se redefine idéntica salvo una excepción acotada: durante delete_my_account (marca local de la transacción
-- con el id de la cuenta), el código de esa misma cuenta puede pasar a dueño y canje nulos, sin tocar código,
-- días ni canje; uno ya canjeado conserva su vencimiento y uno sin canjear queda vencido (anulado), para que no
-- sirva como invitación. Fuera de esa función la marca no habilita nada útil: solo anula un código propio.
create or replace function public.guard_renewal_code() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='DELETE' then
  if old.renewal_user_id is not null then raise exception 'Ese código corresponde a un pago. Requiere revisión administrativa.' using errcode='22023'; end if;
  return old;
 end if;
 if old.renewal_user_id is not null
    and current_setting('pesito.account_deletion', true) = old.renewal_user_id::text
    and new.renewal_user_id is null and new.used_by is null
    and new.code is not distinct from old.code and new.duration_days is not distinct from old.duration_days
    and new.is_used is not distinct from old.is_used
    and ((old.is_used and new.expires_at is not distinct from old.expires_at)
         or (not old.is_used and new.expires_at is not null and new.expires_at <= clock_timestamp())) then
  return new;
 end if;
 if old.renewal_user_id is not null then
  if new.renewal_user_id is distinct from old.renewal_user_id or new.code is distinct from old.code or new.duration_days is distinct from old.duration_days or new.expires_at is distinct from old.expires_at then
   raise exception 'El código de pago no puede modificarse.' using errcode='22023'; end if;
  if old.is_used and (not new.is_used or new.used_by is distinct from old.used_by) then
   raise exception 'El código ya fue canjeado.' using errcode='22023'; end if;
 end if;
 if new.renewal_user_id is not null and new.is_used then
  if new.used_by is distinct from new.renewal_user_id then raise exception 'Código de renovación no disponible para esta cuenta.' using errcode='22023'; end if;
 end if;
 return new;
end $$;

create function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  uid uuid := auth.uid();
  account_role text;
  phones text[];
begin
  if uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  -- Bloquear el perfil serializa el borrado con renovaciones y canjes concurrentes del mismo cliente.
  select role into account_role from public.profiles where id = uid for update;
  if not found then
    raise exception 'ACCOUNT_NOT_FOUND' using errcode = '42501';
  end if;
  if account_role = 'admin' then
    raise exception 'ACCOUNT_DELETION_ADMIN' using errcode = '42501';
  end if;
  -- Irreversible: exige que el token sea de una sesión de esta cuenta creada hace menos de 5 minutos
  -- (la PWA la crea al verificar la contraseña). Un token robado o una pestaña abierta no alcanza.
  if not exists (
    select 1 from auth.sessions s
     where s.id::text = nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id'
       and s.user_id = uid and s.created_at > clock_timestamp() - interval '5 minutes'
  ) then
    raise exception 'REAUTH_REQUIRED' using errcode = '28000';
  end if;

  -- Pagos anonimizados: nada que identifique a la cuenta ni al número.
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

  -- Sin esto, el borrado de quien renovó con un código nominativo falla (NO ACTION y guard_renewal_code).
  perform set_config('pesito.account_deletion', uid::text, true);
  -- Uno sin canjear se anula (vence ahora): si no, quedaría como invitación válida para cualquiera.
  update public.invitation_codes
     set renewal_user_id = null, used_by = null,
         expires_at = case when is_used then expires_at else now() - interval '1 second' end
   where renewal_user_id = uid;
  perform set_config('pesito.account_deletion', '', true);

  -- Números de la cuenta que no estén vinculados hoy a otra cuenta.
  select coalesce(array_agg(distinct p.wa_id), '{}') into phones from (
    select wa_id from public.whatsapp_links where user_id = uid
    union select wa_id from public.whatsapp_worker_state where user_id = uid
  ) p
  where not exists (select 1 from public.whatsapp_links l where l.wa_id = p.wa_id and l.status = 'active' and l.user_id <> uid);
  delete from public.whatsapp_message_queue where wa_id = any(phones);
  delete from public.inbound_events where wa_id = any(phones);
  delete from public.whatsapp_worker_state where wa_id = any(phones);

  -- El registro de auditoría de Auth guarda el correo y no tiene FK a la cuenta.
  delete from auth.audit_log_entries where payload ->> 'actor_id' = uid::text;

  -- El resto (perfil, movimientos, borradores, vínculo, notificaciones, push, cupos, renovaciones) cae en cascada.
  delete from auth.users where id = uid;
  return jsonb_build_object('deleted', true);
end $$;

revoke all on function public.delete_my_account() from public, anon, service_role;
grant execute on function public.delete_my_account() to authenticated;

do $verify$
declare f regprocedure := 'public.delete_my_account()'::regprocedure;
begin
  if not (select prosecdef from pg_proc where oid = f)
     or not (select 'search_path=pg_catalog, public' = any(proconfig) from pg_proc where oid = f) then
    raise exception 'LEG01_FUNCION_INESPERADA';
  end if;
  if has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute')
     or not has_function_privilege('authenticated', f, 'execute') then
    raise exception 'LEG01_PERMISOS_FUNCION';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.payment_archive'::regclass)
     or has_any_column_privilege('anon', 'public.payment_archive', 'select')
     or has_any_column_privilege('authenticated', 'public.payment_archive', 'select')
     or has_any_column_privilege('service_role', 'public.payment_archive', 'select')
     or has_table_privilege('authenticated', 'public.payment_archive', 'insert') then
    raise exception 'LEG01_PERMISOS_TABLA';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
commit;
