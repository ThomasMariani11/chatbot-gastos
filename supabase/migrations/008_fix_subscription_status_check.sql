-- Migración 008: Permitir 'pending_code' en subscription_status y proteger bootstrap_user contra fallos

alter table public.profiles drop constraint if exists profiles_subscription_status_check;

alter table public.profiles 
  add constraint profiles_subscription_status_check 
  check (subscription_status in ('active', 'expired', 'suspended', 'pending_code'));

create or replace function public.bootstrap_user() 
returns trigger 
language plpgsql 
security definer 
set search_path = public 
as $$
begin
  insert into public.app_settings(user_id) values (new.id) on conflict do nothing;
  insert into public.whatsapp_links(user_id) values (new.id) on conflict do nothing;
  insert into public.profiles(id, email, role, subscription_status, subscription_until)
    values (new.id, new.email, 'client', 'pending_code', null)
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
exception
  when others then
    -- Loguear advertencia para no interrumpir el registro de auth.users ante cualquier excepción
    raise warning 'Error en bootstrap_user para %: %', new.id, sqlerrm;
    return new;
end;
$$;
