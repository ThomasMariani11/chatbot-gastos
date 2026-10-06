-- Migración 011: Configuración de corte maestro del bot (bot_active)
insert into public.system_config (key, value)
values ('bot_active', 'true')
on conflict (key) do nothing;
