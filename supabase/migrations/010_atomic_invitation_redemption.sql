-- Migración 010: Canje atómico de código de invitación en bootstrap_user

create or replace function public.bootstrap_user() 
returns trigger 
language plpgsql 
security definer 
set search_path = public 
as $$
declare
  v_code_text text;
  v_code record;
  v_new_until timestamptz := null;
  v_status text := 'pending_code';
begin
  -- 1. Crear app_settings y whatsapp_links iniciales
  insert into public.app_settings(user_id) values (new.id) on conflict do nothing;
  insert into public.whatsapp_links(user_id) values (new.id) on conflict do nothing;

  -- 2. Detectar si el usuario envió un código de invitación en sus metadatos de registro
  v_code_text := upper(trim(coalesce(new.raw_user_meta_data->>'invitation_code', '')));

  if v_code_text <> '' then
    -- Buscar código disponible con bloqueo
    select * into v_code
    from public.invitation_codes
    where upper(trim(code)) = v_code_text
      and is_used = false
    for update;

    if found then
      -- Calcular fecha de vencimiento
      if v_code.duration_days is not null then
        v_new_until := now() + (v_code.duration_days || ' days')::interval;
      else
        v_new_until := null;
      end if;

      -- Marcar código como usado por este nuevo usuario
      update public.invitation_codes
      set is_used = true,
          used_by = new.id,
          used_at = now()
      where id = v_code.id;

      v_status := 'active';
    end if;
  end if;

  -- 3. Crear perfil de usuario con el estado correspondiente
  insert into public.profiles(id, email, role, subscription_status, subscription_until)
    values (new.id, new.email, 'client', v_status, v_new_until)
    on conflict (id) do update
    set subscription_status = excluded.subscription_status,
        subscription_until = excluded.subscription_until,
        updated_at = now();

  -- 4. Categorías por defecto
  insert into public.categories(user_id, kind, name, color, icon) values
    (new.id,'expense','Alimentación','#20b984','utensils'), (new.id,'expense','Transporte','#655ad8','bus'),
    (new.id,'expense','Vivienda','#f4b44d','home'), (new.id,'expense','Servicios','#4f9bd8','receipt'),
    (new.id,'expense','Salud','#ea7172','heart'), (new.id,'expense','Educación','#65778c','book'),
    (new.id,'expense','Ocio','#d56bb1','party'), (new.id,'expense','Compras','#dc8a43','bag'),
    (new.id,'expense','Impuestos','#78857f','landmark'), (new.id,'expense','Deudas','#b45b5b','card'),
    (new.id,'expense','Otros','#9aa5a1','circle'), (new.id,'income','Sueldo','#20b984','wallet'),
    (new.id,'income','Freelance','#655ad8','briefcase'), (new.id,'income','Ventas','#4f9bd8','tag'),
    (new.id,'income','Rendimientos','#f4b44d','chart'), (new.id,'income','Otros','#9aa5a1','circle')
    on conflict do nothing;

  return new;
exception
  when others then
    raise warning 'Error en bootstrap_user para %: %', new.id, sqlerrm;
    return new;
end;
$$;
