-- BE-12: edición de un pendiente bajo el lease y la versión de la lista.
begin;
set local lock_timeout='5s';
create function public.edit_pending_draft_item(p_group uuid,p_user uuid,p_position integer,p_version integer,p_patch jsonb) returns jsonb
language plpgsql set search_path=pg_catalog,public as $$
declare i public.draft_items; fields text[]; new_kind public.transaction_kind; cat uuid; matches integer; amount_value numeric; n integer; month_value text; date_value date;
begin
 perform 1 from public.draft_groups where id=p_group and user_id=p_user and status='open' and version=p_version for update;
 if not found then return jsonb_build_object('updated',false,'reason','stale');end if;
 select * into i from public.draft_items where group_id=p_group and user_id=p_user and position=p_position and status='pending' for update;
 if not found then return jsonb_build_object('updated',false,'reason','target');end if;
 if jsonb_typeof(p_patch) is distinct from 'object' then return jsonb_build_object('updated',false,'reason','invalid');end if;
 select array_agg(key) into fields from jsonb_object_keys(p_patch) key;
 if not coalesce(cardinality(fields)>0 and fields<@array['amount','description','category','currency','occurred_on','installments','first_installment_month','kind']::text[],false) then return jsonb_build_object('updated',false,'reason','invalid');end if;
 if p_patch?'amount' then
  if jsonb_typeof(p_patch->'amount') is distinct from 'number' then return jsonb_build_object('updated',false,'reason','invalid');end if;
  amount_value:=(p_patch->>'amount')::numeric;
  if amount_value<=0 or amount_value>=1000000000000 or amount_value<>round(amount_value,2) then return jsonb_build_object('updated',false,'reason','invalid');end if;
  i.amount:=amount_value;i.missing_fields:=array_remove(i.missing_fields,'amount');
 end if;
 if p_patch?'description' then
  if jsonb_typeof(p_patch->'description') is distinct from 'string' or char_length(btrim(p_patch->>'description')) not between 1 and 160 then return jsonb_build_object('updated',false,'reason','invalid');end if;
  i.description:=btrim(p_patch->>'description');i.missing_fields:=array_remove(i.missing_fields,'description');
 end if;
 if p_patch?'currency' then
  if jsonb_typeof(p_patch->'currency') is distinct from 'string' or p_patch->>'currency' not in('ARS','USD') then return jsonb_build_object('updated',false,'reason','invalid');end if;
  i.currency:=p_patch->>'currency';
 end if;
 new_kind:=i.kind;
 if p_patch?'kind' then
  if jsonb_typeof(p_patch->'kind') is distinct from 'string' or p_patch->>'kind' not in('expense','income') then return jsonb_build_object('updated',false,'reason','invalid');end if;
  new_kind:=(p_patch->>'kind')::public.transaction_kind;
 end if;
 if p_patch?'category' or new_kind<>i.kind then
  if p_patch?'category' and (jsonb_typeof(p_patch->'category') is distinct from 'string' or char_length(btrim(p_patch->>'category')) not between 1 and 40) then return jsonb_build_object('updated',false,'reason','invalid');end if;
  select count(*),(array_agg(id))[1] into matches,cat from public.categories where user_id=p_user and kind=new_kind and active and lower(name)=lower(case when p_patch?'category' then btrim(p_patch->>'category') else 'Otros' end);
  if matches<>1 then return jsonb_build_object('updated',false,'reason','category');end if;
  i.category_id:=cat;
 end if;
 i.kind:=new_kind;
 if p_patch?'occurred_on' then
  if jsonb_typeof(p_patch->'occurred_on') is distinct from 'string' or p_patch->>'occurred_on'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return jsonb_build_object('updated',false,'reason','invalid');end if;
  begin date_value:=(p_patch->>'occurred_on')::date;exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('updated',false,'reason','invalid');end;
  if not isfinite(date_value) or date_value<date '0001-01-01' or date_value>date '9999-12-31' then return jsonb_build_object('updated',false,'reason','invalid');end if;
  i.occurred_on:=date_value;i.missing_fields:=array_remove(i.missing_fields,'date');
 end if;
 n:=i.installments;
 if p_patch?'installments' then
  if jsonb_typeof(p_patch->'installments') is distinct from 'number' or p_patch->>'installments'!~'^[0-9]{1,2}$' then return jsonb_build_object('updated',false,'reason','invalid');end if;
  n:=(p_patch->>'installments')::integer;
  if n<1 or n>60 then return jsonb_build_object('updated',false,'reason','invalid');end if;
 end if;
 if new_kind='income' and n>1 then return jsonb_build_object('updated',false,'reason','installments');end if;
 month_value:=i.first_installment_month;
 if p_patch?'first_installment_month' then
  if jsonb_typeof(p_patch->'first_installment_month') is distinct from 'string' or p_patch->>'first_installment_month'!~'^[0-9]{4}-(0[1-9]|1[0-2])$' or left(p_patch->>'first_installment_month',4)='0000' or n=1 then return jsonb_build_object('updated',false,'reason','invalid');end if;
  month_value:=p_patch->>'first_installment_month';
 end if;
 if n=1 then month_value:=null;
 elsif month_value is null then month_value:=to_char(i.occurred_on,'YYYY-MM');end if;
 if n>1 and (month_value is null or month_value!~'^[0-9]{4}-(0[1-9]|1[0-2])$' or left(month_value,4)='0000') then return jsonb_build_object('updated',false,'reason','installments');end if;
 -- Última cuota dentro del rango admitido por el contrato de fechas.
 if n>1 and (month_value||'-01')::date+make_interval(months=>n-1)>date '9999-12-31' then return jsonb_build_object('updated',false,'reason','invalid');end if;
 update public.draft_items set kind=i.kind,description=i.description,amount=i.amount,currency=i.currency,occurred_on=i.occurred_on,category_id=i.category_id,installments=n,first_installment_month=month_value,missing_fields=i.missing_fields,updated_at=clock_timestamp() where id=i.id;
 return jsonb_build_object('updated',true);
end $$;
-- Solo auxiliar interno de apply_whatsapp_job, nunca endpoint cliente/backend.
revoke all on function public.edit_pending_draft_item(uuid,uuid,integer,integer,jsonb) from public,anon,authenticated,service_role;

do $migration$
declare definition text;
 old_edit text := $old$        update public.draft_items set amount=coalesce((p_action->>'amount')::numeric,amount),description=coalesce(nullif(p_action->>'description',''),description),
          missing_fields=case when p_action->>'amount' is not null then array_remove(missing_fields,'amount') else missing_fields end,
          updated_at=clock_timestamp() where group_id=g.id and user_id=u and position=target and status='pending';
        get diagnostics affected=row_count;$old$;
 new_edit text := $new$        if p_action?'patch' then
          outcome:=public.edit_pending_draft_item((p_action->>'group_id')::uuid,u,target,(p_action->>'version')::integer,p_action->'patch');
        else
          -- Compatibilidad con trabajos/runtime previos; mismos controles de datos.
          outcome:=public.edit_pending_draft_item(g.id,u,target,g.version,jsonb_strip_nulls(jsonb_build_object('amount',p_action->'amount','description',p_action->'description','category',p_action->'category')));
        end if;
        affected:=case when (outcome->>'updated')::boolean then 1 else 0 end;$new$;
 old_reply text := $old$if affected<>1 then reply:='No encontré ese movimiento en tu lista pendiente.';$old$;
 new_reply text := $new$if affected<>1 then
        reply:=case when action<>'edit' then 'No encontré ese movimiento en tu lista pendiente.'
          when outcome->>'reason'='category' then 'No encontré esa categoría activa para este gasto o ingreso. Usá una de tus categorías de la app. No modifiqué la lista.'
          when outcome->>'reason'='stale' then 'La lista cambió. Revisala con RESUMEN y repetí la corrección. No modifiqué la lista.'
          when outcome->>'reason'='target' then 'No encontré ese movimiento en tu lista pendiente.'
          else 'No pude aplicar el cambio: revisá los datos y las cuotas. No modifiqué la lista.' end;$new$;
begin
 select pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure) into definition;
 if position(old_edit in definition)=0 or position(old_reply in definition)=0 or position('public.complete_pending_draft_item' in definition)=0 or position('and s.shown_group_id=g.id and s.shown_version=g.version' in definition)=0 then raise exception 'BE12_APPLY_DEFINITION_UNEXPECTED';end if;
 execute replace(replace(definition,old_edit,new_edit),old_reply,new_reply);
end $migration$;
-- Adapta únicamente la elegibilidad de las formas nuevas de edición.
do $eligibility$
declare f text; definition text;
 old_pattern text := $p$|el [0-9]|cambi[aá] $p$;
 new_pattern text := $p$|(el|la) +(movimiento +|operaci[oó]n +|gasto +|ingreso +)?[0-9]|(cambi[aá]|correg[ií]|corrige|modific[aá]|edit[aá]) $p$;
begin
 foreach f in array array['public.next_whatsapp_job(text,uuid)','public.due_whatsapp_actors()'] loop
  select pg_get_functiondef(f::regprocedure) into definition;
  if position(old_pattern in definition)=0 then raise exception 'BE12_ELIGIBILITY_DEFINITION_UNEXPECTED';end if;
  execute replace(definition,old_pattern,new_pattern);
 end loop;
end $eligibility$;
notify pgrst,'reload schema';
commit;
