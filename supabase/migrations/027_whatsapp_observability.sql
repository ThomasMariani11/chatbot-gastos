-- INF-14: métricas agregadas, incidentes y avisos durables. Sin contenido de clientes.
begin;
set local lock_timeout='5s';
alter table public.whatsapp_message_queue add column content_redacted_at timestamptz;
create index wa_ops_actionable_age on public.whatsapp_message_queue(received_at) where queue_version=2 and status in ('pending','processing','failed');
create index wa_ops_retention on public.whatsapp_message_queue(processed_at) where queue_version=2 and status='processed' and content_redacted_at is null;
create table public.whatsapp_ops_config (
 singleton boolean primary key default true check(singleton),notification_user_id uuid references auth.users(id) on delete set null,
 whatsapp_enabled boolean not null default false,
 verified_test_sender_digits text check(verified_test_sender_digits ~ '^1555[0-9]{7}$'),
 last_notice_created_at timestamptz,last_scan_at timestamptz,
 retention_enabled boolean not null default false,retention_days integer not null default 30 check(retention_days>=30),last_retention_at timestamptz
);
insert into public.whatsapp_ops_config(singleton) values(true);
create table public.whatsapp_ops_metrics (
 bucket timestamptz not null,event text not null,
 provider text not null default '',reason text not null default '',stage text not null default '',source_kind text not null default '',status integer not null default 0,
 samples bigint not null,duration_total_ms numeric not null,duration_max_ms numeric not null,operations_total bigint not null,attempts_total bigint not null,
 primary key(bucket,event,provider,reason,stage,source_kind,status)
);
create table public.whatsapp_ops_alerts (
 code text primary key check(code in ('queue_delay','repeated_failures','manual_review','recovery_failure','interpretation_fallback')),
 severity text not null check(severity in ('warning','critical')),
 affected integer not null,oldest_seconds bigint not null default 0,
 fingerprint text not null,generation bigint not null default 1,notification_generation bigint not null default 0,
 first_seen_at timestamptz not null,last_seen_at timestamptz not null,resolved_at timestamptz,acknowledged_at timestamptz
);
create table public.whatsapp_ops_notifications (
 id uuid primary key default gen_random_uuid(),recipient_user_id uuid not null references auth.users(id) on delete cascade,
 snapshot jsonb not null,state text not null default 'pending' check(state in ('pending','sending','sent','failed','uncertain','cancelled','blocked')),
 attempts integer not null default 0,available_at timestamptz not null default clock_timestamp(),
 token uuid,lease_until timestamptz,created_at timestamptz not null default clock_timestamp(),finished_at timestamptz
);
create index wa_ops_notice_due on public.whatsapp_ops_notifications(available_at) where state='pending';
-- Tablas internas: solo RPC con contratos explícitos, incluso para el backend.
alter table public.whatsapp_ops_config enable row level security;
alter table public.whatsapp_ops_metrics enable row level security;
alter table public.whatsapp_ops_alerts enable row level security;
alter table public.whatsapp_ops_notifications enable row level security;
revoke all on public.whatsapp_ops_config,public.whatsapp_ops_metrics,public.whatsapp_ops_alerts,public.whatsapp_ops_notifications from public,anon,authenticated,service_role;

create function public.record_whatsapp_ops_metrics(p_samples jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare item jsonb; ev text; pr text; rs text; st text; sk text; sc integer; d numeric; op bigint; at bigint;
begin
 if jsonb_typeof(p_samples) is distinct from 'array' or jsonb_array_length(p_samples)>256 then raise exception 'OPS_INVALID_METRICS'; end if;
 for item in select value from jsonb_array_elements(p_samples) loop
  ev:=coalesce(item->>'event',''); pr:=coalesce(item->>'provider',''); rs:=coalesce(item->>'reason',''); st:=coalesce(item->>'stage',''); sk:=coalesce(item->>'source_kind','');
  if ev not in ('queue_worker','queue_wait','queue_interpret','queue_send','queue_message','queue_retry','queue_clarification')
   or pr not in ('','gemini','groq','meta_media','meta_send','database')
   or rs not in ('','configuration','timeout','authentication','rate_limit','unavailable','request_rejected','network','invalid_response','database_read','unknown','media_too_large','payload_too_large','unsupported_media')
   or st not in ('','interpret','checkpoint','apply','send','finish') or sk not in ('','text','audio','image') then raise exception 'OPS_INVALID_METRIC'; end if;
  if exists(select 1 from jsonb_each(item) v where v.key in ('status','duration_ms','operations','attempts') and jsonb_typeof(v.value)<>'number') then raise exception 'OPS_INVALID_METRIC'; end if;
  sc:=coalesce((item->>'status')::integer,0);d:=coalesce((item->>'duration_ms')::numeric,0);op:=coalesce((item->>'operations')::bigint,0);at:=coalesce((item->>'attempts')::bigint,0);
  if (sc<>0 and sc not between 100 and 599) or d not between 0 and 2147483647 or op not between 0 and 20 or at not between 0 and 1000000 then raise exception 'OPS_INVALID_METRIC'; end if;
  insert into public.whatsapp_ops_metrics values(date_trunc('minute',clock_timestamp()),ev,pr,rs,st,sk,sc,1,d,d,op,at)
  on conflict(bucket,event,provider,reason,stage,source_kind,status) do update set samples=whatsapp_ops_metrics.samples+1,duration_total_ms=whatsapp_ops_metrics.duration_total_ms+excluded.duration_total_ms,duration_max_ms=greatest(whatsapp_ops_metrics.duration_max_ms,excluded.duration_max_ms),operations_total=whatsapp_ops_metrics.operations_total+excluded.operations_total,attempts_total=whatsapp_ops_metrics.attempts_total+excluded.attempts_total;
 end loop;
end $$;

create function public.whatsapp_ops_window_open(p_user_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.whatsapp_message_queue q join public.whatsapp_links w on w.wa_id=q.wa_id
  where w.user_id=p_user_id and w.status='active' and
  case when q.payload->>'timestamp' ~ '^[0-9]{1,12}$' then to_timestamp((q.payload->>'timestamp')::double precision) else null end
  between clock_timestamp()-interval '23 hours 55 minutes' and clock_timestamp())
$$;
revoke all on function public.whatsapp_ops_window_open(uuid) from public,anon,authenticated,service_role;

create function public.refresh_whatsapp_ops_health() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record;cfg public.whatsapp_ops_config;notice jsonb; now_at timestamptz:=clock_timestamp();
begin
 select * into cfg from public.whatsapp_ops_config where singleton for update;
 -- Una entrega interrumpida queda incierta: no se reenvía automáticamente.
 with expired as (update public.whatsapp_ops_notifications set state='uncertain',finished_at=now_at where state='sending' and lease_until<now_at returning snapshot)
 update public.whatsapp_ops_alerts a set notification_generation=a.generation from expired e,jsonb_array_elements(e.snapshot) x where a.code=x->>'code' and a.generation=(x->>'generation')::bigint;
 for r in
  with eligible as (
   select q.* from public.whatsapp_message_queue q where q.queue_version=2 and q.status in ('pending','processing','failed')
    and (not exists(select 1 from public.whatsapp_message_queue w where w.wa_id=q.wa_id and w.queue_version=2 and w.status='waiting' and w.pause_reason is distinct from 'manual_review')
     or btrim(q.payload->'text'->>'body') ~* '^(retomar|descartar|confirmar|cancelar|si|sí|no|resumen|quit[aá] |el [0-9]|cambi[aá] )')
  ), conditions as (
   select 'queue_delay'::text as code,'critical'::text as severity,count(*)::integer as affected,coalesce(extract(epoch from now_at-min(received_at))::bigint,0) as oldest_seconds,md5(coalesce(string_agg(id::text,',' order by id),'')) as fingerprint from eligible where received_at<now_at-interval '2 minutes'
   union all select 'repeated_failures','critical',count(*)::integer,coalesce(extract(epoch from now_at-min(received_at))::bigint,0),md5(coalesce(string_agg(id::text,',' order by id),'')) from eligible where attempts>=3
   union all select 'manual_review','warning',count(*)::integer,coalesce(extract(epoch from now_at-min(received_at))::bigint,0),md5(coalesce(string_agg(id::text,',' order by id),'')) from public.whatsapp_message_queue where queue_version=2 and status='waiting' and pause_reason='manual_review'
   union all select 'interpretation_fallback','warning',case when coalesce(sum(samples),0)>=3 then sum(samples)::integer else 0 end,0,md5(coalesce(max(bucket)::text,'')) from public.whatsapp_ops_metrics where event='queue_clarification' and bucket>=date_trunc('minute',now_at)-interval '14 minutes'
   union all select 'recovery_failure','critical',case when (select enabled from public.whatsapp_queue_control where singleton) and (not exists(select 1 from cron.job where jobname='pesito-whatsapp-queue-recovery' and active) or not exists(select 1 from cron.job_run_details d join cron.job j on j.jobid=d.jobid where j.jobname='pesito-whatsapp-queue-recovery' and d.status='succeeded' and d.end_time>now_at-interval '3 minutes')) then 1 else 0 end,0,'cron'
  ) select * from conditions
 loop
  if r.affected>0 then
   insert into public.whatsapp_ops_alerts(code,severity,affected,oldest_seconds,fingerprint,first_seen_at,last_seen_at) values(r.code,r.severity,r.affected,r.oldest_seconds,r.fingerprint,now_at,now_at)
   on conflict(code) do update set severity=excluded.severity,affected=excluded.affected,oldest_seconds=excluded.oldest_seconds,last_seen_at=now_at,resolved_at=null,
    generation=case when whatsapp_ops_alerts.resolved_at is not null or whatsapp_ops_alerts.fingerprint<>excluded.fingerprint then whatsapp_ops_alerts.generation+1 else whatsapp_ops_alerts.generation end,
    acknowledged_at=case when whatsapp_ops_alerts.resolved_at is not null or whatsapp_ops_alerts.fingerprint<>excluded.fingerprint then null else whatsapp_ops_alerts.acknowledged_at end,
    fingerprint=excluded.fingerprint;
  else update public.whatsapp_ops_alerts set affected=0,resolved_at=coalesce(resolved_at,now_at),last_seen_at=now_at where code=r.code; end if;
 end loop;
 update public.whatsapp_ops_config set last_scan_at=now_at where singleton;
 if cfg.whatsapp_enabled and cfg.notification_user_id is not null and cfg.verified_test_sender_digits is not null and public.whatsapp_ops_window_open(cfg.notification_user_id)
  and (cfg.last_notice_created_at is null or cfg.last_notice_created_at<now_at-interval '30 minutes')
  and not exists(select 1 from public.whatsapp_ops_notifications where state in ('pending','sending')) then
  select jsonb_agg(jsonb_build_object('code',code,'affected',affected,'oldest_seconds',oldest_seconds,'generation',generation) order by code) into notice
   from public.whatsapp_ops_alerts where resolved_at is null and acknowledged_at is null and notification_generation<generation;
  if notice is not null then
   insert into public.whatsapp_ops_notifications(recipient_user_id,snapshot) values(cfg.notification_user_id,notice);
   update public.whatsapp_ops_config set last_notice_created_at=now_at where singleton;
  end if;
 end if;
end $$;

create function public.claim_whatsapp_ops_notice(p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n public.whatsapp_ops_notifications; destination text; live_snapshot jsonb;
begin
 -- La config serializa todos los intentos, además del SKIP LOCKED de la bandeja.
 perform 1 from public.whatsapp_ops_config where singleton and whatsapp_enabled for update;
 if not found then return null; end if;
 select * into n from public.whatsapp_ops_notifications where state='pending' and available_at<=clock_timestamp() order by created_at limit 1 for update skip locked;
 if not found then return null; end if;
 select jsonb_agg(jsonb_build_object('code',code,'affected',affected,'oldest_seconds',oldest_seconds,'generation',generation) order by code) into live_snapshot from public.whatsapp_ops_alerts where resolved_at is null and acknowledged_at is null and notification_generation<generation;
 if live_snapshot is null then update public.whatsapp_ops_notifications set state='cancelled',finished_at=clock_timestamp() where id=n.id; if n.attempts=0 then update public.whatsapp_ops_config set last_notice_created_at=null where singleton; end if; return null; end if;
 if not public.whatsapp_ops_window_open(n.recipient_user_id) then
  update public.whatsapp_ops_notifications set state='cancelled',finished_at=clock_timestamp() where id=n.id; return null;
 end if;
 select w.wa_id into destination from public.whatsapp_links w join public.profiles p on p.id=w.user_id join public.whatsapp_ops_config c on c.notification_user_id=w.user_id where c.singleton and w.user_id=n.recipient_user_id and w.status='active' and p.role='admin';
 if destination is null then update public.whatsapp_ops_notifications set state='failed',finished_at=clock_timestamp() where id=n.id; return null; end if;
 update public.whatsapp_ops_notifications set state='sending',snapshot=live_snapshot,token=p_token,lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1 where id=n.id;
 return jsonb_build_object('id',n.id,'to',destination,'snapshot',live_snapshot,'test_sender_digits',(select verified_test_sender_digits from public.whatsapp_ops_config where singleton));
end $$;
create function public.finish_whatsapp_ops_notice(p_id uuid,p_token uuid,p_outcome text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n public.whatsapp_ops_notifications;state_after text;
begin
 perform 1 from public.whatsapp_ops_config where singleton for update;
 if p_outcome not in ('sent','failed','uncertain','blocked') then raise exception 'OPS_INVALID_OUTCOME'; end if;
 select * into n from public.whatsapp_ops_notifications where id=p_id for update;
 if not found or n.state<>'sending' or n.token is distinct from p_token then return; end if;
 state_after:=case when p_outcome='failed' and n.attempts<3 then 'pending' else p_outcome end;
 update public.whatsapp_ops_notifications set state=state_after,available_at=clock_timestamp()+interval '15 minutes',finished_at=case when state_after='pending' then null else clock_timestamp() end,lease_until=null where id=n.id;
 if state_after<>'pending' then
  update public.whatsapp_ops_config set last_notice_created_at=clock_timestamp() where singleton;
  update public.whatsapp_ops_alerts a set notification_generation=a.generation from jsonb_array_elements(n.snapshot) x where a.code=x->>'code' and a.generation=(x->>'generation')::bigint;
 end if;
end $$;

create function public.whatsapp_ops_dashboard() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'OPS_ADMIN_REQUIRED'; end if;
 return jsonb_build_object(
  'observed_at',clock_timestamp(),
  'config',(select jsonb_build_object('whatsapp_enabled',whatsapp_enabled,'is_recipient',notification_user_id=auth.uid(),'cost_verified',verified_test_sender_digits is not null,'window_open',public.whatsapp_ops_window_open(notification_user_id),'last_scan_at',last_scan_at,'retention_enabled',retention_enabled,'retention_days',retention_days,'last_retention_at',last_retention_at) from public.whatsapp_ops_config where singleton),
  'queue',(select jsonb_build_object('pending',count(*) filter(where status='pending'),'processing',count(*) filter(where status='processing'),'failed',count(*) filter(where status='failed'),'manual_review',count(*) filter(where status='waiting' and pause_reason='manual_review'),'waiting_customer',count(*) filter(where status='waiting' and pause_reason in ('stale','capacity'))) from public.whatsapp_message_queue where queue_version=2),
  'alerts',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'severity',severity,'affected',affected,'oldest_seconds',oldest_seconds,'first_seen_at',first_seen_at,'last_seen_at',last_seen_at,'acknowledged_at',acknowledged_at) order by first_seen_at),'[]') from public.whatsapp_ops_alerts where resolved_at is null),
  'metrics',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from (select event,sum(samples) as samples,round(sum(duration_total_ms)/greatest(sum(samples),1),1) as average_ms,max(duration_max_ms) as maximum_ms,sum(operations_total) as operations from public.whatsapp_ops_metrics where bucket>=clock_timestamp()-interval '24 hours' group by event) m),
  'recent_notifications',(select coalesce(jsonb_agg(to_jsonb(n)),'[]') from (select state,attempts,created_at,finished_at from public.whatsapp_ops_notifications order by created_at desc limit 10) n),
  'retention_eligible',(select count(*) from public.whatsapp_message_queue q where q.queue_version=2 and q.status='processed' and q.content_redacted_at is null and q.processed_at<clock_timestamp()-make_interval(days=>(select retention_days from public.whatsapp_ops_config where singleton)) and not exists(select 1 from public.draft_items d join public.draft_groups g on g.id=d.group_id where d.wa_message_id=q.wa_message_id and (g.status='open' or d.status='pending')) and not exists(select 1 from public.transactions t where t.user_id=q.user_id and t.status='pending' and (t.wa_message_id=q.wa_message_id or left(t.wa_message_id,length(q.wa_message_id)+1)=q.wa_message_id||':')))
 );
end $$;
create function public.configure_whatsapp_ops_alerts(p_enabled boolean) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'OPS_ADMIN_REQUIRED'; end if;
 if p_enabled and not exists(select 1 from public.whatsapp_links where user_id=auth.uid() and status='active' and wa_id is not null) then raise exception 'OPS_LINK_REQUIRED'; end if;
 update public.whatsapp_ops_config set whatsapp_enabled=p_enabled,notification_user_id=case when p_enabled then auth.uid() else notification_user_id end where singleton;
 if not p_enabled then update public.whatsapp_ops_notifications set state='cancelled',finished_at=clock_timestamp() where state='pending'; end if;
end $$;
create function public.acknowledge_whatsapp_ops_alert(p_code text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'OPS_ADMIN_REQUIRED'; end if;
 update public.whatsapp_ops_alerts set acknowledged_at=clock_timestamp() where code=p_code and resolved_at is null;
end $$;

-- Se prepara, pero NO se activa la limpieza sin aprobación de la política.
create function public.prune_whatsapp_ops_content() returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare cfg public.whatsapp_ops_config; cleaned integer;
begin
 select * into cfg from public.whatsapp_ops_config where singleton for update;
 if not cfg.retention_enabled then return 0; end if;
 with eligible as (
  select q.id from public.whatsapp_message_queue q where q.queue_version=2 and q.status='processed' and q.content_redacted_at is null
   and q.processed_at<clock_timestamp()-make_interval(days=>cfg.retention_days)
   and not exists(select 1 from public.draft_items d join public.draft_groups g on g.id=d.group_id where d.wa_message_id=q.wa_message_id and (g.status='open' or d.status='pending')) and not exists(select 1 from public.transactions t where t.user_id=q.user_id and t.status='pending' and (t.wa_message_id=q.wa_message_id or left(t.wa_message_id,length(q.wa_message_id)+1)=q.wa_message_id||':'))
   order by q.processed_at limit 500 for update of q skip locked
 ) update public.whatsapp_message_queue q set payload=jsonb_build_object('id',q.wa_message_id,'from',q.wa_id,'type',q.payload->>'type','redacted',true),parsed_result=null,reply_text=null,error_message=null,content_redacted_at=clock_timestamp() from eligible e where q.id=e.id;
 get diagnostics cleaned=row_count;
 delete from public.whatsapp_ops_metrics where bucket<clock_timestamp()-interval '90 days';
 delete from public.whatsapp_ops_notifications where state in ('sent','cancelled') and finished_at<clock_timestamp()-interval '90 days';
 update public.whatsapp_ops_config set last_retention_at=clock_timestamp() where singleton;
 return cleaned;
end $$;
-- Mantener autenticación y transporte privados existentes; despertar también para avisos.
do $replace$
declare def text;
begin
 select pg_get_functiondef('public.dispatch_whatsapp_queue_recovery()'::regprocedure) into def;
 if position('or not exists(select 1 from public.due_whatsapp_actors())' in def)=0 then raise exception 'OPS_RECOVERY_DEFINITION_UNEXPECTED'; end if;
 execute replace(def,'or not exists(select 1 from public.due_whatsapp_actors())','or not (exists(select 1 from public.due_whatsapp_actors()) or exists(select 1 from public.whatsapp_ops_notifications where state=''pending'' and available_at<=clock_timestamp()))');
end $replace$;
-- Revocar defaults PUBLIC antes de conceder los roles específicos.
do $permissions$ declare f record; begin
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in ('record_whatsapp_ops_metrics','refresh_whatsapp_ops_health','claim_whatsapp_ops_notice','finish_whatsapp_ops_notice','whatsapp_ops_dashboard','configure_whatsapp_ops_alerts','acknowledge_whatsapp_ops_alert','prune_whatsapp_ops_content') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $permissions$;
grant execute on function public.record_whatsapp_ops_metrics(jsonb),public.claim_whatsapp_ops_notice(uuid),public.finish_whatsapp_ops_notice(uuid,uuid,text) to service_role;
grant execute on function public.whatsapp_ops_dashboard(),public.configure_whatsapp_ops_alerts(boolean),public.acknowledge_whatsapp_ops_alert(text) to authenticated;
select cron.schedule('pesito-whatsapp-observability','* * * * *','select public.refresh_whatsapp_ops_health()');
select cron.schedule('pesito-whatsapp-retention','17 * * * *','select public.prune_whatsapp_ops_content()');
commit;