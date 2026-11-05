-- FE-25 / BE-21 (etapa PWA): preferencia de recordatorios del cliente.
-- Expansiva y compatible: el runtime anterior no lee la columna y la PWA nueva
-- la trata como ausente (sin recordatorio ni interruptor) si esta migración no se aplicó.
-- Por decisión del propietario los recordatorios vienen activados por defecto.
-- Todavía no hay envío por WhatsApp: la columna queda lista para respetarla cuando exista.

alter table public.app_settings
  add column if not exists client_reminders_enabled boolean not null default true;

comment on column public.app_settings.client_reminders_enabled is
  'Opt-out del cliente para recordatorios de registro (FE-25). Hoy solo se muestran en la PWA; un futuro despacho por WhatsApp debe respetarla.';

-- La política existente "own settings" ya limita lectura/escritura a la fila propia.
notify pgrst, 'reload schema';
