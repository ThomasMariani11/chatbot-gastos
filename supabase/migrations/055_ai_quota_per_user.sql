-- SEC-04 (Fase 1.4): cupo diario de IA por cliente, además del global compartido (035).
-- Decisiones del propietario (25/11/2026): un solo límite por cliente para todos; qwen 15 y whisper 25 por día;
-- el admin queda exento del límite por cliente (el global sí lo alcanza); límites editables desde el panel con MFA.
--
-- Expansiva y compatible: agrega una columna con valor, una tabla nueva y una RPC de administración.
-- reserve_whatsapp_ai_quota y whatsapp_ai_quota_dashboard se redefinen desde su única versión vigente (035)
-- con CREATE OR REPLACE: misma firma, dueño, SECURITY DEFINER, search_path y permisos.
-- El global no cambia. Un bot anterior a SEC-04 trataría 'user_exhausted' como error de configuración:
-- desplegar el webhook antes que esta migración.
begin;
set local lock_timeout = '5s';

-- 1. Límite por cliente en la política de cada carril.
alter table public.ai_quota_policy add column per_user_daily_limit integer;
update public.ai_quota_policy set per_user_daily_limit = case lane when 'qwen' then 15 when 'whisper' then 25 end;
alter table public.ai_quota_policy
  alter column per_user_daily_limit set not null,
  add constraint ai_quota_policy_per_user_daily_limit_check check (per_user_daily_limit between 1 and 10000);

-- 2. Contador diario por cliente y carril. Sin acceso directo para ningún rol de la API (igual que las tablas de 035).
create table public.ai_quota_user_days(
  day date not null,
  lane text not null references public.ai_quota_policy(lane),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reserved integer not null default 0 check (reserved >= 0),
  primary key (day, lane, user_id)
);
alter table public.ai_quota_user_days enable row level security;
revoke all on public.ai_quota_user_days from public, anon, authenticated, service_role;

-- 3. Reserva: orden heredado de 035 (already_reserved → exhausted) y luego el control por cliente.
-- Un rechazo por cliente no reserva ni suma nada. El admin no se controla ni se cuenta por cliente.
-- Orden de bloqueos: política → día global → día del cliente (siempre el mismo, sin interbloqueos).
create or replace function public.reserve_whatsapp_ai_quota(p_id uuid,p_token uuid,p_attempt integer,p_lane text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.whatsapp_message_queue;u uuid;cfg public.ai_quota_policy;d date;n integer;un integer;valid_account boolean;is_admin_account boolean;
begin
 select * into q from public.whatsapp_message_queue where id=p_id;
 if not found then raise exception 'AI_QUOTA_JOB_UNAVAILABLE';end if;
 u:=public.assert_whatsapp_lease(q.wa_id,p_token);
 select * into q from public.whatsapp_message_queue where id=p_id for update;
 if q.queue_version<>2 or q.status<>'processing' or q.effect_applied or q.attempts is distinct from p_attempt or p_attempt is null or p_attempt<1
   or (q.user_id is not null and q.user_id is distinct from u) then raise exception 'AI_QUOTA_JOB_UNAVAILABLE';end if;
 select role='admin' or (role='client' and subscription_status='active' and (subscription_until is null or subscription_until>clock_timestamp())),role='admin'
   into valid_account,is_admin_account from public.profiles where id=u for share;
 if valid_account is distinct from true then raise exception 'AI_QUOTA_ACCOUNT_UNAVAILABLE';end if;
 -- No hay una ruta a Gemini habilitada en este perfil Free de beta.
 select * into cfg from public.ai_quota_policy where lane=p_lane for update;
 if not found or not cfg.enabled then return jsonb_build_object('allowed',false,'reason','provider_disabled');end if;
 d:=(clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date;
 insert into public.ai_quota_days(day,lane)values(d,p_lane) on conflict do nothing;
 select reserved into n from public.ai_quota_days where day=d and lane=p_lane for update;
 if exists(select 1 from public.ai_quota_reservations where job_id=p_id and attempt=p_attempt and lane=p_lane) then
  return jsonb_build_object('allowed',false,'reason','already_reserved');end if;
 if n>=cfg.daily_limit then return jsonb_build_object('allowed',false,'reason','exhausted','used',n,'limit',cfg.daily_limit,'day',d);end if;
 if is_admin_account is distinct from true then
  insert into public.ai_quota_user_days(day,lane,user_id)values(d,p_lane,u) on conflict do nothing;
  select reserved into un from public.ai_quota_user_days where day=d and lane=p_lane and user_id=u for update;
  if un>=cfg.per_user_daily_limit then
   return jsonb_build_object('allowed',false,'reason','user_exhausted','used',un,'limit',cfg.per_user_daily_limit,'day',d);end if;
 end if;
 insert into public.ai_quota_reservations(job_id,attempt,lane,day)values(p_id,p_attempt,p_lane,d);
 update public.ai_quota_days set reserved=reserved+1 where day=d and lane=p_lane returning reserved into n;
 if is_admin_account is distinct from true then
  update public.ai_quota_user_days set reserved=reserved+1 where day=d and lane=p_lane and user_id=u;
 end if;
 return jsonb_build_object('allowed',true,'used',n,'limit',cfg.daily_limit,'day',d);
end $$;

-- 4. Panel: agrega por carril el límite por cliente y los 5 clientes con más reservas del día.
create or replace function public.whatsapp_ai_quota_dashboard() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d date:=(clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'AI_QUOTA_ADMIN_REQUIRED';end if;
 return jsonb_build_object('day',d,'resets_at',((d+1)::timestamp at time zone 'America/Argentina/Buenos_Aires'),
 'lanes',(select jsonb_agg(jsonb_build_object('lane',p.lane,'used',coalesce(c.reserved,0),'limit',p.daily_limit,'enabled',p.enabled,
 'level',case when coalesce(c.reserved,0)>=p.daily_limit then 'exhausted' when coalesce(c.reserved,0)*100>=p.daily_limit*90 then 'critical' when coalesce(c.reserved,0)*100>=p.daily_limit*75 then 'warning' else 'ok' end,
 'per_user_limit',p.per_user_daily_limit,
 'top_users',coalesce((select jsonb_agg(jsonb_build_object('user_id',t.user_id,'name',t.name,'used',t.reserved) order by t.reserved desc,t.user_id)
   from (select ud.user_id,ud.reserved,coalesce(nullif(btrim(concat_ws(' ',pr.first_name,pr.last_name)),''),pr.email,'') as name
         from public.ai_quota_user_days ud join public.profiles pr on pr.id=ud.user_id
         where ud.day=d and ud.lane=p.lane and ud.reserved>0
         order by ud.reserved desc,ud.user_id limit 5) t),'[]'::jsonb)) order by p.lane)
 from public.ai_quota_policy p left join public.ai_quota_days c on c.lane=p.lane and c.day=d));
end $$;

-- 5. Edición de límites desde el panel (admin con AAL2). Rige desde la próxima reserva.
create function public.admin_update_ai_quota_policy(p_lane text, p_daily_limit integer, p_per_user_daily_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.ai_quota_policy%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Verificá tu identidad con el código de dos pasos para cambiar los límites de IA.' using errcode = '42501';
  end if;
  if p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 10000
     or p_per_user_daily_limit is null or p_per_user_daily_limit < 1 or p_per_user_daily_limit > 10000 then
    raise exception 'Los límites deben estar entre 1 y 10000.' using errcode = '22023';
  end if;
  if p_per_user_daily_limit > p_daily_limit then
    raise exception 'El límite por cliente no puede superar el límite global.' using errcode = '22023';
  end if;
  update public.ai_quota_policy
    set daily_limit = p_daily_limit, per_user_daily_limit = p_per_user_daily_limit
    where lane = p_lane
    returning * into v_row;
  if not found then
    raise exception 'El carril no existe.' using errcode = '22023';
  end if;
  return jsonb_build_object('lane', v_row.lane, 'daily_limit', v_row.daily_limit,
                            'per_user_daily_limit', v_row.per_user_daily_limit, 'enabled', v_row.enabled);
end;
$$;

revoke all on function public.admin_update_ai_quota_policy(text, integer, integer) from public, anon;
grant execute on function public.admin_update_ai_quota_policy(text, integer, integer) to authenticated;

-- Verificación.
do $verify$
declare
  f regprocedure;
begin
  foreach f in array array['public.reserve_whatsapp_ai_quota(uuid,uuid,integer,text)'::regprocedure,
                           'public.whatsapp_ai_quota_dashboard()'::regprocedure,
                           'public.admin_update_ai_quota_policy(text,integer,integer)'::regprocedure] loop
    if not (select prosecdef from pg_proc where oid = f)
       or not (select 'search_path=pg_catalog, public' = any(proconfig) from pg_proc where oid = f) then
      raise exception 'SEC04_FUNCION_INESPERADA %', f;
    end if;
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'SEC04_PERMISOS_ANON %', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.reserve_whatsapp_ai_quota(uuid,uuid,integer,text)', 'execute')
     or not has_function_privilege('service_role', 'public.reserve_whatsapp_ai_quota(uuid,uuid,integer,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.whatsapp_ai_quota_dashboard()', 'execute')
     or has_function_privilege('service_role', 'public.whatsapp_ai_quota_dashboard()', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_update_ai_quota_policy(text,integer,integer)', 'execute') then
    raise exception 'SEC04_PERMISOS_FUNCION';
  end if;
  if position('user_exhausted' in pg_get_functiondef('public.reserve_whatsapp_ai_quota(uuid,uuid,integer,text)'::regprocedure)) = 0
     or position('top_users' in pg_get_functiondef('public.whatsapp_ai_quota_dashboard()'::regprocedure)) = 0 then
    raise exception 'SEC04_DEFINICION_NO_APLICADA';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.ai_quota_user_days'::regclass)
     or has_any_column_privilege('anon', 'public.ai_quota_user_days', 'select')
     or has_any_column_privilege('authenticated', 'public.ai_quota_user_days', 'select')
     or has_any_column_privilege('service_role', 'public.ai_quota_user_days', 'select')
     or has_any_column_privilege('authenticated', 'public.ai_quota_user_days', 'insert')
     or has_any_column_privilege('authenticated', 'public.ai_quota_user_days', 'update')
     or has_any_column_privilege('authenticated', 'public.ai_quota_policy', 'update') then
    raise exception 'SEC04_PERMISOS_TABLAS';
  end if;
  if exists (select 1 from public.ai_quota_policy where per_user_daily_limit is null)
     or (select count(*) from public.ai_quota_policy where lane in ('qwen', 'whisper')) <> 2 then
    raise exception 'SEC04_POLITICA_INCOMPLETA';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
commit;
