-- Migración 005: Sistema de Administración, Perfiles de Usuario y Códigos de Invitación (SaaS)

-- 1. Tabla de Perfiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'client' check (role in ('admin', 'client')),
  subscription_status text not null default 'active' check (subscription_status in ('active', 'expired', 'suspended')),
  subscription_until timestamptz, -- null = acceso vitalicio / perpetuo
  phone_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Tabla de Códigos de Invitación / Licencias
create table if not exists public.invitation_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) between 4 and 30),
  duration_days integer check (duration_days is null or duration_days > 0), -- null = vitalicio
  is_used boolean not null default false,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

-- Índices de búsqueda rápida
create index if not exists invitation_codes_code_idx on public.invitation_codes(upper(code));
create index if not exists profiles_role_idx on public.profiles(role);

-- 3. Habilitar RLS
alter table public.profiles enable row level security;
alter table public.invitation_codes enable row level security;

-- 4. Políticas RLS para profiles
drop policy if exists "users can read own profile" on public.profiles;
create policy "users can read own profile" 
on public.profiles for select 
using (auth.uid() = id);

drop policy if exists "admins can read all profiles" on public.profiles;
create policy "admins can read all profiles" 
on public.profiles for select 
using (
  exists (
    select 1 from public.profiles 
    where id = auth.uid() and role = 'admin'
  )
);

drop policy if exists "admins can update profiles" on public.profiles;
create policy "admins can update profiles" 
on public.profiles for update 
using (
  exists (
    select 1 from public.profiles 
    where id = auth.uid() and role = 'admin'
  )
);

-- 5. Políticas RLS para invitation_codes
drop policy if exists "admins manage invitation codes" on public.invitation_codes;
create policy "admins manage invitation codes" 
on public.invitation_codes for all 
using (
  exists (
    select 1 from public.profiles 
    where id = auth.uid() and role = 'admin'
  )
);

-- 6. Función para verificar si un código es válido antes del registro (pública, segura)
create or replace function public.check_invitation_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code record;
begin
  select duration_days, is_used into v_code
  from public.invitation_codes
  where upper(trim(code)) = upper(trim(p_code));

  if not found then
    return jsonb_build_object('valid', false, 'error', 'El código de invitación no existe.');
  end if;

  if v_code.is_used then
    return jsonb_build_object('valid', false, 'error', 'Este código de invitación ya fue utilizado.');
  end if;

  return jsonb_build_object(
    'valid', true,
    'duration_days', v_code.duration_days
  );
end;
$$;

-- 7. Función para canjear un código al registrarse (atómica y segura)
create or replace function public.redeem_invitation_code(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code record;
  v_new_until timestamptz;
  v_user_email text;
begin
  -- Buscar y bloquear fila del código
  select * into v_code
  from public.invitation_codes
  where upper(trim(code)) = upper(trim(p_code))
    and is_used = false
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Código de invitación inválido o ya utilizado.');
  end if;

  -- Calcular vencimiento
  if v_code.duration_days is not null then
    v_new_until := now() + (v_code.duration_days || ' days')::interval;
  else
    v_new_until := null;
  end if;

  -- Marcar código como usado
  update public.invitation_codes
  set is_used = true,
      used_by = p_user_id,
      used_at = now()
  where id = v_code.id;

  -- Obtener email del usuario
  select email into v_user_email from auth.users where id = p_user_id;

  -- Actualizar o insertar perfil
  insert into public.profiles (id, email, role, subscription_status, subscription_until)
  values (
    p_user_id,
    v_user_email,
    'client',
    'active',
    v_new_until
  )
  on conflict (id) do update
  set subscription_status = 'active',
      subscription_until = v_new_until,
      updated_at = now();

  return jsonb_build_object(
    'success', true,
    'duration_days', v_code.duration_days,
    'subscription_until', v_new_until
  );
end;
$$;

-- 8. Actualizar bootstrap_user para crear perfil por defecto si no existe
create or replace function public.bootstrap_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_settings(user_id) values (new.id) on conflict do nothing;
  insert into public.whatsapp_links(user_id) values (new.id) on conflict do nothing;
  insert into public.profiles(id, email, role, subscription_status)
    values (new.id, new.email, 'client', 'active')
    on conflict (id) do nothing;
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
end $$;

-- 9. Migrar usuarios existentes (Tu cuenta pasa a ser ADMIN vitalicio)
insert into public.profiles (id, email, role, subscription_status, subscription_until)
select 
  id, 
  email, 
  'admin', 
  'active', 
  null
from auth.users
on conflict (id) do update set role = 'admin', subscription_status = 'active';

-- Sincronizar teléfonos de WhatsApp ya vinculados si existen
update public.profiles p
set phone_number = w.wa_id
from public.whatsapp_links w
where w.user_id = p.id and w.wa_id is not null and w.status = 'active';
