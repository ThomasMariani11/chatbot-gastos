-- Diagnóstico por mensaje, visible solo al administrador y su aviso autorizado.
begin;
set local lock_timeout='5s';
alter table public.whatsapp_message_queue add column ops_issue jsonb, add column ops_issue_at timestamptz;
create index wa_ops_recent_issues on public.whatsapp_message_queue(ops_issue_at desc) where ops_issue_at is not null;

create function public.record_whatsapp_job_issue(p_id uuid,p_token uuid,p_issue jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.whatsapp_message_queue; k text; st text; rs text; pr text; op text; sc integer;
begin
 if jsonb_typeof(p_issue) is distinct from 'object' then raise exception 'OPS_INVALID_ISSUE'; end if;
 k:=p_issue->>'kind'; st:=p_issue->>'stage'; rs:=p_issue->>'reason'; pr:=p_issue->>'provider'; op:=p_issue->>'operation';
 if k is null or k not in ('retry','clarification') or st is null or st not in ('interpret','checkpoint','apply','send','finish')
  or rs is null or rs not in ('configuration','timeout','authentication','rate_limit','unavailable','request_rejected','network','invalid_response','database_read','unknown','media_too_large','payload_too_large','unsupported_media')
  or (pr is not null and pr not in ('gemini','groq','meta_media','meta_send','database'))
  or (op is not null and op not in ('QUEUE_LINK_READ','QUEUE_PROFILE_READ','QUEUE_PROFILE_UNAVAILABLE','QUEUE_CONFIG_READ','QUEUE_SETTINGS_READ','QUEUE_BALANCE_READ','QUEUE_BUDGET_READ','QUEUE_DRAFT_READ')) then raise exception 'OPS_INVALID_ISSUE'; end if;
 if p_issue ? 'status' then
  if jsonb_typeof(p_issue->'status')<>'number' or (p_issue->>'status') !~ '^[0-9]{3}$' then raise exception 'OPS_INVALID_ISSUE'; end if;
  sc:=(p_issue->>'status')::integer;
  if sc not between 100 and 599 then raise exception 'OPS_INVALID_ISSUE'; end if;
 end if;
 select * into q from public.whatsapp_message_queue where id=p_id and queue_version=2;
 if not found or q.status<>'processing' then return; end if;
 perform public.assert_whatsapp_lease(q.wa_id,p_token);
 update public.whatsapp_message_queue set ops_issue=jsonb_strip_nulls(jsonb_build_object('kind',k,'stage',st,'reason',rs,'provider',pr,'status',sc,'operation',op)),ops_issue_at=clock_timestamp() where id=p_id and status='processing';
end $$;
revoke all on function public.record_whatsapp_job_issue(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_whatsapp_job_issue(uuid,uuid,jsonb) to service_role;

-- Devuelve solo identidad del perfil y códigos conocidos; nunca el payload/error crudo.
-- No se resuelve una identidad histórica por el teléfono actual: usar el user_id del trabajo.
create function public.whatsapp_ops_issue_details(p_code text default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if p_limit is null or p_limit not between 1 and 50 or (p_code is not null and p_code not in ('queue_delay','repeated_failures','manual_review','interpretation_fallback','recovery_failure')) then raise exception 'OPS_INVALID_DETAILS_QUERY'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc,x.id),'[]') from (
  select q.id,
   left(regexp_replace(coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),nullif(p.email,''),case when q.user_id is null then 'Persona sin vincular' else 'Cliente sin nombre' end),'[[:cntrl:]]',' ','g'),120) as client_name,
   case when q.user_id is not null then right(q.user_id::text,8) else null end as client_reference,
   coalesce(q.ops_issue_at,q.received_at) as occurred_at,
   case when q.ops_issue_at is null then 'received' else 'error' end as time_source,
   case when q.payload->>'type' in ('text','audio','image') then q.payload->>'type' else 'other' end as source_kind,
   q.status as state,q.attempts,
   q.ops_issue is not null as diagnostic_available,
   q.ops_issue->>'stage' as stage,q.ops_issue->>'reason' as reason,q.ops_issue->>'provider' as provider,
   (q.ops_issue->>'status')::integer as status,q.ops_issue->>'operation' as operation
  from public.whatsapp_message_queue q left join public.profiles p on p.id=q.user_id
  where q.queue_version=2 and (
   (p_code is null and (q.ops_issue_at>=clock_timestamp()-interval '24 hours' or q.status='failed' or (q.status='waiting' and q.pause_reason='manual_review')))
   or (p_code='manual_review' and q.status='waiting' and q.pause_reason='manual_review')
   or (p_code in ('queue_delay','repeated_failures') and q.status in ('pending','processing','failed')
    and ((p_code='queue_delay' and q.received_at<clock_timestamp()-interval '2 minutes') or (p_code='repeated_failures' and q.attempts>=3))
    and (not exists(select 1 from public.whatsapp_message_queue w where w.wa_id=q.wa_id and w.queue_version=2 and w.status='waiting' and w.pause_reason is distinct from 'manual_review')
     or btrim(q.payload->'text'->>'body') ~* '^(retomar|descartar|confirmar|cancelar|si|sí|no|resumen|quit[aá] |el [0-9]|cambi[aá] )'))
   or (p_code='interpretation_fallback' and q.ops_issue->>'kind'='clarification' and q.ops_issue_at>=clock_timestamp()-interval '15 minutes')
  ) order by coalesce(q.ops_issue_at,q.received_at) desc,q.id limit p_limit
 ) x);
end $$;
revoke all on function public.whatsapp_ops_issue_details(text,integer) from public,anon,authenticated,service_role;

-- Los nombres se resuelven al entregar: la bandeja histórica conserva solo códigos/conteos.
create function public.enrich_whatsapp_ops_snapshot(p_snapshot jsonb) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(x||jsonb_build_object('details',public.whatsapp_ops_issue_details(x->>'code',5)) order by x->>'code'),'[]') from jsonb_array_elements(p_snapshot) x
$$;
revoke all on function public.enrich_whatsapp_ops_snapshot(jsonb) from public,anon,authenticated,service_role;

do $upgrade$
declare def text; old text; replacement text;
begin
 select pg_get_functiondef('public.claim_whatsapp_ops_notice(uuid)'::regprocedure) into def;
 old:=$anchor$'snapshot',live_snapshot,'test_sender_digits'$anchor$;
 replacement:=$anchor$'snapshot',public.enrich_whatsapp_ops_snapshot(live_snapshot),'test_sender_digits'$anchor$;
 if position(old in def)=0 then raise exception 'OPS_CLAIM_DEFINITION_UNEXPECTED'; end if;
 execute replace(def,old,replacement);
 select pg_get_functiondef('public.whatsapp_ops_dashboard()'::regprocedure) into def;
 old:=$anchor$'acknowledged_at',acknowledged_at)$anchor$;
 replacement:=$anchor$'acknowledged_at',acknowledged_at,'details',public.whatsapp_ops_issue_details(code,10),'details_total',affected)$anchor$;
 if position(old in def)=0 then raise exception 'OPS_DASHBOARD_DEFINITION_UNEXPECTED'; end if;
 def:=replace(def,old,replacement);
 old:=$anchor$'metrics',(select$anchor$;
 replacement:=$anchor$'recent_issues',public.whatsapp_ops_issue_details(null,50),'metrics',(select$anchor$;
 if position(old in def)=0 then raise exception 'OPS_DASHBOARD_METRICS_UNEXPECTED'; end if;
 execute replace(def,old,replacement);
end $upgrade$;
commit;
