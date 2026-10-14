-- Prueba autorizada con datos ficticios. Nunca confirmar esta transacción.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $$
declare
  a uuid := '01700000-0000-4000-8000-000000000001';
  b uuid := '01700000-0000-4000-8000-000000000002';
  ga uuid := '01710000-0000-4000-8000-000000000001';
  gb uuid := '01710000-0000-4000-8000-000000000002';
  caller text;
  operation text;
  result jsonb;
  denied_count integer := 0;
begin
  if exists(select 1 from auth.users where id in (a,b))
     or exists(select 1 from public.draft_groups where id in (ga,gb))
     or exists(select 1 from public.invitation_codes where code in ('INF01-ROLLBACK-A','INF01-ROLLBACK-B')) then
    raise exception 'Identificadores de prueba ocupados; no tocar datos existentes.';
  end if;

  insert into public.invitation_codes(code,duration_days) values ('INF01-ROLLBACK-A',30),('INF01-ROLLBACK-B',30);
  insert into auth.users(id,email,raw_user_meta_data) values
    (a,'inf01-rollback-a@example.invalid','{"invitation_code":"INF01-ROLLBACK-A"}'),
    (b,'inf01-rollback-b@example.invalid','{"invitation_code":"INF01-ROLLBACK-B"}');
  if (select count(*) from public.profiles where id in (a,b) and role='client' and subscription_status='active') <> 2 then
    raise exception 'El bootstrap no produjo las cuentas ficticias esperadas.';
  end if;
  insert into public.draft_groups(id,user_id) values(ga,a),(gb,b);
  insert into public.draft_items(group_id,user_id,position,kind,description,amount,currency,occurred_on,installments,wa_message_id) values
    (ga,a,1,'expense','Prueba supermercado',15000,'ARS','2026-10-14',1,'inf01-rollback-a'),
    (ga,a,2,'income','Prueba diseño',80,'USD','2026-10-14',1,'inf01-rollback-a'),
    (ga,a,3,'expense','Prueba cuotas',100,'ARS','2026-10-14',3,'inf01-rollback-a'),
    (gb,b,1,'expense','Prueba transporte',4000,'ARS','2026-10-14',1,'inf01-rollback-b');

  foreach caller in array array['anon','authenticated'] loop
    execute format('set local role %I',caller);
    perform set_config('request.jwt.claim.sub',case when caller='authenticated' then a::text else '' end,true);
    foreach operation in array array[
      'select public.get_active_draft_group($1::uuid)',
      'select public.confirm_draft_group($2::uuid,$1::uuid,1)',
      'select public.confirm_draft_group($2::uuid,$1::uuid)',
      'select public.discard_draft_group($2::uuid,$1::uuid)'
    ] loop
      begin
        execute operation using b,gb;
        raise exception 'La llamada de % no fue rechazada.',caller;
      exception when insufficient_privilege then
        denied_count := denied_count+1;
      end;
    end loop;
    reset role;
  end loop;
  if denied_count <> 8
     or exists(select 1 from public.transactions where user_id in(a,b))
     or (select count(*) from public.draft_items where user_id in(a,b) and status='pending') <> 4 then
    raise exception 'Falló la denegación o se alteraron los datos ficticios.';
  end if;

  set local role service_role;
  perform set_config('request.jwt.claim.sub','',true);
  result := public.get_active_draft_group(a);
  if not coalesce((result->>'found')::boolean,false) or result->>'group_id' <> ga::text
     or jsonb_array_length(result->'items') <> 3 then
    raise exception 'Falló la lectura legítima.';
  end if;
  result := public.confirm_draft_group(gb,a,1);
  if coalesce((result->>'success')::boolean,true) then raise exception 'Aceptó propietario incorrecto.'; end if;
  result := public.confirm_draft_group(gb,b,99);
  if coalesce((result->>'success')::boolean,true) then raise exception 'Aceptó versión incorrecta.'; end if;
  result := public.confirm_draft_group(ga,a,1);
  if not coalesce((result->>'success')::boolean,false) or (result->>'created_transactions')::integer <> 5
     or (result->>'confirmed_movements')::integer <> 3 then
    raise exception 'Falló el guardado legítimo.';
  end if;
  result := public.confirm_draft_group(ga,a,1);
  if coalesce((result->>'success')::boolean,true) then raise exception 'Aceptó doble confirmación.'; end if;
  result := public.discard_draft_group(gb,b);
  if not coalesce((result->>'success')::boolean,false) then raise exception 'Falló el descarte legítimo.'; end if;
  reset role;

  if (select count(*) from public.transactions where user_id=a) <> 5
     or (select sum(amount_ars) from public.transactions where user_id=a and currency='ARS') <> 15100
     or (select sum(amount_ars) from public.transactions where user_id=a and currency='USD') <> 80
     or (select sum(amount_ars) from public.transactions where user_id=a and installment_count=3) <> 100
     or exists(select 1 from public.transactions where user_id=b)
     or not exists(select 1 from public.draft_groups where id=ga and status='confirmed')
     or not exists(select 1 from public.draft_groups where id=gb and status='discarded') then
    raise exception 'Los resultados financieros o estados no coinciden.';
  end if;
end;
$$;

rollback;

-- Solo se alcanza esta consulta si todas las aserciones anteriores pasaron.
select jsonb_build_object(
  'assertions_passed',true,
  'transaction_rolled_back',true,
  'remaining_fixture_users',(select count(*) from auth.users where id in ('01700000-0000-4000-8000-000000000001','01700000-0000-4000-8000-000000000002')),
  'remaining_fixture_groups',(select count(*) from public.draft_groups where id in ('01710000-0000-4000-8000-000000000001','01710000-0000-4000-8000-000000000002')),
  'remaining_fixture_items',(select count(*) from public.draft_items where user_id in ('01700000-0000-4000-8000-000000000001','01700000-0000-4000-8000-000000000002')),
  'remaining_fixture_transactions',(select count(*) from public.transactions where user_id in ('01700000-0000-4000-8000-000000000001','01700000-0000-4000-8000-000000000002')),
  'remaining_fixture_codes',(select count(*) from public.invitation_codes where code in ('INF01-ROLLBACK-A','INF01-ROLLBACK-B'))
) as validation;
