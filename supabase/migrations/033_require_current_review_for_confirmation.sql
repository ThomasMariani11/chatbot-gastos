-- BE-07: una confirmación retenida no autoriza guardar al retomar una lista.
-- Cambia solo el contrato de la RPC: no modifica filas ni reprocesa mensajes.
-- CREATE OR REPLACE conserva propietario, ACL y firmas de la versión vigente.
begin;
set local lock_timeout='5s';

do $migration$
declare
 definition text;
 old_guard constant text := $old$elsif q.confirmation_group_id is distinct from g.id or q.confirmation_version is distinct from g.version then$old$;
 new_guard constant text := $new$elsif q.confirmation_group_id is distinct from g.id or q.confirmation_version is distinct from g.version
        or not exists (
          select 1 from public.whatsapp_worker_state s
          where s.wa_id=q.wa_id and s.user_id=u and not s.summary_pending
            and s.shown_group_id=g.id and s.shown_version=g.version
        ) then$new$;
 old_release constant text := $old$update public.whatsapp_message_queue set status='pending',pause_reason=null,effect_applied=false,reply_text=null,reply_sent_at=null
        where wa_id=q.wa_id and queue_version=2 and status='waiting' and pause_reason='stale';$old$;
 new_release constant text := $new$update public.whatsapp_message_queue set status='pending',pause_reason=null,effect_applied=false,reply_text=null,reply_sent_at=null,
        confirmation_group_id=null,confirmation_version=null
        where wa_id=q.wa_id and queue_version=2 and status='waiting' and pause_reason='stale';$new$;
begin
 select pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure) into definition;
 if position(new_guard in definition)>0 and position(new_release in definition)>0 then return; end if;
 if position(old_guard in definition)=0 or position(old_release in definition)=0
   or length(definition)-length(replace(definition,old_guard,''))<>length(old_guard)
   or length(definition)-length(replace(definition,old_release,''))<>length(old_release) then
   raise exception 'BE07_APPLY_DEFINITION_UNEXPECTED';
 end if;
 execute replace(replace(definition,old_guard,new_guard),old_release,new_release);
end;
$migration$;
commit;
