-- INF-04 / BE-10: una respuesta RPC perdida no reabre entregas finalizadas.
begin;
set local lock_timeout='5s';
create or replace function public.finish_whatsapp_job(p_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.whatsapp_message_queue;
begin
  select * into q from public.whatsapp_message_queue where id=p_id;
  perform public.assert_whatsapp_lease(q.wa_id,p_token);
  -- Volver a leer bajo el bloqueo del actor: un RPC concurrente pudo terminarlo.
  select * into q from public.whatsapp_message_queue where id=p_id for update;
  if q.status='processed' then return; end if;
  if q.status='waiting' and q.reply_sent_at is not null then return; end if;
  if q.status<>'processing' or not q.effect_applied then raise exception 'QUEUE_NOT_READY_TO_FINISH'; end if;
  update public.whatsapp_message_queue set status=case when pause_reason is null then 'processed' else 'waiting' end,
    processed_at=case when pause_reason is null then clock_timestamp() else null end,reply_sent_at=clock_timestamp() where id=p_id;
  update public.inbound_events set status=case when q.pause_reason is null then 'processed' else 'waiting' end,processed_at=clock_timestamp(),error_code=null where wa_message_id=q.wa_message_id;
end $$;

create or replace function public.fail_whatsapp_job(p_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.whatsapp_message_queue;
begin
  select * into q from public.whatsapp_message_queue where id=p_id;
  perform public.assert_whatsapp_lease(q.wa_id,p_token);
  select * into q from public.whatsapp_message_queue where id=p_id for update;
  -- Un error recibido después de COMMIT no cambia un estado ya terminado.
  -- También evita reprogramar dos veces un mismo fallo.
  if q.status<>'processing' then return; end if;
  update public.whatsapp_message_queue set status='failed',scheduled_for=clock_timestamp()+make_interval(secs=>least(300,5*power(2,least(attempts,6))::integer)),error_message='QUEUE_RETRY_REQUIRED' where id=p_id;
  update public.inbound_events set status='failed',error_code='QUEUE_RETRY_REQUIRED' where wa_message_id=q.wa_message_id;
end $$;
revoke all on function public.finish_whatsapp_job(uuid,uuid),public.fail_whatsapp_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finish_whatsapp_job(uuid,uuid),public.fail_whatsapp_job(uuid,uuid) to service_role;
commit;
