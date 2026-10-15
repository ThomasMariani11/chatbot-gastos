-- Publicar después de 020. No activa la cola ni escribe secretos.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
-- El header del trabajador queda en la cola HTTP interna, nunca accesible a clientes.
revoke all on net.http_request_queue,net._http_response from public,anon,authenticated;

create function public.dispatch_whatsapp_queue_recovery() returns bigint
language plpgsql security definer set search_path=pg_catalog,public as $$
declare worker_secret text; request_id bigint;
begin
  if not (select enabled from public.whatsapp_queue_control where singleton)
    or not exists(select 1 from public.due_whatsapp_actors()) then return null; end if;
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name='whatsapp_worker_secret';
  if worker_secret is null then raise exception 'QUEUE_RECOVERY_SECRET_MISSING'; end if;
  select net.http_post(
    url:='https://ystyatotldslfmucvgsq.supabase.co/functions/v1/whatsapp-webhook?action=worker',
    headers:=jsonb_build_object('content-type','application/json','x-worker-secret',worker_secret),
    body:='{}'::jsonb,timeout_milliseconds:=5000
  ) into request_id;
  return request_id;
end $$;
revoke all on function public.dispatch_whatsapp_queue_recovery() from public,anon,authenticated,service_role;
-- Cron ejecuta como el propietario de la migración; no necesita service_role.
select cron.schedule('pesito-whatsapp-queue-recovery','* * * * *','select public.dispatch_whatsapp_queue_recovery()');
commit;
