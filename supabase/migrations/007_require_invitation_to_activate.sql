-- Migración 007: Asegurar que nuevos usuarios requieran canjear código para activar suscripción

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
end $$;
