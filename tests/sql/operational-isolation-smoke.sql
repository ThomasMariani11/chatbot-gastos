-- Datos sintéticos; toda escritura se revierte. No confirmar la transacción.
begin;
set local lock_timeout='3s';
set local statement_timeout='25s';
do $$
declare
 a uuid := '01800000-0000-4000-8000-000000000001';
 b uuid := '01800000-0000-4000-8000-000000000002';
 ga uuid := '01810000-0000-4000-8000-000000000001';
 gb uuid := '01810000-0000-4000-8000-000000000002';
 ca uuid;
 cb uuid;
 result jsonb;
 old_code text;
 caller text;
 operation text;
 denied integer := 0;
 secured boolean := exists(select 1 from supabase_migrations.schema_migrations where version='019');
begin
 if exists(select 1 from auth.users where id in(a,b))
  or exists(select 1 from public.draft_groups where id in(ga,gb))
  or exists(select 1 from public.invitation_codes where code in('INF02-ROLLBACK-A','INF02-ROLLBACK-B'))
  or exists(select 1 from public.whatsapp_links where wa_id='synthetic-inf02-verified') then
   raise exception 'Identificadores ficticios ocupados; no modificar datos existentes.';
 end if;
 insert into public.invitation_codes(code,duration_days) values('INF02-ROLLBACK-A',30),('INF02-ROLLBACK-B',30);
 insert into auth.users(id,email,raw_user_meta_data) values
 (a,'inf02-rollback-a@example.invalid','{"invitation_code":"INF02-ROLLBACK-A"}'),
 (b,'inf02-rollback-b@example.invalid','{"invitation_code":"INF02-ROLLBACK-B"}');
 if (select count(*) from public.profiles where id in(a,b) and subscription_status='active' and role='client')<>2 then
  raise exception 'No se inicializaron las cuentas ficticias esperadas.';
 end if;
 select id into ca from public.categories where user_id=a and kind='expense' limit 1;
 select id into cb from public.categories where user_id=b and kind='expense' limit 1;
 insert into public.draft_groups(id,user_id) values(ga,a),(gb,b);
 insert into public.draft_items(group_id,user_id,position,description,amount,currency,category_id,installments) values
 (ga,a,1,'Fixture INF02',100,'ARS',ca,3),(gb,b,1,'Fixture INF02',200,'ARS',cb,1);

 set local role service_role;
 update public.whatsapp_links set status='active',wa_id='synthetic-inf02-verified',linked_at=now() where user_id=a;
 update public.profiles set phone_number='synthetic-inf02-verified' where id=a;
 reset role;
 perform set_config('request.jwt.claim.sub',a::text,true);
 set local role authenticated;
 result := public.request_whatsapp_link_code();
 if result->>'code' !~ '^[1-9][0-9]{5}$' then raise exception 'Formato incorrecto del código.'; end if;
 old_code := result->>'code';
 reset role;
 if not exists(select 1 from public.whatsapp_links where user_id=a and status='active' and wa_id='synthetic-inf02-verified'
  and link_code_hash=encode(sha256(convert_to(old_code,'UTF8')),'hex') and link_code_expires_at=now()+interval '10 minutes') then
  raise exception 'La solicitud alteró el vínculo o no guardó hash y vencimiento correctos.';
 end if;
 if exists(select 1 from public.whatsapp_links where user_id=b and (status<>'pending' or link_code_hash is not null or wa_id is not null)) then
  raise exception 'La solicitud afectó al otro usuario.';
 end if;
 set local role authenticated;
 result := public.request_whatsapp_link_code();
 if result->>'code'=old_code then raise exception 'No se renovó el código.'; end if;
 reset role;
 if exists(select 1 from public.whatsapp_links where user_id=a and link_code_hash=encode(sha256(convert_to(old_code,'UTF8')),'hex')) then
  raise exception 'El código anterior sigue vigente.';
 end if;
 set local role anon;
 begin
  perform public.request_whatsapp_link_code();
  raise exception 'La solicitud anónima fue aceptada.';
 exception when insufficient_privilege then null;
 end;
 reset role;

 if secured then
  foreach caller in array array['anon','authenticated'] loop
   execute format('set local role %I',caller);
   perform set_config('request.jwt.claim.sub',case when caller='authenticated' then a::text else '' end,true);
   foreach operation in array array[
    'insert into public.draft_groups(user_id) values($1)',
    'update public.draft_groups set status=''discarded'' where user_id=$1',
    'delete from public.draft_groups where user_id=$1',
    'insert into public.draft_items(group_id,user_id,position,description,amount) values($2,$1,2,''Fixture'',10)',
    'update public.draft_items set amount=999 where user_id=$1',
    'delete from public.draft_items where user_id=$1',
    'insert into public.whatsapp_message_queue(wa_message_id,wa_id,user_id,payload) values(''inf02-fixture'',''synthetic'',$1,''{}'')',
    'update public.whatsapp_message_queue set status=''processed'' where user_id=$1',
    'delete from public.whatsapp_message_queue where user_id=$1',
    'insert into public.whatsapp_links(user_id) values($1)',
    'update public.whatsapp_links set status=''revoked'' where user_id=$1',
    'delete from public.whatsapp_links where user_id=$1'
   ] loop
    begin
     execute operation using a,ga;
     raise exception 'Escritura inesperadamente permitida a %.',caller;
    exception when insufficient_privilege then denied:=denied+1;
    end;
   end loop;
   reset role;
  end loop;
  if denied<>24 then raise exception 'Número de rechazos incorrecto.'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  set local role authenticated;
  if (select count(*) from public.draft_groups)<>1 or (select count(*) from public.draft_items)<>1
   or (select count(*) from public.whatsapp_links)<>1 then raise exception 'Falló la lectura aislada.'; end if;
  begin
   update public.profiles set phone_number='synthetic-unverified' where id=a;
   raise exception 'Permitió modificar el teléfono verificado.';
  exception when insufficient_privilege then null;
  end;
  begin
   perform 1 from public.whatsapp_message_queue;
   raise exception 'Permitió leer la cola.';
  exception when insufficient_privilege then null;
  end;
  update public.profiles set first_name='Fixture' where id=a;
  reset role;
  set local role service_role;
  begin
   insert into public.draft_items(group_id,user_id,position,description,amount) values(gb,a,2,'Cross owner',10);
   raise exception 'Permitió un grupo ajeno.';
  exception when foreign_key_violation then null;
  end;
  begin
   update public.draft_items set category_id=cb where group_id=ga;
   raise exception 'Permitió categoría ajena.';
  exception when foreign_key_violation then null;
  end;
  begin
   insert into public.transactions(user_id,kind,description,amount_ars,source,category_id) values(a,'expense','Cross owner',10,'pwa',cb);
   raise exception 'Permitió categoría ajena en un movimiento.';
  exception when foreign_key_violation then null;
  end;
  reset role;
 end if;

 set local role service_role;
 result := public.get_active_draft_group(a);
 if not (result->>'found')::boolean then raise exception 'Falló la lectura del backend.'; end if;
 result := public.confirm_draft_group(ga,a,1);
 if not (result->>'success')::boolean or (result->>'created_transactions')::integer<>3 then
  raise exception 'Falló la confirmación del backend.';
 end if;
 result := public.confirm_draft_group(ga,a,1);
 if (result->>'success')::boolean then raise exception 'Aceptó doble confirmación.'; end if;
 result := public.discard_draft_group(gb,b);
 if not (result->>'success')::boolean then raise exception 'Falló el descarte del backend.'; end if;
 reset role;
 if (select sum(amount_ars) from public.transactions where user_id=a)<>100
  or (select count(*) from public.transactions where user_id=a)<>3
  or exists(select 1 from public.transactions where user_id=b) then raise exception 'Importes o cantidades incorrectos.'; end if;
end;
$$;
rollback;
select jsonb_build_object(
 'assertions_passed',true,
 'migration_019_applied',exists(select 1 from supabase_migrations.schema_migrations where version='019'),
 'transaction_rolled_back',true,
 'remaining_fixture_users',(select count(*) from auth.users where id in('01800000-0000-4000-8000-000000000001','01800000-0000-4000-8000-000000000002')),
 'remaining_fixture_groups',(select count(*) from public.draft_groups where id in('01810000-0000-4000-8000-000000000001','01810000-0000-4000-8000-000000000002')),
 'remaining_fixture_transactions',(select count(*) from public.transactions where user_id in('01800000-0000-4000-8000-000000000001','01800000-0000-4000-8000-000000000002')),
 'remaining_fixture_codes',(select count(*) from public.invitation_codes where code in('INF02-ROLLBACK-A','INF02-ROLLBACK-B'))
) as validation;
