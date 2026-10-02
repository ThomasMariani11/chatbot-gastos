-- Migración 009: Configuración global del sistema (número de bot WhatsApp)

create table if not exists public.system_config (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

-- Habilitar RLS
alter table public.system_config enable row level security;

-- Cualquier usuario puede leer la configuración del sistema (como el número del bot)
drop policy if exists "anyone can read public system config" on public.system_config;
create policy "anyone can read public system config"
  on public.system_config
  for select
  using (true);

-- Solo administradores pueden insertar o actualizar configuración
drop policy if exists "admins manage system config" on public.system_config;
create policy "admins manage system config"
  on public.system_config
  for all
  using (public.is_admin());

-- Fila inicial para el número de WhatsApp del bot
insert into public.system_config (key, value)
values ('whatsapp_bot_phone', '')
on conflict (key) do nothing;
