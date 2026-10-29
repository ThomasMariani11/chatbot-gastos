-- BE-22: Soporte para eliminación y edición múltiple en el borrador de WhatsApp.
-- Permite que 'remove' reciba p_action->'positions' (array) y 'edit' reciba p_action->'edits' (array).
-- Preserva compatibilidad completa con contratos anteriores (position y patch unitarios).
begin;
set local lock_timeout = '5s';

do $migration$
declare
  definition text;
  old_remove text := $old$      target:=(p_action->>'position')::integer;
      if action='remove' then
        update public.draft_items set status='removed',updated_at=clock_timestamp() where group_id=g.id and user_id=u and position=target and status='pending';
        get diagnostics affected=row_count;$old$;
  new_remove text := $new$      target:=(p_action->>'position')::integer;
      if action='remove' then
        if p_action?'positions' and jsonb_typeof(p_action->'positions')='array' and jsonb_array_length(p_action->'positions')>0 then
          update public.draft_items set status='removed',updated_at=clock_timestamp()
            where group_id=g.id and user_id=u and position in (select jsonb_array_elements_text(p_action->'positions')::integer) and status='pending';
        else
          update public.draft_items set status='removed',updated_at=clock_timestamp() where group_id=g.id and user_id=u and position=target and status='pending';
        end if;
        get diagnostics affected=row_count;$new$;

  old_edit text := $old$        if p_action?'patch' then
          outcome:=public.edit_pending_draft_item((p_action->>'group_id')::uuid,u,target,(p_action->>'version')::integer,p_action->'patch');
        else
          -- Compatibilidad con trabajos/runtime previos; mismos controles de datos.
          outcome:=public.edit_pending_draft_item(g.id,u,target,g.version,jsonb_strip_nulls(jsonb_build_object('amount',p_action->'amount','description',p_action->'description','category',p_action->'category')));
        end if;
        affected:=case when (outcome->>'updated')::boolean then 1 else 0 end;$old$;

  new_edit text := $new$        if p_action?'edits' and jsonb_typeof(p_action->'edits')='array' and jsonb_array_length(p_action->'edits')>0 then
          declare
            edit_elem jsonb;
          begin
            affected:=0;
            for edit_elem in select * from jsonb_array_elements(p_action->'edits') loop
              outcome:=public.edit_pending_draft_item(
                (p_action->>'group_id')::uuid,
                u,
                (edit_elem->>'position')::integer,
                (p_action->>'version')::integer,
                edit_elem->'patch'
              );
              if (outcome->>'updated')::boolean then
                affected:=affected+1;
              end if;
            end loop;
          end;
        elsif p_action?'patch' then
          outcome:=public.edit_pending_draft_item((p_action->>'group_id')::uuid,u,target,(p_action->>'version')::integer,p_action->'patch');
          affected:=case when (outcome->>'updated')::boolean then 1 else 0 end;
        else
          -- Compatibilidad con trabajos/runtime previos; mismos controles de datos.
          outcome:=public.edit_pending_draft_item(g.id,u,target,g.version,jsonb_strip_nulls(jsonb_build_object('amount',p_action->'amount','description',p_action->'description','category',p_action->'category')));
          affected:=case when (outcome->>'updated')::boolean then 1 else 0 end;
        end if;$new$;

  old_reply text := $old$if affected<>1 then$old$;
  new_reply text := $new$if affected<1 then$new$;
begin
  select replace(pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure), chr(13), '') into definition;
  if position(replace(old_remove, chr(13), '') in definition) = 0 or
     position(replace(old_edit, chr(13), '') in definition) = 0 or
     position(replace(old_reply, chr(13), '') in definition) = 0 then
    raise exception 'BE22_APPLY_DEFINITION_UNEXPECTED';
  end if;
  execute replace(replace(replace(definition,
    replace(old_remove, chr(13), ''), replace(new_remove, chr(13), '')),
    replace(old_edit, chr(13), ''), replace(new_edit, chr(13), '')),
    replace(old_reply, chr(13), ''), replace(new_reply, chr(13), ''));
end;
$migration$;

notify pgrst, 'reload schema';
commit;
