-- BE-08: borradores incompletos; no cambia movimientos definitivos ni reenvía mensajes.
begin;
set local lock_timeout='5s';
alter table public.draft_items alter column amount drop not null, alter column occurred_on drop not null;
alter table public.draft_items add column clarification text;

create function public.validate_incomplete_draft_item() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 new.missing_fields:=array(select distinct f from unnest(coalesce(new.missing_fields,'{}'::text[])) f where f is distinct from 'category' order by f);
 if new.amount::text in ('NaN','Infinity','-Infinity') then raise exception 'DRAFT_INVALID_AMOUNT'; end if;
 if new.amount is null and not('amount'=any(new.missing_fields)) then new.missing_fields:=array_append(new.missing_fields,'amount'); end if;
 if new.occurred_on is null and not('date'=any(new.missing_fields)) then new.missing_fields:=array_append(new.missing_fields,'date'); end if;
 if not(new.missing_fields<@array['amount','date','description','review']::text[]) or array_position(new.missing_fields,null) is not null then raise exception 'DRAFT_INVALID_MISSING_FIELDS'; end if;
 if new.confidence is not null and (new.confidence<0 or new.confidence>1) then raise exception 'DRAFT_INVALID_CONFIDENCE'; end if;
 if char_length(new.clarification)>500 then raise exception 'DRAFT_INVALID_CLARIFICATION'; end if;
 if cardinality(new.missing_fields)=0 and nullif(btrim(new.clarification),'') is not null then
  if TG_OP='INSERT' then new.missing_fields:=array['review'];
  elsif new.clarification is distinct from old.clarification then new.missing_fields:=array['review'];
  else new.clarification:=null; end if;
 end if;
 if new.status='confirmed' and (new.amount is null or new.occurred_on is null or cardinality(new.missing_fields)>0) then raise exception 'DRAFT_INCOMPLETE'; end if;
 return new;
end $$;
revoke all on function public.validate_incomplete_draft_item() from public,anon,authenticated,service_role;
create trigger tr_validate_incomplete_draft_item before insert or update on public.draft_items for each row execute function public.validate_incomplete_draft_item();

create function public.complete_pending_draft_item(p_group uuid,p_user uuid,p_position integer,p_version integer,p_patch jsonb) returns boolean
language plpgsql set search_path=pg_catalog,public as $$
declare i public.draft_items; m jsonb; cat uuid; fields text[]; target_field text;
begin
 perform 1 from public.draft_groups where id=p_group and user_id=p_user and status='open' and version=p_version for update;
 if not found then return false; end if;
 select * into i from public.draft_items where group_id=p_group and user_id=p_user and position=p_position and status='pending' for update;
 if not found or cardinality(i.missing_fields)=0 then return false; end if;
 if jsonb_typeof(p_patch) is distinct from 'object' then raise exception 'DRAFT_INVALID_COMPLETION'; end if;
 select array_agg(key) into fields from jsonb_object_keys(p_patch) key;
 if cardinality(fields) is distinct from 1 then raise exception 'DRAFT_INVALID_COMPLETION'; end if;
 target_field:=fields[1];
 if target_field='movement' then
  m:=p_patch->'movement';
  if jsonb_typeof(m) is distinct from 'object' or jsonb_typeof(m->'totalAmountArs') is distinct from 'number'
   or jsonb_typeof(m->'description') is distinct from 'string' or jsonb_typeof(m->'occurredOn') is distinct from 'string'
   or (m->>'kind') not in ('expense','income') or (m->>'currency') not in ('ARS','USD')
   or jsonb_typeof(m->'missingFields') is distinct from 'array' or jsonb_array_length(m->'missingFields')<>0 then raise exception 'DRAFT_INVALID_COMPLETION'; end if;
  select id into cat from public.categories where user_id=p_user and kind=(m->>'kind')::public.transaction_kind and lower(name)=lower(coalesce(m->>'category','Otros')) limit 1;
  if cat is null then select id into cat from public.categories where user_id=p_user and kind=(m->>'kind')::public.transaction_kind and name='Otros' limit 1; end if;
  update public.draft_items set kind=(m->>'kind')::public.transaction_kind,description=btrim(m->>'description'),amount=(m->>'totalAmountArs')::numeric,currency=m->>'currency',occurred_on=(m->>'occurredOn')::date,
   installments=(m->>'installments')::integer,first_installment_month=m->>'firstInstallmentMonth',category_id=cat,confidence=(m->>'confidence')::numeric,missing_fields='{}',clarification=null,updated_at=clock_timestamp() where id=i.id;
 elsif target_field='amount' then
  if not('amount'=any(i.missing_fields)) then return false; end if;
  if jsonb_typeof(p_patch->'amount') is distinct from 'number' or (p_patch->>'amount')::numeric<=0 then raise exception 'DRAFT_INVALID_COMPLETION'; end if;
  update public.draft_items set amount=(p_patch->>'amount')::numeric,missing_fields=array_remove(missing_fields,'amount'),updated_at=clock_timestamp() where id=i.id;
 elsif target_field='occurred_on' then
  if not('date'=any(i.missing_fields)) then return false; end if;
  if jsonb_typeof(p_patch->'occurred_on') is distinct from 'string' or (p_patch->>'occurred_on')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'DRAFT_INVALID_COMPLETION'; end if;
  update public.draft_items set occurred_on=(p_patch->>'occurred_on')::date,first_installment_month=case when installments>1 then coalesce(first_installment_month,left(p_patch->>'occurred_on',7)) else null end,missing_fields=array_remove(missing_fields,'date'),updated_at=clock_timestamp() where id=i.id;
 elsif target_field='description' then
  if not('description'=any(i.missing_fields)) then return false; end if;
  if jsonb_typeof(p_patch->'description') is distinct from 'string' or char_length(btrim(p_patch->>'description')) not between 1 and 160 then raise exception 'DRAFT_INVALID_COMPLETION'; end if;
  update public.draft_items set description=btrim(p_patch->>'description'),missing_fields=array_remove(missing_fields,'description'),updated_at=clock_timestamp() where id=i.id;
 else raise exception 'DRAFT_INVALID_COMPLETION'; end if;
 return true;
end $$;
-- Es auxiliar de la RPC con SECURITY DEFINER; no ofrece un atajo directo al cliente/backend.
revoke all on function public.complete_pending_draft_item(uuid,uuid,integer,integer,jsonb) from public,anon,authenticated,service_role;

do $migration$
declare definition text;
 old_edit text := $old$elsif action in ('remove','edit') then
      target:=(p_action->>'position')::integer;
      if action='remove' then
        update public.draft_items set status='removed',updated_at=clock_timestamp() where group_id=g.id and user_id=u and position=target and status='pending';
      else
        update public.draft_items set amount=coalesce((p_action->>'amount')::numeric,amount),description=coalesce(nullif(p_action->>'description',''),description),updated_at=clock_timestamp()
          where group_id=g.id and user_id=u and position=target and status='pending';
      end if;
      get diagnostics affected=row_count;$old$;
 new_edit text := $new$elsif action in ('remove','edit','complete') then
      target:=(p_action->>'position')::integer;
      if action='remove' then
        update public.draft_items set status='removed',updated_at=clock_timestamp() where group_id=g.id and user_id=u and position=target and status='pending';
        get diagnostics affected=row_count;
      elsif action='complete' then
        affected:=case when (p_action->>'group_id')::uuid=g.id and public.complete_pending_draft_item(g.id,u,target,(p_action->>'version')::integer,p_action->'patch') then 1 else 0 end;
      else
        update public.draft_items set amount=coalesce((p_action->>'amount')::numeric,amount),description=coalesce(nullif(p_action->>'description',''),description),
          missing_fields=case when p_action->>'amount' is not null then array_remove(missing_fields,'amount') else missing_fields end,
          updated_at=clock_timestamp() where group_id=g.id and user_id=u and position=target and status='pending';
        get diagnostics affected=row_count;
      end if;$new$;
 old_date text := $old$coalesce((item->>'occurredOn')::date,(clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date),category,$old$;
 new_date text := $new$case when coalesce(item->'missingFields','[]'::jsonb)?'date' then null else coalesce((item->>'occurredOn')::date,(clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date) end,category,$new$;
 old_columns text := 'source_operation_index,missing_fields)';
 new_columns text := 'source_operation_index,missing_fields,clarification)';
 old_values text := $old$array(select jsonb_array_elements_text(coalesce(item->'missingFields','[]'::jsonb))));$old$;
 old_capacity text := $old$if affected<>1 then reply:='No encontré ese movimiento en tu lista pendiente.';
      else
        update public.draft_groups set version=version+1,last_activity_at=clock_timestamp(),updated_at=clock_timestamp() where id=g.id;
        update public.whatsapp_worker_state set summary_pending=true,shown_version=null where wa_id=q.wa_id;
        update public.whatsapp_message_queue set status='pending',pause_reason=null,effect_applied=false,reply_text=null,reply_sent_at=null
          where wa_id=q.wa_id and queue_version=2 and status='waiting' and pause_reason='capacity';$old$;
 new_capacity text := replace(old_capacity,'''capacity'';', '''capacity'' and action=''remove'';');
 new_values text := $new$array(select jsonb_array_elements_text(coalesce(item->'missingFields','[]'::jsonb))),item->>'clarification');$new$;
begin
 select pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure) into definition;
 if position(old_edit in definition)=0 or position(old_date in definition)=0 or position(old_columns in definition)=0 or position(old_values in definition)=0
  or position(old_capacity in definition)=0 or position('and s.shown_group_id=g.id and s.shown_version=g.version' in definition)=0 then raise exception 'BE08_APPLY_DEFINITION_UNEXPECTED'; end if;
 execute replace(replace(replace(replace(replace(definition,old_edit,new_edit),old_date,new_date),old_columns,new_columns),old_values,new_values),old_capacity,new_capacity);
end;
$migration$;

-- Respuestas numéricas a un faltante pueden pasar detrás de una pausa de capacidad.
-- Las listas antiguas siguen reteniendo el mensaje en apply_whatsapp_job.
do $eligibility$
declare f text; definition text;
 old_pattern text := $p$^(retomar|descartar|confirmar|cancelar|si|sí|no|resumen|quit[aá] |el [0-9]|cambi[aá] )$p$;
 new_pattern text := $p$^(retomar|descartar|confirmar|cancelar|si|sí|no|resumen|quit[aá] |el [0-9]|cambi[aá] |\$?\s*[0-9][0-9.,]*\s*(k|mil|lucas?)?\s*$|[0-9]{4}-[0-9]{2}-[0-9]{2}\s*$)$p$;
begin
 foreach f in array array['public.next_whatsapp_job(text,uuid)','public.due_whatsapp_actors()'] loop
  select pg_get_functiondef(f::regprocedure) into definition;
  if position(old_pattern in definition)=0 then raise exception 'BE08_ELIGIBILITY_DEFINITION_UNEXPECTED'; end if;
  execute replace(definition,old_pattern,new_pattern);
 end loop;
end;
$eligibility$;

commit;
