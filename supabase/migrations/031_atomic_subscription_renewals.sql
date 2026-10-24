-- Renovaciones serializadas y canjes autorizados sin abrir la edición de perfiles.
begin;
create role pesito_subscription_writer nologin noinherit;
-- El operador conserva la administración del rol; nunca se concede a roles de API.
grant pesito_subscription_writer to postgres;
grant usage on schema public,auth to pesito_subscription_writer;
grant select on public.profiles,public.invitation_codes to pesito_subscription_writer;
grant update(subscription_status,subscription_until,updated_at) on public.profiles to pesito_subscription_writer;
grant update(is_used,used_by,used_at) on public.invitation_codes to pesito_subscription_writer;
create policy subscription_writer_read_codes on public.invitation_codes for select to pesito_subscription_writer using(true);
create policy subscription_writer_use_codes on public.invitation_codes for update to pesito_subscription_writer using(true) with check(true);

-- INVOKER: current_user identifica al propietario acotado de la RPC, no al dueño del trigger.
create or replace function public.protect_profile_system_fields() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if not public.is_admin() then
   if new.id is distinct from old.id or new.role is distinct from old.role then
     raise exception 'No podés modificar los campos protegidos del perfil.' using errcode='42501';
   end if;
   if current_user<>'pesito_subscription_writer' and new.subscription_status is distinct from old.subscription_status then
     raise exception 'Usá una operación autorizada para cambiar la suscripción.' using errcode='42501';
   end if;
 end if;
 -- Las pantallas antiguas tampoco pueden sobrescribir un vencimiento calculado en servidor.
 if current_user<>'pesito_subscription_writer' and new.subscription_until is distinct from old.subscription_until then
   raise exception 'Usá la renovación segura para cambiar el vencimiento.' using errcode='42501';
 end if;
 new.updated_at:=clock_timestamp();return new;
end $$;
revoke all on function public.protect_profile_system_fields() from public,anon,authenticated,service_role;

create table public.admin_subscription_requests(
 admin_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,
 client_id uuid not null references public.profiles(id) on delete cascade,
 request_hash text not null,
 days_added integer not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(admin_id,request_id)
);
alter table public.admin_subscription_requests enable row level security;
revoke all on public.admin_subscription_requests from public,anon,authenticated,service_role;
grant select,insert on public.admin_subscription_requests to pesito_subscription_writer;
create policy subscription_writer_receipts on public.admin_subscription_requests to pesito_subscription_writer
 using(admin_id=auth.uid() and public.is_admin()) with check(admin_id=auth.uid() and public.is_admin());

create function public.admin_renew_subscription(p_request_id uuid,p_client_id uuid,p_action text,p_days integer default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid();target public.profiles%rowtype;receipt public.admin_subscription_requests%rowtype;
 fingerprint text;added integer:=0;replayed boolean:=false;server_now timestamptz;
begin
 if actor is null then raise exception 'Solo un administrador puede renovar cuentas.' using errcode='42501';end if;
 perform 1 from public.profiles where id=actor and role='admin' for share;
 if not found then raise exception 'Solo un administrador puede renovar cuentas.' using errcode='42501';end if;
 if p_request_id is null or p_client_id is null or p_action is null or p_action not in ('extend','lifetime')
    or (p_action='extend' and (p_days is null or p_days not between 1 and 3650))
    or (p_action='lifetime' and p_days is not null) then
   raise exception 'Revisá la duración: de 1 a 3650 días, o sin vencimiento.' using errcode='22023';
 end if;
 fingerprint:=md5(jsonb_build_array(p_client_id,p_action,p_days)::text);
 perform pg_advisory_xact_lock(hashtextextended('subscription:'||actor::text||':'||p_request_id::text,31));
 select * into receipt from public.admin_subscription_requests where admin_id=actor and request_id=p_request_id;
 if found then
   if receipt.request_hash<>fingerprint then raise exception 'El intento corresponde a otra renovación.' using errcode='22023';end if;
   replayed:=true;added:=receipt.days_added;
 end if;
 select * into target from public.profiles where id=p_client_id and role='client' for update;
 if not found then raise exception 'No encontramos ese cliente.' using errcode='22023';end if;
 if not replayed then
   server_now:=clock_timestamp();
   if target.subscription_until is not null and not isfinite(target.subscription_until) then
     raise exception 'El vencimiento requiere revisión.' using errcode='22023';
   end if;
   if p_action='lifetime' then target.subscription_until:=null;
   elsif not(target.subscription_status in ('active','suspended') and target.subscription_until is null) then
     target.subscription_until:=greatest(server_now,target.subscription_until)+make_interval(days=>p_days);added:=p_days;
   end if;
   if target.subscription_status<>'suspended' then target.subscription_status:='active';end if;
   update public.profiles set subscription_status=target.subscription_status,subscription_until=target.subscription_until,updated_at=server_now where id=p_client_id;
   if not exists(select 1 from public.profiles where id=p_client_id and subscription_status=target.subscription_status and subscription_until is not distinct from target.subscription_until) then
     raise exception 'No se pudo completar la renovación.' using errcode='P0001';end if;
   insert into public.admin_subscription_requests(admin_id,request_id,client_id,request_hash,days_added)
     values(actor,p_request_id,p_client_id,fingerprint,added);
 end if;
 return jsonb_build_object('client_id',target.id,'subscription_status',target.subscription_status,
   'subscription_until',target.subscription_until,'days_added',added,'replayed',replayed);
end $$;
revoke all on function public.admin_renew_subscription(uuid,uuid,text,integer) from public,anon,service_role;
grant execute on function public.admin_renew_subscription(uuid,uuid,text,integer) to authenticated;

-- Conserva firma/errores comerciales de 013; ahora el trigger reconoce esta RPC acotada.
create or replace function public.redeem_invitation_code(p_code text,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare profile public.profiles%rowtype;invitation public.invitation_codes%rowtype;next_until timestamptz;
begin
 if auth.uid() is null or p_user_id is distinct from auth.uid() then
   return jsonb_build_object('success',false,'error','Solo podés canjear códigos para tu propia cuenta.');end if;
 select * into profile from public.profiles where id=auth.uid() for update;
 if not found then return jsonb_build_object('success',false,'error','No encontramos tu perfil. Contactá a soporte.');end if;
 if profile.subscription_status='suspended' then return jsonb_build_object('success',false,'error','Tu cuenta está pausada. Contactá al administrador para reactivarla.');end if;
 if profile.role='admin' or (profile.subscription_status='active' and profile.subscription_until is null) then
   return jsonb_build_object('success',false,'error','Tu cuenta ya tiene acceso vitalicio. El código no fue utilizado.');end if;
 select * into invitation from public.invitation_codes where upper(trim(code))=upper(trim(p_code)) and not is_used for update;
 if not found then return jsonb_build_object('success',false,'error','Código de invitación inválido o ya utilizado.');end if;
 if invitation.duration_days is null then next_until:=null;
 else next_until:=greatest(clock_timestamp(),profile.subscription_until)+make_interval(days=>invitation.duration_days);end if;
 update public.profiles set subscription_status='active',subscription_until=next_until,updated_at=clock_timestamp() where id=auth.uid();
 -- Verifica persistencia antes de consumir: un trigger posterior tampoco puede anunciar éxito falso.
 if not exists(select 1 from public.profiles where id=auth.uid() and subscription_status='active' and subscription_until is not distinct from next_until) then
   raise exception 'No se pudo completar la renovación.' using errcode='P0001';end if;
 update public.invitation_codes set is_used=true,used_by=auth.uid(),used_at=clock_timestamp() where id=invitation.id;
 return jsonb_build_object('success',true,'duration_days',invitation.duration_days,'subscription_until',next_until);
end $$;
revoke all on function public.redeem_invitation_code(text,uuid) from public,anon,service_role;
grant execute on function public.redeem_invitation_code(text,uuid) to authenticated;
-- CREATE solo durante el cambio de propietario; el rol runtime no crea objetos.
grant create on schema public to pesito_subscription_writer;
alter function public.admin_renew_subscription(uuid,uuid,text,integer) owner to pesito_subscription_writer;
alter function public.redeem_invitation_code(text,uuid) owner to pesito_subscription_writer;
revoke create on schema public from pesito_subscription_writer;
commit;
