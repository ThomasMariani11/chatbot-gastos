-- pg_net alojado conserva grants PUBLIC administrados por Supabase.
-- Usar HTTP síncrono solo desde cron evita persistir el secreto en esa cola.
begin;
create extension if not exists http with schema extensions;
create or replace function public.dispatch_whatsapp_queue_recovery() returns bigint
language plpgsql security definer set search_path=pg_catalog,public
as $$
declare worker_secret text; response_status integer;
begin
  if not (select enabled from public.whatsapp_queue_control where singleton)
    or not exists(select 1 from public.due_whatsapp_actors()) then return null; end if;
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name='whatsapp_worker_secret';
  if worker_secret is null then raise exception 'QUEUE_RECOVERY_SECRET_MISSING'; end if;
  begin
    if not extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','2000') or not extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','5000') then raise exception 'QUEUE_RECOVERY_TIMEOUT_CONFIGURATION_FAILED'; end if;
    select status into response_status from extensions.http((
      'POST',
      'https://ystyatotldslfmucvgsq.supabase.co/functions/v1/whatsapp-webhook?action=worker',
      array[extensions.http_header('x-worker-secret',worker_secret)],
      'application/json','{}'
    )::extensions.http_request);
    perform extensions.http_reset_curlopt();
  exception when others then
    perform extensions.http_reset_curlopt();
    raise exception 'QUEUE_RECOVERY_HTTP_FAILED';
  end;
  if response_status<>200 then raise exception 'QUEUE_RECOVERY_HTTP_REJECTED status=%',response_status; end if;
  return response_status;
end $$;
revoke all on function public.dispatch_whatsapp_queue_recovery() from public,anon,authenticated,service_role;
comment on function public.dispatch_whatsapp_queue_recovery() is 'Cron interno; timeout HTTP 5s; sin persistencia de headers, cuerpos o credenciales; retorna solo status.';
commit;
