import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pesito — Finanzas personales',
    short_name: 'Pesito',
    description: 'Registrá gastos e ingresos desde WhatsApp.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f8f6',
    theme_color: '#20b984',
    lang: 'es-AR',
  };
}
