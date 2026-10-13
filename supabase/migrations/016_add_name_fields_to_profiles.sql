-- Migración 016: Agregar campos first_name y last_name a perfiles y actualizar bootstrap_user

-- 1. Agregar columnas en public.profiles
alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

-- 2. Permitir a los usuarios actualizar su propio perfil (nombre y apellido)
drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile" 
on public.profiles for update 
using (auth.uid() = id)
with check (auth.uid() = id);

-- 3. Trigger de protección: Asegurar que un cliente normal no pueda cambiar su rol o vencimiento
create or replace function public.protect_profile_system_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.subscription_status := old.subscription_status;
    new.subscription_until := old.subscription_until;
    new.id := old.id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tr_protect_profile_system_fields on public.profiles;
create trigger tr_protect_profile_system_fields
before update on public.profiles
for each row
execute function public.protect_profile_system_fields();

-- 4. Actualizar función bootstrap_user para extraer first_name y last_name de raw_user_meta_data
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
  v_first_name text;
  v_last_name text;
begin
  -- 1. Crear app_settings y whatsapp_links iniciales
  insert into public.app_settings(user_id) values (new.id) on conflict do nothing;
  insert into public.whatsapp_links(user_id) values (new.id) on conflict do nothing;

  -- 2. Detectar datos de metadatos de registro
  v_code_text := upper(trim(coalesce(new.raw_user_meta_data->>'invitation_code', '')));
  v_first_name := nullif(trim(coalesce(new.raw_user_meta_data->>'first_name', '')), '');
  v_last_name := nullif(trim(coalesce(new.raw_user_meta_data->>'last_name', '')), '');

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

  -- 3. Crear perfil de usuario con nombre y apellido
  insert into public.profiles(id, email, first_name, last_name, role, subscription_status, subscription_until)
    values (new.id, new.email, v_first_name, v_last_name, 'client', v_status, v_new_until)
    on conflict (id) do update
    set first_name = coalesce(excluded.first_name, public.profiles.first_name),
        last_name = coalesce(excluded.last_name, public.profiles.last_name),
        subscription_status = excluded.subscription_status,
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

-- 5. Backfill de usuarios existentes que ya tengan metadata en auth.users
update public.profiles p
set first_name = nullif(trim(coalesce(u.raw_user_meta_data->>'first_name', '')), ''),
    last_name = nullif(trim(coalesce(u.raw_user_meta_data->>'last_name', '')), '')
from auth.users u
where u.id = p.id
  and p.first_name is null
  and p.last_name is null;
