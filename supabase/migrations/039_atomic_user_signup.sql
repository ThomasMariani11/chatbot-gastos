-- BE-13: Auth, perfil, configuración e invitación pertenecen a la misma transacción.
-- No modifica cuentas existentes ni el administrador inicial (fuera de alcance).
begin;
create or replace function public.bootstrap_user()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_code_text text:=upper(trim(coalesce(new.raw_user_meta_data->>'invitation_code','')));
  v_first_name text:=nullif(trim(coalesce(new.raw_user_meta_data->>'first_name','')),'');
  v_last_name text:=nullif(trim(coalesce(new.raw_user_meta_data->>'last_name','')),'');
  v_code public.invitation_codes%rowtype;
  v_status text:='pending_code';
  v_until timestamptz:=null;
  v_count integer;
begin
  -- Sin código se conserva el alta pendiente usada por Auth administrado y el canje posterior.
  if v_code_text<>'' then
    -- STRICT rechaza tanto un código ausente/usado como códigos normalizados ambiguos.
    select * into strict v_code from public.invitation_codes
      where upper(trim(code))=v_code_text and not is_used for update;
    v_status:='active';
    if v_code.duration_days is not null then
      v_until:=now()+make_interval(days=>v_code.duration_days);
    end if;
  end if;
  insert into public.app_settings(user_id) values(new.id);
  insert into public.whatsapp_links(user_id) values(new.id);
  -- El rol no procede de metadata; el alta nunca concede administración.
  insert into public.profiles(id,email,first_name,last_name,role,subscription_status,subscription_until)
    values(new.id,new.email,v_first_name,v_last_name,'client',v_status,v_until);
  insert into public.categories(user_id, kind, name, color, icon) values
    (new.id,'expense','Alimentación','#20b984','utensils'), (new.id,'expense','Transporte','#655ad8','bus'),
    (new.id,'expense','Vivienda','#f4b44d','home'), (new.id,'expense','Servicios','#4f9bd8','receipt'),
    (new.id,'expense','Salud','#ea7172','heart'), (new.id,'expense','Educación','#65778c','book'),
    (new.id,'expense','Ocio','#d56bb1','party'), (new.id,'expense','Compras','#dc8a43','bag'),
    (new.id,'expense','Impuestos','#78857f','landmark'), (new.id,'expense','Deudas','#b45b5b','card'),
    (new.id,'expense','Otros','#9aa5a1','circle'), (new.id,'income','Sueldo','#20b984','wallet'),
    (new.id,'income','Freelance','#655ad8','briefcase'), (new.id,'income','Ventas','#4f9bd8','tag'),
    (new.id,'income','Rendimientos','#f4b44d','chart'), (new.id,'income','Otros','#9aa5a1','circle');
  get diagnostics v_count=row_count;
  if v_code_text<>'' then
    update public.invitation_codes set is_used=true,used_by=new.id,used_at=now() where id=v_code.id and not is_used;
    if not exists(select 1 from public.invitation_codes where id=v_code.id and is_used
      and used_by=new.id and used_at=now()) then
      raise exception 'REGISTRATION_INITIALIZATION_FAILED';
    end if;
  end if;
  if v_count<>16 or (select count(*) from public.categories where user_id=new.id)<>16
    or not exists(select 1 from public.app_settings where user_id=new.id)
    or not exists(select 1 from public.whatsapp_links where user_id=new.id)
    or not exists(select 1 from public.profiles where id=new.id and role='client'
      and email is not distinct from new.email and first_name is not distinct from v_first_name
      and last_name is not distinct from v_last_name and subscription_status=v_status
      and subscription_until is not distinct from v_until) then
    raise exception 'REGISTRATION_INITIALIZATION_FAILED';
  end if;
  return new;
exception when others then
  -- Se revierte también auth.users. No registrar email, metadata, código ni SQLERRM.
  raise warning '%',json_build_object('event','bootstrap_user_failed','sqlstate',SQLSTATE)::text;
  raise exception using errcode='P0001',message='REGISTRATION_INITIALIZATION_FAILED',detail='',hint='';
end $$;
-- Solo el trigger de Auth invoca esta función; no constituye una RPC de reparación.
revoke all on function public.bootstrap_user() from public,anon,authenticated,service_role;
commit;
