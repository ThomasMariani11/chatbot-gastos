-- Textos del bot más claros y cercanos (aprobados por el propietario el 09/11/2026).
-- Solo cambia textos de respuesta: misma lógica, mismos controles y mismos permisos.
-- Los textos coinciden con supabase/functions/whatsapp-webhook/bot-messages.ts
-- (tests/durable-queue.test.ts verifica la paridad).
begin;

create or replace function public.whatsapp_over_limit_reply(p_count integer) returns text
language sql immutable set search_path=pg_catalog,public as $$
 select '¡Son muchos! 😅 Me mandaste '||p_count::text||E' y puedo anotar hasta 20 por lista.\n\nMandámelos en mensajes más cortos.\nSi ya tenés pendientes, confirmalos primero para hacer lugar.'
$$;
revoke all on function public.whatsapp_over_limit_reply(integer) from public,anon,authenticated,service_role;

do $migration$
declare
 definition text;
 old_not_found text := $old$'No encontré ese movimiento en tu lista pendiente.'$old$;
 new_not_found text := $new$E'No encontré ese número en tu lista 🤔\nEscribí RESUMEN para verla.'$new$;
 old_stale text := $old$'La lista cambió. Revisala con RESUMEN y repetí la corrección. No modifiqué la lista.'$old$;
 new_stale text := $new$E'Tu lista cambió mientras tanto.\nMirala con RESUMEN y repetí el cambio.'$new$;
 old_failed text := $old$'No pude aplicar el cambio: revisá los datos y las cuotas. No modifiqué la lista.'$old$;
 new_failed text := $new$E'No pude aplicar ese cambio 😕\nMirá tu lista con RESUMEN y probá de nuevo.'$new$;
 old_capacity text := $old$'Tenés '||(select count(*) from public.draft_items where group_id=g.id and status='pending')||' movimientos pendientes y este mensaje trae '||n||'. El máximo es 20. Conservé este mensaje completo en espera. Quitá movimientos o revisá y confirmá los actuales; después lo proceso sin que tengas que reenviarlo.'$old$;
 new_capacity text := $new$E'Con este mensaje tu lista pasaría de 20 movimientos 😅\nGuardé el mensaje para después.\n\nConfirmá o sacá algunos movimientos y lo proceso solo.'$new$;
 old_review text := $old$'No pude procesar este mensaje y no lo cargué. Quedó conservado para revisión. Pasame el gasto o ingreso en texto, con el concepto y el monto. Podés seguir enviando otros movimientos; no hace falta cancelar tu lista.'$old$;
 new_review text := $new$E'No pude procesar este mensaje 😕 Lo guardé para revisarlo.\nMientras tanto, escribime el gasto con el concepto y el monto.\n\nTu lista sigue igual.'$new$;
begin
 select pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure) into definition;
 if position(old_not_found in definition)=0 or position(old_stale in definition)=0
   or position(old_failed in definition)=0 or position(old_capacity in definition)=0 then
  raise exception 'BOT_MESSAGES_APPLY_DEFINITION_UNEXPECTED';
 end if;
 execute replace(replace(replace(replace(definition,
   old_not_found,new_not_found),old_stale,new_stale),old_failed,new_failed),old_capacity,new_capacity);

 select pg_get_functiondef('public.next_whatsapp_job(text,uuid)'::regprocedure) into definition;
 if position(old_review in definition)=0 then
  raise exception 'BOT_MESSAGES_NEXT_JOB_DEFINITION_UNEXPECTED';
 end if;
 execute replace(definition,old_review,new_review);
end $migration$;

notify pgrst,'reload schema';
commit;
