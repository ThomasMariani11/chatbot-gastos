-- INF-09: modificar únicamente el mensaje de diagnóstico del alta existente.
-- No cambia su semántica, grants, search_path ni datos; BE-13 conserva su alcance.
begin;
do $migration$
declare
  definition text;
  unsafe_warning constant text := 'raise warning ''Error en bootstrap_user para %: %'', new.id, sqlerrm;';
  safe_warning constant text := 'raise warning ''%'', json_build_object(''event'', ''bootstrap_user_failed'', ''sqlstate'', SQLSTATE)::text;';
begin
  select pg_get_functiondef('public.bootstrap_user()'::regprocedure) into definition;
  if position(safe_warning in definition) > 0 then return; end if;
  if position(unsafe_warning in definition) = 0 then
    raise exception 'INF09_BOOTSTRAP_DEFINITION_UNEXPECTED';
  end if;
  execute replace(definition, unsafe_warning, safe_warning);
end;
$migration$;
commit;
