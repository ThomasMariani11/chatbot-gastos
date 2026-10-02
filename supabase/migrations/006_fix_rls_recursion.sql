-- Migración 006: Prevenir recursión infinita en RLS y proveer RPC seguro get_my_role

-- 1. Función security definer para comprobar admin sin disparar RLS recursivo
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- 2. Función RPC para obtener el rol del usuario actual de forma infalible
create or replace function public.get_my_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'client'
  );
$$;

-- 3. Actualizar políticas de profiles para usar is_admin()
drop policy if exists "admins can read all profiles" on public.profiles;
create policy "admins can read all profiles" 
on public.profiles for select 
using (public.is_admin());

drop policy if exists "admins can update profiles" on public.profiles;
create policy "admins can update profiles" 
on public.profiles for update 
using (public.is_admin());

-- 4. Actualizar políticas de invitation_codes para usar is_admin()
drop policy if exists "admins manage invitation codes" on public.invitation_codes;
create policy "admins manage invitation codes" 
on public.invitation_codes for all 
using (public.is_admin());
