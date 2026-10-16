-- Corrección del flujo 24 h: CANCELAR la lista antigua conserva el mensaje nuevo.
-- Solo reemplaza ramas de la función; no modifica filas ni reprocesa mensajes.
begin;
do $migration$
declare
 definition text;
 old_guard constant text := $old$and action not in ('resume','discard') then$old$;
 new_guard constant text := $new$and action not in ('resume','discard','cancel') then$new$;
 old_branch constant text := $old$elsif action='resume' or action='discard' then$old$;
 new_branch constant text := $new$elsif action='resume' or action='discard' or (action='cancel' and g.id is not null and g.last_activity_at<clock_timestamp()-interval '24 hours') then$new$;
 old_discard constant text := $old$if action='discard' then perform public.discard_draft_group(g.id,u);$old$;
 new_discard constant text := $new$if action in ('discard','cancel') then perform public.discard_draft_group(g.id,u);$new$;
begin
 select pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure) into definition;
 if position(new_guard in definition)>0 and position(new_branch in definition)>0 and position(new_discard in definition)>0 then return; end if;
 if position(old_guard in definition)=0 or position(old_branch in definition)=0 or position(old_discard in definition)=0 then
   raise exception 'STALE_CANCEL_DEFINITION_UNEXPECTED';
 end if;
 execute replace(replace(replace(definition,old_guard,new_guard),old_branch,new_branch),old_discard,new_discard);
end;
$migration$;
commit;
