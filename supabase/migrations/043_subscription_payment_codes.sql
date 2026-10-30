-- BE-19: solicitud explícita, pago confirmado y código nominativo; sin activar membresía al emitir.
begin;
set local lock_timeout='5s';

alter table public.invitation_codes add column renewal_user_id uuid references public.profiles(id);
create table public.subscription_renewal_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 wa_id text not null, linked_at timestamptz,
 state text not null default 'requested' check(state in ('requested','paid','redeemed')),
 requested_at timestamptz not null default clock_timestamp(),
 last_customer_at timestamptz,
 paid_at timestamptz, paid_by uuid references public.profiles(id),
 duration_days integer check(duration_days between 1 and 3650),
 code_id uuid unique references public.invitation_codes(id),
 redeemed_at timestamptz,
 check ((state='requested' and code_id is null and paid_at is null) or
        (state in ('paid','redeemed') and code_id is not null and paid_at is not null and paid_by is not null))
);
create unique index subscription_renewal_one_open on public.subscription_renewal_requests(user_id) where state<>'redeemed';
create table public.subscription_renewal_notices (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique references public.subscription_renewal_requests(id) on delete cascade,
 state text not null default 'pending' check(state in ('pending','waiting_window','sending','sent','uncertain','blocked','failed','cancelled')),
 attempts integer not null default 0,
 available_at timestamptz not null default clock_timestamp(),
 token uuid, lease_until timestamptz,
 created_at timestamptz not null default clock_timestamp(), finished_at timestamptz
);
create index subscription_renewal_notice_due on public.subscription_renewal_notices(available_at) where state='pending';
alter table public.subscription_renewal_requests enable row level security;
alter table public.subscription_renewal_notices enable row level security;
revoke all on public.subscription_renewal_requests,public.subscription_renewal_notices from public,anon,authenticated,service_role;

create function public.subscription_renewal_window(p_request uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.subscription_renewal_requests r
 join public.whatsapp_links w on w.user_id=r.user_id and w.wa_id=r.wa_id and w.status='active'
 where r.id=p_request and w.linked_at is not distinct from r.linked_at
 and r.last_customer_at between clock_timestamp()-interval '23 hours 55 minutes' and clock_timestamp())
$$;

-- Solo invocada por apply_whatsapp_job bajo el lease del mensaje verificado.
create function public.register_subscription_renewal(p_job uuid) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.whatsapp_message_queue; w public.whatsapp_links; p public.profiles;
 r public.subscription_renewal_requests; customer_at timestamptz; contact text; alias_value text;
begin
 select * into q from public.whatsapp_message_queue where id=p_job;
 select * into w from public.whatsapp_links where wa_id=q.wa_id and status='active';
 if w.user_id is null or (q.user_id is not null and q.user_id<>w.user_id) then
  return 'Tu número no está vinculado a esa cuenta. Revisá el vínculo desde Ajustes.'; end if;
 select * into p from public.profiles where id=w.user_id for update;
 if p.id is null or p.role<>'client' then return 'Esta solicitud es para cuentas de cliente.'; end if;
 if p.subscription_status='suspended' then return 'Tu cuenta está pausada. Contactá al administrador antes de renovar.'; end if;
 if p.subscription_status='active' and p.subscription_until is null then return 'Tu cuenta ya tiene acceso sin vencimiento.'; end if;
 if exists(select 1 from public.system_config where key='bot_active' and value='false') then return 'El bot está temporalmente pausado. Intentá más tarde.'; end if;
 if exists(select 1 from public.app_settings where user_id=p.id and not whatsapp_responses_enabled) then return null; end if;
 if q.payload->>'timestamp' ~ '^[0-9]{1,12}$' then customer_at:=to_timestamp((q.payload->>'timestamp')::double precision); end if;
 if customer_at>clock_timestamp() then customer_at:=null; end if;
 select * into r from public.subscription_renewal_requests where user_id=p.id and state<>'redeemed' for update;
 if found then
  if r.state='paid' and (r.wa_id<>w.wa_id or r.linked_at is distinct from w.linked_at) then
   return 'Tu vínculo cambió. Pedile al administrador que revise el envío de tu código.';
  end if;
  update public.subscription_renewal_requests set wa_id=w.wa_id,linked_at=w.linked_at,
   last_customer_at=greatest(last_customer_at,customer_at) where id=r.id;
 else
  insert into public.subscription_renewal_requests(user_id,wa_id,linked_at,last_customer_at)
   values(p.id,w.wa_id,w.linked_at,customer_at) returning * into r;
 end if;
 if r.state='paid' then
  update public.subscription_renewal_notices set state='pending',available_at=clock_timestamp()
   where request_id=r.id and state='waiting_window';
  return 'Tu pago ya está confirmado. Si el código estaba esperando la ventana de WhatsApp, lo enviaremos ahora. Canjealo en Ajustes de la app. Si no llegó, contactá al administrador.';
 end if;
 select value into contact from public.system_config where key='support_phone';
 select value into alias_value from public.system_config where key='payment_alias';
 return 'Registré tu solicitud de renovación. El administrador verifica el pago y te envía por acá un código para canjear en Ajustes. La suscripción se renueva al canjearlo.'
  ||case when nullif(btrim(alias_value),'') is not null then E'\n\nAlias para transferencias: '||btrim(alias_value) else '' end
  ||case when nullif(regexp_replace(contact,'[^0-9]','','g'),'') is not null then E'\nSoporte: https://wa.me/'||regexp_replace(contact,'[^0-9]','','g') else '' end
  ||E'\nSi pasan 24 horas, volvé a escribir RENOVAR para habilitar el envío. No cargué movimientos de este mensaje.';
end $$;

create function public.admin_confirm_renewal_payment(p_request_id uuid,p_days integer default 30) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.subscription_renewal_requests; p public.profiles; actor uuid:=auth.uid();
 new_code_id uuid; generated text;
begin
 if actor is null or not public.is_admin() then raise exception 'Solo un administrador puede confirmar pagos.' using errcode='42501'; end if;
 if p_days is not null and p_days not between 1 and 3650 then raise exception 'Elegí entre 1 y 3650 días, o sin vencimiento.' using errcode='22023'; end if;
 -- Mismo orden de bloqueo que el canje: perfil, solicitud, código.
 select * into r from public.subscription_renewal_requests where id=p_request_id;
 if not found then raise exception 'No encontramos la solicitud.' using errcode='22023'; end if;
 select * into p from public.profiles where id=r.user_id for update;
 select * into r from public.subscription_renewal_requests where id=p_request_id for update;
 if r.state<>'requested' then
  if r.duration_days is distinct from p_days then raise exception 'Ese pago ya fue confirmado con otra duración.' using errcode='22023'; end if;
  return jsonb_build_object('request_id',r.id,'replayed',true,'state',r.state);
 end if;
 if p.id is null or p.role<>'client' or p.subscription_status='suspended' or (p.subscription_status='active' and p.subscription_until is null) then
  raise exception 'Revisá el estado de la cuenta antes de confirmar el pago.' using errcode='22023'; end if;
 if not exists(select 1 from public.whatsapp_links where user_id=p.id and status='active' and wa_id=r.wa_id and linked_at is not distinct from r.linked_at) then
  raise exception 'El vínculo cambió. El cliente debe volver a escribir RENOVAR.' using errcode='22023'; end if;
 generated:='PR-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,24));
 insert into public.invitation_codes(code,duration_days,created_by,renewal_user_id)
  values(generated,p_days,actor,p.id) returning id into new_code_id;
 update public.subscription_renewal_requests set state='paid',duration_days=p_days,paid_by=actor,paid_at=clock_timestamp(),code_id=new_code_id
  where id=r.id;
 insert into public.subscription_renewal_notices(request_id,state)
  values(r.id,case when public.subscription_renewal_window(r.id) then 'pending' else 'waiting_window' end);
 return jsonb_build_object('request_id',r.id,'replayed',false,'state','paid');
end $$;

-- El canje existente conserva su ACL y transacción; el trigger protege códigos nominativos,
-- incluso ante versiones antiguas del runtime y bootstrap_user.
create function public.guard_renewal_code() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='DELETE' then
  if old.renewal_user_id is not null then raise exception 'Ese código corresponde a un pago. Requiere revisión administrativa.' using errcode='22023'; end if;
  return old;
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
create trigger guard_renewal_code before update or delete on public.invitation_codes for each row execute function public.guard_renewal_code();
create function public.finish_renewal_redemption() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.renewal_user_id is not null and new.is_used and not old.is_used then
  update public.subscription_renewal_requests set state='redeemed',redeemed_at=clock_timestamp() where code_id=new.id and user_id=new.used_by;
  update public.subscription_renewal_notices set state='cancelled',finished_at=clock_timestamp()
   where request_id in(select id from public.subscription_renewal_requests where code_id=new.id) and state in('pending','waiting_window','blocked','failed');
 end if;
 return new;
end $$;
create trigger finish_renewal_redemption after update on public.invitation_codes for each row execute function public.finish_renewal_redemption();

create function public.claim_subscription_renewal_notice(p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n public.subscription_renewal_notices; r public.subscription_renewal_requests; c public.invitation_codes; expected text;
begin
 if p_token is null then raise exception 'Token requerido.'; end if;
 update public.subscription_renewal_notices set state='uncertain',finished_at=clock_timestamp(),lease_until=null where state='sending' and lease_until<clock_timestamp();
 if not (select enabled from public.whatsapp_queue_control where singleton) or exists(select 1 from public.system_config where key='bot_active' and value='false') then return null; end if;
 select verified_test_sender_digits into expected from public.whatsapp_ops_config where singleton;
 if expected is null then return null; end if;
 select * into n from public.subscription_renewal_notices where state='pending' and available_at<=clock_timestamp() order by available_at,id limit 1 for update skip locked;
 if not found then return null; end if;
 select * into r from public.subscription_renewal_requests where id=n.request_id;
 select * into c from public.invitation_codes where id=r.code_id;
 if r.state<>'paid' or c.id is null or c.is_used then
  update public.subscription_renewal_notices set state='cancelled',finished_at=clock_timestamp() where id=n.id; return null; end if;
 if not exists(select 1 from public.whatsapp_links w join public.profiles p on p.id=w.user_id
   join public.app_settings a on a.user_id=p.id where p.id=r.user_id and p.role='client' and p.subscription_status<>'suspended'
   and a.whatsapp_responses_enabled and w.status='active' and w.wa_id=r.wa_id and w.linked_at is not distinct from r.linked_at) then
  update public.subscription_renewal_notices set state='blocked',finished_at=clock_timestamp() where id=n.id; return null; end if;
 if not public.subscription_renewal_window(r.id) then
  update public.subscription_renewal_notices set state='waiting_window' where id=n.id; return null; end if;
 update public.subscription_renewal_notices set state='sending',attempts=attempts+1,token=p_token,lease_until=clock_timestamp()+interval '2 minutes' where id=n.id;
 return jsonb_build_object('id',n.id,'to',r.wa_id,'test_sender_digits',expected,'code',c.code,'duration_days',r.duration_days);
end $$;

-- Revalidación después de verificar Meta, justo antes de iniciar el envío externo.
create function public.authorize_subscription_renewal_notice(p_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n public.subscription_renewal_notices; r public.subscription_renewal_requests;
begin
 select * into n from public.subscription_renewal_notices where id=p_id and token=p_token and state='sending' and lease_until>clock_timestamp() for update;
 if not found then return false; end if;
 select * into r from public.subscription_renewal_requests where id=n.request_id;
 if r.state<>'paid' or not exists(select 1 from public.invitation_codes where id=r.code_id and not is_used) then
  update public.subscription_renewal_notices set state='cancelled',finished_at=clock_timestamp(),lease_until=null where id=n.id; return false; end if;
 if not public.subscription_renewal_window(r.id) then
  update public.subscription_renewal_notices set state='waiting_window',lease_until=null where id=n.id; return false; end if;
 if not (select enabled from public.whatsapp_queue_control where singleton) or exists(select 1 from public.system_config where key='bot_active' and value='false')
  or not exists(select 1 from public.profiles p join public.app_settings a on a.user_id=p.id where p.id=r.user_id and p.role='client' and p.subscription_status<>'suspended' and a.whatsapp_responses_enabled) then
  update public.subscription_renewal_notices set state='blocked',finished_at=clock_timestamp(),lease_until=null where id=n.id; return false; end if;
 return true;
end $$;

create function public.finish_subscription_renewal_notice(p_id uuid,p_token uuid,p_outcome text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n public.subscription_renewal_notices;
begin
 select * into n from public.subscription_renewal_notices where id=p_id and token=p_token for update;
 if not found or n.state<>'sending' then return; end if;
 if n.lease_until<=clock_timestamp() then p_outcome:='uncertain'; end if;
 if p_outcome not in('sent','failed','uncertain','blocked') or p_outcome is null then raise exception 'Resultado no válido.'; end if;
 update public.subscription_renewal_notices set state=case when p_outcome='failed' and n.attempts<5 then 'pending' else p_outcome end,
  available_at=clock_timestamp()+make_interval(secs=>least(300,15*(2^least(n.attempts,4))::integer)),
  lease_until=null,finished_at=case when p_outcome='failed' and n.attempts<5 then null else clock_timestamp() end where id=n.id;
end $$;

create function public.admin_subscription_renewals(p_limit integer default 50,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Solo un administrador puede consultar solicitudes.' using errcode='42501'; end if;
 if p_limit not between 1 and 100 or p_offset<0 or p_limit is null or p_offset is null then raise exception 'Página no válida.' using errcode='22023'; end if;
 return jsonb_build_object('total',(select count(*) from public.subscription_renewal_requests),'items',
  (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select r.id,r.user_id,nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),'') as client_name,
   r.state,r.requested_at,r.paid_at,r.duration_days,r.redeemed_at,n.state as delivery_state,n.attempts,n.finished_at,
   public.subscription_renewal_window(r.id) as window_open
   from public.subscription_renewal_requests r join public.profiles p on p.id=r.user_id left join public.subscription_renewal_notices n on n.request_id=r.id
   order by (r.state<>'redeemed') desc,r.requested_at desc,r.id limit p_limit offset p_offset) x));
end $$;

-- El comando atraviesa la cola existente; nunca una mutación anticipada desde el parser.
do $apply$ declare f text; anchor text:=$a$  elsif action='link' then$a$;
begin
 select pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure) into f;
 if position(anchor in f)=0 then raise exception 'BE19_APPLY_DEFINITION_UNEXPECTED'; end if;
 execute replace(f,anchor,E'  elsif action=''renewal_request'' then\n    reply:=public.register_subscription_renewal(q.id);\n'||anchor);
end $apply$;

-- Check público: conservar rate limiting y errores uniformes; el código nominativo no sirve para registro.
do $check$ declare f text; anchor text:=$a$if not found or v_code.is_used or (v_code.expires_at is not null and v_code.expires_at <= clock_timestamp()) then$a$;
begin
 select pg_get_functiondef('public.check_invitation_code(text)'::regprocedure) into f;
 if position(anchor in f)=0 then raise exception 'BE19_CHECK_DEFINITION_UNEXPECTED'; end if;
 execute replace(f,anchor,'if not found or v_code.is_used or (v_code.expires_at is not null and v_code.expires_at <= clock_timestamp()) or (v_code.renewal_user_id is not null and v_code.renewal_user_id is distinct from auth.uid()) then');
end $check$;

-- Recuperación privada existente: no pg_net ni secretos nuevos/persistidos.
do $recovery$ declare f text; anchor text:=$a$or not (exists(select 1 from public.due_whatsapp_actors()) or exists(select 1 from public.whatsapp_ops_notifications where state='pending' and available_at<=clock_timestamp()))$a$;
begin
 select pg_get_functiondef('public.dispatch_whatsapp_queue_recovery()'::regprocedure) into f;
 if position(anchor in f)=0 then raise exception 'BE19_RECOVERY_DEFINITION_UNEXPECTED'; end if;
 execute replace(f,anchor,'or not (exists(select 1 from public.due_whatsapp_actors()) or exists(select 1 from public.whatsapp_ops_notifications where state=''pending'' and available_at<=clock_timestamp()) or exists(select 1 from public.subscription_renewal_notices where (state=''pending'' and available_at<=clock_timestamp()) or (state=''sending'' and lease_until<clock_timestamp())))');
end $recovery$;
create function public.wake_subscription_renewals() returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Solo un administrador puede despertar el envío.' using errcode='42501'; end if;
 -- RPC posterior al COMMIT de confirmar pago; cron cubre cierre de pestaña o pérdida de red.
 perform public.dispatch_whatsapp_queue_recovery(); return true;
exception when insufficient_privilege then raise;
 when others then return false;
end $$;

-- RENOVAR no queda bloqueado detrás de un borrador stale/capacity.
do $eligibility$ declare f text; anchor text:=$a$ -- Respuestas breves a faltantes$a$;
begin
 select pg_get_functiondef('public.whatsapp_can_pass_waiting(jsonb)'::regprocedure) into f;
 if position(anchor in f)=0 then raise exception 'BE19_ELIGIBILITY_DEFINITION_UNEXPECTED'; end if;
 execute replace(f,anchor,E' if t ~ ''^(quiero )?renovar$'' then return true; end if;\n'||anchor);
end $eligibility$;

do $acl$ declare f record; begin
 for f in select oid::regprocedure as sig from pg_proc where pronamespace='public'::regnamespace and proname in
 ('subscription_renewal_window','register_subscription_renewal','admin_confirm_renewal_payment','guard_renewal_code','finish_renewal_redemption','claim_subscription_renewal_notice','authorize_subscription_renewal_notice','finish_subscription_renewal_notice','admin_subscription_renewals','wake_subscription_renewals') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 end loop;
end $acl$;
grant execute on function public.admin_confirm_renewal_payment(uuid,integer),public.admin_subscription_renewals(integer,integer),public.wake_subscription_renewals() to authenticated;
grant execute on function public.claim_subscription_renewal_notice(uuid),public.authorize_subscription_renewal_notice(uuid,uuid),public.finish_subscription_renewal_notice(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
