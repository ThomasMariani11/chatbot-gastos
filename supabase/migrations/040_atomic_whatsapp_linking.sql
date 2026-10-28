-- BE-14: Vinculación atómica y límites de intentos para WhatsApp e invitaciones.
-- 1. Agrega columnas de control de intentos a whatsapp_worker_state.
-- 2. Agrega expiración opcional a invitation_codes y tabla de intentos para check_invitation_code.
-- 3. Protege check_invitation_code con límite de intentos y mensaje seguro.
-- 4. Actualiza apply_whatsapp_job para hacer atómica la vinculación y limitar intentos por teléfono.
-- 5. Actualiza bootstrap_user y redeem_invitation_code para respetar expires_at en servidor.
begin;
set local lock_timeout = '5s';

-- 1. Columnas de intentos en whatsapp_worker_state
alter table public.whatsapp_worker_state
  add column if not exists link_attempts integer not null default 0,
  add column if not exists link_locked_until timestamptz,
  add column if not exists last_link_attempt_at timestamptz;

-- 2. Expiración de códigos de invitación y tabla de límites de consultas
alter table public.invitation_codes
  add column if not exists expires_at timestamptz;

create table if not exists public.invitation_check_attempts (
  identifier text primary key,
  attempt_count integer not null default 0,
  window_start timestamptz not null default clock_timestamp(),
  locked_until timestamptz
);
alter table public.invitation_check_attempts enable row level security;
revoke all on public.invitation_check_attempts from public, anon, authenticated;
grant all on public.invitation_check_attempts to service_role;

-- 3. check_invitation_code seguro y con rate limiting
create or replace function public.check_invitation_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_clean text := upper(trim(coalesce(p_code, '')));
  v_headers jsonb;
  v_ip text;
  v_identifier text;
  v_rec public.invitation_check_attempts%rowtype;
  v_code public.invitation_codes%rowtype;
  v_attempts integer := 1;
begin
  if v_clean = '' then
    return jsonb_build_object('valid', false, 'error', 'Ingresá un código de invitación.');
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;

  v_ip := nullif(split_part(coalesce(
    v_headers->>'cf-connecting-ip',
    v_headers->>'x-real-ip',
    v_headers->>'x-forwarded-for'
  ), ',', 1), '');

  v_identifier := coalesce(trim(v_ip), 'anon_' || coalesce(auth.uid()::text, 'unknown'));

  select * into v_rec from public.invitation_check_attempts where identifier = v_identifier for update;
  if not found then
    insert into public.invitation_check_attempts(identifier, attempt_count, window_start)
      values (v_identifier, 1, clock_timestamp())
      on conflict (identifier) do nothing;
    select * into v_rec from public.invitation_check_attempts where identifier = v_identifier for update;
  end if;

  if v_rec.locked_until is not null and v_rec.locked_until > clock_timestamp() then
    return jsonb_build_object('valid', false, 'error', 'Demasiados intentos. Esperá unos minutos antes de volver a probar.');
  end if;

  if clock_timestamp() - v_rec.window_start > interval '1 minute' then
    v_attempts := 1;
    update public.invitation_check_attempts
      set attempt_count = 1,
          window_start = clock_timestamp(),
          locked_until = null
      where identifier = v_identifier;
  else
    v_attempts := v_rec.attempt_count + 1;
    if v_attempts > 15 then
      update public.invitation_check_attempts
        set attempt_count = v_attempts,
            locked_until = clock_timestamp() + interval '5 minutes'
        where identifier = v_identifier;
      return jsonb_build_object('valid', false, 'error', 'Demasiados intentos. Esperá unos minutos antes de volver a probar.');
    else
      update public.invitation_check_attempts
        set attempt_count = v_attempts
        where identifier = v_identifier;
    end if;
  end if;

  select * into v_code
  from public.invitation_codes
  where upper(trim(code)) = v_clean;

  if not found or v_code.is_used or (v_code.expires_at is not null and v_code.expires_at <= clock_timestamp()) then
    return jsonb_build_object('valid', false, 'error', 'Código de invitación inválido o no disponible.');
  end if;

  return jsonb_build_object(
    'valid', true,
    'duration_days', v_code.duration_days
  );
end;
$$;

revoke all on function public.check_invitation_code(text) from public;
grant execute on function public.check_invitation_code(text) to anon, authenticated, service_role;

-- 4. Modificar apply_whatsapp_job para vinculación atómica y protección contra fuerza bruta
do $migration$
declare
  definition text;
  old_link constant text := $old$  elsif action='link' then
    -- La vinculación se aplica una sola vez junto al checkpoint del mensaje.
    select user_id into u from public.whatsapp_links where link_code_hash=p_action->>'hash' and link_code_expires_at>clock_timestamp() for update;
    if u is null then reply:='El código de vinculación no es válido o ya venció. Generá uno nuevo desde la app.';
    else
      -- No cambiar un usuario mientras otro trabajador tenga una concesión activa.
      perform 1 from public.whatsapp_user_leases where user_id=u and lease_until>clock_timestamp() and lease_token<>p_token for update;
      if found then raise exception 'QUEUE_LINK_BUSY'; end if;
      update public.whatsapp_links set wa_id=null,status='pending' where wa_id=q.wa_id and user_id<>u;
      update public.profiles set phone_number=null where phone_number=q.wa_id and id<>u;
      update public.whatsapp_links set wa_id=q.wa_id,status='active',linked_at=clock_timestamp(),link_code_hash=null,link_code_expires_at=null where user_id=u;
      update public.profiles set phone_number=q.wa_id where id=u;
      reply:='¡Listo! Tu WhatsApp quedó vinculado con Pesito ✅';
    end if;$old$;
  new_link constant text := $new$  elsif action='link' then
    declare
      s public.whatsapp_worker_state%rowtype;
      attempts_now integer := 0;
    begin
      select * into s from public.whatsapp_worker_state where wa_id=q.wa_id for update;
      if s.link_locked_until is not null and s.link_locked_until > clock_timestamp() then
        reply := 'Demasiados intentos fallidos de vinculación. Por seguridad, esperá 15 minutos antes de volver a intentar.';
      else
        if (s.link_locked_until is not null and s.link_locked_until <= clock_timestamp())
           or (s.last_link_attempt_at is not null and s.last_link_attempt_at < clock_timestamp() - interval '15 minutes') then
          attempts_now := 0;
        else
          attempts_now := coalesce(s.link_attempts, 0);
        end if;

        select user_id into u from public.whatsapp_links where link_code_hash=p_action->>'hash' and link_code_expires_at>clock_timestamp() for update;
        if u is null then
          attempts_now := attempts_now + 1;
          if attempts_now >= 5 then
            update public.whatsapp_worker_state
              set link_attempts = attempts_now,
                  link_locked_until = clock_timestamp() + interval '15 minutes',
                  last_link_attempt_at = clock_timestamp()
              where wa_id = q.wa_id;
            reply := 'Demasiados intentos fallidos de vinculación. Por seguridad, esperá 15 minutos antes de volver a intentar.';
          else
            update public.whatsapp_worker_state
              set link_attempts = attempts_now,
                  link_locked_until = null,
                  last_link_attempt_at = clock_timestamp()
              where wa_id = q.wa_id;
            reply := 'El código de vinculación no es válido o ya venció. Generá uno nuevo desde la app.';
          end if;
        else
          perform 1 from public.whatsapp_user_leases where user_id=u and lease_until>clock_timestamp() and lease_token<>p_token for update;
          if found then raise exception 'QUEUE_LINK_BUSY'; end if;
          update public.whatsapp_links set wa_id=null,status='pending' where wa_id=q.wa_id and user_id<>u;
          update public.profiles set phone_number=null where phone_number=q.wa_id and id<>u;
          update public.whatsapp_links set wa_id=q.wa_id,status='active',linked_at=clock_timestamp(),link_code_hash=null,link_code_expires_at=null where user_id=u;
          update public.profiles set phone_number=q.wa_id where id=u;
          update public.whatsapp_worker_state set user_id=u,link_attempts=0,link_locked_until=null,last_link_attempt_at=null where wa_id=q.wa_id;
          reply := '¡Listo! Tu WhatsApp quedó vinculado con Pesito ✅';
        end if;
      end if;
    end;$new$;
begin
  select pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure) into definition;
  if position(new_link in definition) > 0 then return; end if;
  if position(old_link in definition) = 0 then
    raise exception 'BE14_APPLY_DEFINITION_UNEXPECTED';
  end if;
  execute replace(definition, old_link, new_link);
end;
$migration$;

-- 5. Actualizar bootstrap_user y redeem_invitation_code para respetar expires_at
create or replace function public.redeem_invitation_code(p_code text,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare profile public.profiles%rowtype;invitation public.invitation_codes%rowtype;next_until timestamptz;
begin
 if public.subscription_actor_id() is null or p_user_id is distinct from public.subscription_actor_id() then
   return jsonb_build_object('success',false,'error','Solo podés canjear códigos para tu propia cuenta.');end if;
 select * into profile from public.profiles where id=public.subscription_actor_id() for update;
 if not found then return jsonb_build_object('success',false,'error','No encontramos tu perfil. Contactá a soporte.');end if;
 if profile.subscription_status='suspended' then return jsonb_build_object('success',false,'error','Tu cuenta está pausada. Contactá al administrador para reactivarla.');end if;
 if profile.role='admin' or (profile.subscription_status='active' and profile.subscription_until is null) then
   return jsonb_build_object('success',false,'error','Tu cuenta ya tiene acceso vitalicio. El código no fue utilizado.');end if;
 select * into invitation from public.invitation_codes where upper(trim(code))=upper(trim(p_code)) and not is_used and (expires_at is null or expires_at > clock_timestamp()) for update;
 if not found then return jsonb_build_object('success',false,'error','Código de invitación inválido o no disponible.');end if;
 if invitation.duration_days is null then next_until:=null;
 else next_until:=greatest(clock_timestamp(),profile.subscription_until)+make_interval(days=>invitation.duration_days);end if;
 update public.profiles set subscription_status='active',subscription_until=next_until,updated_at=clock_timestamp() where id=public.subscription_actor_id();
 if not exists(select 1 from public.profiles where id=public.subscription_actor_id() and subscription_status='active' and subscription_until is not distinct from next_until) then
   raise exception 'No se pudo completar la renovación.' using errcode='P0001';end if;
 update public.invitation_codes set is_used=true,used_by=public.subscription_actor_id(),used_at=clock_timestamp() where id=invitation.id;
 return jsonb_build_object('success',true,'duration_days',invitation.duration_days,'subscription_until',next_until);
end $$;

create or replace function public.bootstrap_user()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_code_text text:=upper(trim(coalesce(new.raw_user_meta_data->>'invitation_code','')));
  v_first_name text:=nullif(trim(coalesce(new.raw_user_meta_data->>'first_name','')),'');
  v_last_name text:=nullif(trim(coalesce(new.raw_user_meta_data->>'last_name','')),'');
  v_code public.invitation_codes%rowtype;
  v_status text:='pending_code';
  v_until timestamptz:=null;
  v_count integer;
begin
  if v_code_text<>'' then
    select * into strict v_code from public.invitation_codes
      where upper(trim(code))=v_code_text and not is_used
        and (expires_at is null or expires_at > clock_timestamp()) for update;
    v_status:='active';
    if v_code.duration_days is not null then
      v_until:=now()+make_interval(days=>v_code.duration_days);
    end if;
  end if;
  insert into public.app_settings(user_id) values(new.id);
  insert into public.whatsapp_links(user_id) values(new.id);
  insert into public.profiles(id,email,first_name,last_name,role,subscription_status,subscription_until)
    values(new.id,new.email,v_first_name,v_last_name,'client',v_status,v_until);
  insert into public.categories(user_id, kind, name, color, icon) values
    (new.id,'expense','Alimentación','#20b984','utensils'), (new.id,'expense','Transporte','#655ad8','bus'),
    (new.id,'expense','Vivienda','#f4b44d','home'), (new.id,'expense','Servicios','#4f9bd8','receipt'),
    (new.id,'expense','Salud','#ea7172','heart'), (new.id,'expense','Educación','#65778c','book'),
    (new.id,'expense','Ocio','#d56bb1','party'), (new.id,'expense','Compras','#dc8a43','bag'),
    (new.id,'expense','Impuestos','#78857f','landmark'), (new.id,'expense','Deudas','#b45b5b','card'),
    (new.id,'expense','Otros','#9aa5a1','circle'), (new.id,'income','Sueldo','#20b984','wallet'),
    (new.id,'income','Freelance','#655ad8','briefcase'), (new.id,'income','Ventas','#4f9bd8','tag'),
    (new.id,'income','Rendimientos','#f4b44d','chart'), (new.id,'income','Otros','#9aa5a1','circle');
  get diagnostics v_count=row_count;
  if v_code_text<>'' then
    update public.invitation_codes set is_used=true,used_by=new.id,used_at=now() where id=v_code.id and not is_used;
    if not exists(select 1 from public.invitation_codes where id=v_code.id and is_used
      and used_by=new.id and used_at=now()) then
      raise exception 'REGISTRATION_INITIALIZATION_FAILED';
    end if;
  end if;
  if v_count<>16 or (select count(*) from public.categories where user_id=new.id)<>16
    or not exists(select 1 from public.app_settings where user_id=new.id)
    or not exists(select 1 from public.whatsapp_links where user_id=new.id)
    or not exists(select 1 from public.profiles where id=new.id and role='client'
      and email is not distinct from new.email and first_name is not distinct from v_first_name
      and last_name is not distinct from v_last_name and subscription_status=v_status
      and subscription_until is not distinct from v_until) then
    raise exception 'REGISTRATION_INITIALIZATION_FAILED';
  end if;
  return new;
exception when others then
  raise warning '%',json_build_object('event','bootstrap_user_failed','sqlstate',SQLSTATE)::text;
  raise exception using errcode='P0001',message='REGISTRATION_INITIALIZATION_FAILED',detail='',hint='';
end;
$$;

notify pgrst, 'reload schema';
commit;
