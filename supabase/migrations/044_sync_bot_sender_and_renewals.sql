-- Migración 044: Sincronización de emisor de WhatsApp y robustez de avisos de renovación.
-- Vincula el número del bot configurado en system_config con whatsapp_ops_config
-- y permite que claim_subscription_renewal_notice resuelva el emisor de forma segura.
begin;
set local lock_timeout = '5s';

-- 1. Sincronización inicial del emisor de prueba si cumple el patrón aprobado
update public.whatsapp_ops_config
set verified_test_sender_digits = (
  select regexp_replace(value, '[^0-9]', '', 'g')
  from public.system_config
  where key = 'whatsapp_bot_phone'
    and regexp_replace(value, '[^0-9]', '', 'g') ~ '^1555[0-9]{7}$'
)
where singleton and (verified_test_sender_digits is null or verified_test_sender_digits = '');

-- 2. Trigger en system_config para sincronizar verified_test_sender_digits al editar whatsapp_bot_phone
create or replace function public.sync_whatsapp_bot_phone_ops() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare digits text;
begin
 if new.key = 'whatsapp_bot_phone' then
  digits := regexp_replace(coalesce(new.value, ''), '[^0-9]', '', 'g');
  if digits ~ '^1555[0-9]{7}$' then
   update public.whatsapp_ops_config set verified_test_sender_digits = digits where singleton;
  end if;
 end if;
 return new;
end $$;

drop trigger if exists sync_whatsapp_bot_phone_ops on public.system_config;
create trigger sync_whatsapp_bot_phone_ops
after insert or update on public.system_config
for each row execute function public.sync_whatsapp_bot_phone_ops();

-- 3. claim_subscription_renewal_notice con fallback defensivo a system_config
create or replace function public.claim_subscription_renewal_notice(p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n public.subscription_renewal_notices; r public.subscription_renewal_requests; c public.invitation_codes; expected text;
begin
 if p_token is null then raise exception 'Token requerido.'; end if;
 update public.subscription_renewal_notices set state='uncertain',finished_at=clock_timestamp(),lease_until=null where state='sending' and lease_until<clock_timestamp();
 if not (select enabled from public.whatsapp_queue_control where singleton) or exists(select 1 from public.system_config where key='bot_active' and value='false') then return null; end if;
 select coalesce(
   verified_test_sender_digits,
   (select regexp_replace(value, '[^0-9]', '', 'g') from public.system_config where key='whatsapp_bot_phone' and regexp_replace(value, '[^0-9]', '', 'g') ~ '^1555[0-9]{7}$')
 ) into expected from public.whatsapp_ops_config where singleton;
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

-- 4. Permisos
revoke all on function public.sync_whatsapp_bot_phone_ops() from public,anon,authenticated,service_role;
revoke all on function public.claim_subscription_renewal_notice(uuid) from public,anon,authenticated;
grant execute on function public.claim_subscription_renewal_notice(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
