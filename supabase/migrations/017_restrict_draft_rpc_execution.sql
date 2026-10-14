-- INF-01 / BE-01: estas RPC son internas del webhook, no de la PWA.
-- El webhook usa SUPABASE_SERVICE_ROLE_KEY; sus firmas y cuerpos no cambian.
-- PUBLIC concede permisos implícitos a todos: revocar solo anon no alcanza.
begin;

revoke all on function public.get_active_draft_group(uuid)
  from public, anon, authenticated;
revoke all on function public.confirm_draft_group(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.discard_draft_group(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.get_active_draft_group(uuid) to service_role;
grant execute on function public.confirm_draft_group(uuid, uuid, integer) to service_role;
grant execute on function public.discard_draft_group(uuid, uuid) to service_role;

-- Verificar permisos efectivos, incluidos los heredados. Si una instalación
-- tiene membresías inesperadas, detener la migración para revisarlas.
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.get_active_draft_group(uuid)',
    'public.confirm_draft_group(uuid,uuid,integer)',
    'public.discard_draft_group(uuid,uuid)'
  ] loop
    if has_function_privilege('anon', v_signature, 'execute')
       or has_function_privilege('authenticated', v_signature, 'execute')
       or not has_function_privilege('service_role', v_signature, 'execute') then
      raise exception 'Permisos inesperados para %. Revisar ACL y membresías de roles.', v_signature;
    end if;
  end loop;
end;
$$;

commit;
