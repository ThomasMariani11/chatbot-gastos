-- SEC-06 (Fase 2.2): límite de mensajes por número en la recepción de WhatsApp.
-- Decisiones del propietario (26/11/2026):
--   - número no vinculado: hasta 5 mensajes por minuto y 30 en 24 horas; el resto se descarta sin responder;
--   - aviso de "no vinculado" como máximo una vez cada 24 horas (las respuestas a VINCULAR se mandan siempre);
--   - cliente vinculado: hasta 20 mensajes por minuto; al pasarlo se avisa una vez (como máximo una vez por hora)
--     y el resto se descarta.
--
-- Expansiva y compatible: un índice, dos columnas nulas y enqueue_whatsapp_messages redefinida desde su única
-- versión (020) con CREATE OR REPLACE: misma firma, dueño, SECURITY DEFINER, search_path y permisos.
-- Las decisiones viajan como marcas en el payload (pesito_rate_limited, pesito_quiet_not_linked). Un webhook
-- anterior las ignora y se comporta como antes; desplegar el webhook antes que esta migración.
begin;
set local lock_timeout = '5s';

create index if not exists inbound_events_wa_received_idx on public.inbound_events(wa_id, received_at desc);

alter table public.whatsapp_worker_state
  add column if not exists rate_notice_at timestamptz,
  add column if not exists not_linked_notice_at timestamptz;

create or replace function public.enqueue_whatsapp_messages(p_messages jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare m jsonb; s public.whatsapp_worker_state; u uuid; g uuid; v integer; inserted_id uuid; actors text[]:='{}';
  minute_count integer; day_count integer; rate_limited boolean; quiet_not_linked boolean;
begin
  if not (select enabled from public.whatsapp_queue_control where singleton) then
    raise exception 'QUEUE_DISABLED';
  end if;
  if jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages)>100 then raise exception 'QUEUE_INVALID_PAYLOAD'; end if;
  -- Adquirir siempre los actores en el mismo orden: evita deadlocks entre payloads.
  -- El bloqueo de la fila del número también serializa el conteo de SEC-06 entre payloads concurrentes.
  for m in select value from jsonb_array_elements(p_messages) order by value->>'from' loop
    if coalesce(m->>'id','')='' or coalesce(m->>'from','')='' or coalesce(m->>'type','')='' then raise exception 'QUEUE_INVALID_MESSAGE'; end if;
    insert into public.whatsapp_worker_state(wa_id) values(m->>'from') on conflict do nothing;
    perform 1 from public.whatsapp_worker_state where wa_id=m->>'from' for update;
  end loop;
  for m in select value from jsonb_array_elements(p_messages) loop
    -- SEC-06: las marcas son internas; nunca se aceptan desde el mensaje entrante.
    m := m - 'pesito_rate_limited' - 'pesito_quiet_not_linked';
    -- Un reintento de Meta del mismo mensaje no cuenta ni consume avisos.
    if exists(select 1 from public.inbound_events where wa_message_id=m->>'id') then continue; end if;
    select * into s from public.whatsapp_worker_state where wa_id=m->>'from';
    select user_id into u from public.whatsapp_links where wa_id=m->>'from' and status='active';
    -- SEC-06: conteo de mensajes aceptados del número (received_at usa now(), igual que esta ventana).
    select count(*) into minute_count from public.inbound_events
      where wa_id=m->>'from' and received_at > now() - interval '1 minute';
    rate_limited:=false; quiet_not_linked:=false;
    if u is null then
      select count(*) into day_count from public.inbound_events
        where wa_id=m->>'from' and received_at > now() - interval '24 hours';
      if minute_count>=5 or day_count>=30 then continue; end if;
      quiet_not_linked := s.not_linked_notice_at is not null and s.not_linked_notice_at > now() - interval '24 hours';
    elsif minute_count>=20 then
      if s.rate_notice_at is not null and s.rate_notice_at > now() - interval '1 hour' then continue; end if;
      rate_limited:=true;
    end if;
    if rate_limited then m := m || jsonb_build_object('pesito_rate_limited', true); end if;
    if quiet_not_linked then m := m || jsonb_build_object('pesito_quiet_not_linked', true); end if;
    g:=null; v:=null;
    -- Un CONFIRMAR demorado por Meta no puede aprovechar un resumen que todavía
    -- no existía cuando el cliente lo envió. Ante timestamps ambiguos, pedir otro.
    if not s.summary_pending and coalesce(m->>'timestamp','') ~ '^[0-9]{1,12}$'
      and to_timestamp((m->>'timestamp')::double precision)>s.shown_at
      and not exists(select 1 from public.whatsapp_message_queue q
      where q.wa_id=s.wa_id and q.queue_version=2 and q.status not in ('processed','waiting')) then
      select id,version into g,v from public.draft_groups where id=s.shown_group_id and user_id=u
        and version=s.shown_version and status='open';
    end if;
    insert into public.inbound_events(wa_message_id,wa_id,status) values(m->>'id',m->>'from','queued')
      on conflict(wa_message_id) do nothing returning id into inserted_id;
    if inserted_id is null then continue; end if;
    insert into public.whatsapp_message_queue(wa_message_id,wa_id,user_id,payload,queue_version,confirmation_group_id,confirmation_version)
      values(m->>'id',m->>'from',u,m,2,g,v);
    update public.whatsapp_worker_state set last_received_at=clock_timestamp(),
      rate_notice_at=case when rate_limited then now() else rate_notice_at end,
      not_linked_notice_at=case when u is null and not quiet_not_linked then now() else not_linked_notice_at end
      where wa_id=m->>'from';
    actors:=array_append(actors,m->>'from');
  end loop;
  return jsonb_build_object('actors',to_jsonb(actors));
end $$;

do $verify$
declare
  f regprocedure := 'public.enqueue_whatsapp_messages(jsonb)'::regprocedure;
begin
  if not (select prosecdef from pg_proc where oid = f)
     or not (select 'search_path=pg_catalog, public' = any(proconfig) from pg_proc where oid = f) then
    raise exception 'SEC06_FUNCION_INESPERADA';
  end if;
  if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
     or not has_function_privilege('service_role', f, 'execute') then
    raise exception 'SEC06_PERMISOS_FUNCION';
  end if;
  if position('pesito_rate_limited' in pg_get_functiondef(f)) = 0
     or position('pesito_quiet_not_linked' in pg_get_functiondef(f)) = 0 then
    raise exception 'SEC06_DEFINICION_NO_APLICADA';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_worker_state'
      and column_name in ('rate_notice_at', 'not_linked_notice_at')) <> 2
     or to_regclass('public.inbound_events_wa_received_idx') is null then
    raise exception 'SEC06_ESQUEMA_INCOMPLETO';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
commit;
