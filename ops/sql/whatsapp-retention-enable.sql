-- INF-14: propuesta revisable. NO ejecutar sin autorización expresa 30/90.
-- El operador debe establecer pesito.retention_approval='30d-content-90d-metrics-v1'
-- en la misma conexión. Esta marca técnica NO sustituye el consentimiento humano.
-- Solo habilita el cron existente; no ejecuta limpieza inmediata ni cambia plazos.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
do $guard$
declare cfg public.whatsapp_ops_config;
begin
 if current_setting('pesito.retention_approval',true) is distinct from '30d-content-90d-metrics-v1' then raise exception 'INF14_OWNER_APPROVAL_REQUIRED';end if;
 select * into cfg from public.whatsapp_ops_config where singleton for update;
 if not found or cfg.retention_enabled is distinct from false or cfg.retention_days is distinct from 30 then raise exception 'INF14_POLICY_CHANGED';end if;
 if md5(replace((select prosrc from pg_proc where oid='public.prune_whatsapp_ops_content()'::regprocedure),chr(13)||chr(10),chr(10))) is distinct from '3b3fe2821ad64a3a9cbb59825e21d71b' then raise exception 'INF14_CLEANUP_SOURCE_CHANGED';end if;
 if (select count(*) from cron.job where jobname='pesito-whatsapp-retention' and active and schedule='17 * * * *')<>1 then raise exception 'INF14_CRON_CHANGED';end if;
 if to_regclass('public.ai_quota_reservations') is null then raise exception 'INF14_BASELINE_MISSING';end if;
end $guard$;
update public.whatsapp_ops_config set retention_enabled=true where singleton returning retention_enabled,retention_days;
commit;
reset pesito.retention_approval;
