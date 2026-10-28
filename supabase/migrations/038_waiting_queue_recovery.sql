-- BE-11: comandos de resolución coherentes, capacidad y reintentos de espera.
begin;
set local lock_timeout='5s';
alter table public.whatsapp_message_queue add column capacity_resumes integer not null default 0 check(capacity_resumes>=0);
-- Un checkpoint de capacidad ya aplicado sin error es una espera de negocio exitosa.
-- Mantener attempts monotónico; el ajuste no reenvía ni reabre ningún mensaje.
update public.whatsapp_message_queue set capacity_resumes=greatest(attempts-1,0)
 where queue_version=2 and status='waiting' and pause_reason='capacity' and effect_applied and error_message is null;
create function public.whatsapp_can_pass_waiting(p_payload jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,public as $$
declare t text;
begin
 if p_payload->>'type' is distinct from 'text' then return false;end if;
 t:=coalesce(p_payload->'text'->>'body','');
 t:=replace(replace(replace(t,chr(160),' '),chr(65279),' '),chr(8239),' ');
 t:=regexp_replace(normalize(lower(t),NFD),U&'[\0300-\036F]','','g');
 t:=btrim(regexp_replace(t,'\s+',' ','g'));
 t:=btrim(regexp_replace(t,'^[¡!]+|[.!]+$','','g'));
 if t ~ '^(confirmar|confirmado|confirmo|si|ok|dale|listo|de una|va|sisi|perfecto|👍[🏻🏼🏽🏾🏿]?|✅|✔️|👌[🏻🏼🏽🏾🏿]?)$' then return true;end if;
 if t ~ '^(cancelar( todo)?|cancelalo|cancela|cancel|no|borralo|borrar todo|anular|rechazar|❌|🚫)$' then return true;end if;
 if t ~ '^(resumen|pendientes|ver (la )?lista|lista|ver|mis pendientes|retomar|descartar)$' then return true;end if;
 if t ~ '^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|ayuda|menu|comandos|gracias|muchas gracias|genial)$' then return true;end if;
 -- Incluso una remoción ambigua debe poder pedir aclaración sin bloquearse.
 if t ~ '^(quita|quitame|borra|borrame|saca|sacame|elimina|eliminame)([[:>:]])' then return true;end if;
 if t ~ '^((el|la) +((movimiento|operacion|gasto|ingreso) +)?[0-9]([[:>:]])|(cambia|corregi|corrige|modifica|edita)([[:>:]]))' then return true;end if;
 -- Respuestas breves a faltantes (034), siempre validadas por el procesador.
 return t ~ '^\$? *[0-9][0-9.,]* *(k|mil|lucas?)? *$' or t ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
end $$;
revoke all on function public.whatsapp_can_pass_waiting(jsonb) from public,anon,authenticated,service_role;

create function public.whatsapp_over_limit_reply(p_count integer) returns text
language sql immutable set search_path=pg_catalog,public as $$
 select 'Recibí '||p_count::text||' movimientos en un solo mensaje. El máximo es 20 por lista. No agregué ninguno de este mensaje. Dividilo en mensajes de hasta 20; si ya tenés pendientes, primero revisalos y confirmalos o liberá espacio. Tu lista anterior se conserva.'
$$;
revoke all on function public.whatsapp_over_limit_reply(integer) from public,anon,authenticated,service_role;

do $migration$
declare definition text;f text;expr text;
 old_pattern text := $pattern$^(retomar|descartar|confirmar|cancelar|si|sí|no|resumen|quit[aá] |(el|la) +(movimiento +|operaci[oó]n +|gasto +|ingreso +)?[0-9]|(cambi[aá]|correg[ií]|corrige|modific[aá]|edit[aá]) |\$?\s*[0-9][0-9.,]*\s*(k|mil|lucas?)?\s*$|[0-9]{4}-[0-9]{2}-[0-9]{2}\s*$)$pattern$;
 old_capacity text := $old$      if n>20 or n+(select count(*) from public.draft_items where group_id=g.id and status='pending')>20 then
        update public.whatsapp_message_queue set pause_reason='capacity' where id=q.id;
        reply:='El lote admite 20 movimientos. No agregué parcialmente este mensaje: quedó en espera. Quitá movimientos o confirmá los actuales; si este mensaje tiene más de 20, cancelá y dividilo en mensajes más pequeños.';$old$;
 new_capacity text := $new$      if n>20 then
        reply:=public.whatsapp_over_limit_reply(n);
      elsif n+(select count(*) from public.draft_items where group_id=g.id and status='pending')>20 then
        update public.whatsapp_message_queue set pause_reason='capacity' where id=q.id;
        reply:='Tenés '||(select count(*) from public.draft_items where group_id=g.id and status='pending')||' movimientos pendientes y este mensaje trae '||n||'. El máximo es 20. Conservé este mensaje completo en espera. Quitá movimientos o revisá y confirmá los actuales; después lo proceso sin que tengas que reenviarlo.';$new$;
 old_resume text := $old$(status='pending',pause_reason=null,effect_applied=false,reply_text=null,reply_sent_at=null)([[:space:]]+where wa_id=q\.wa_id and queue_version=2 and status='waiting' and pause_reason='capacity')$old$;
 new_resume text := $new$status='pending',capacity_resumes=capacity_resumes+1,pause_reason=null,effect_applied=false,reply_text=null,reply_sent_at=null\2$new$;
begin
 foreach f in array array['public.next_whatsapp_job(text,uuid)','public.due_whatsapp_actors()'] loop
  select pg_get_functiondef(f::regprocedure) into definition;
  expr:=case when f like '%next_whatsapp_job%' then 'btrim(payload->''text''->>''body'')' else 'btrim(q.payload->''text''->>''body'')' end||' ~* '||chr(39)||old_pattern||chr(39);
  if position(expr in definition)=0 then raise exception 'BE11_ELIGIBILITY_DEFINITION_UNEXPECTED';end if;
  definition:=replace(definition,expr,case when f like '%next_whatsapp_job%' then 'public.whatsapp_can_pass_waiting(payload)' else 'public.whatsapp_can_pass_waiting(q.payload)' end);
  if f like '%next_whatsapp_job%' then
   if position('q.attempts>=5 and not q.effect_applied' in definition)=0 then raise exception 'BE11_RETRY_GUARD_UNEXPECTED';end if;
   definition:=replace(definition,'q.attempts>=5 and not q.effect_applied','q.attempts-q.capacity_resumes>=5 and not q.effect_applied');
  end if;
  execute definition;
 end loop;
 select pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure) into definition;
 if position(old_capacity in definition)=0 or (select count(*) from regexp_matches(definition,old_resume,'g'))<>2 or position('and s.shown_group_id=g.id and s.shown_version=g.version' in definition)=0 or position('public.edit_pending_draft_item' in definition)=0 then raise exception 'BE11_APPLY_DEFINITION_UNEXPECTED';end if;
 execute regexp_replace(replace(definition,old_capacity,new_capacity),old_resume,new_resume,'g');
 select pg_get_functiondef('public.fail_whatsapp_job(uuid,uuid)'::regprocedure) into definition;
 if position('least(attempts,6)' in definition)=0 then raise exception 'BE11_FAILURE_BACKOFF_UNEXPECTED';end if;
 execute replace(definition,'least(attempts,6)','least(greatest(attempts-capacity_resumes,0),6)');
end $migration$;
notify pgrst,'reload schema';
commit;
