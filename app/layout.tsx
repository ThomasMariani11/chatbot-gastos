import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import { ServiceWorkerRegister } from '../components/sw-register';
import './globals.css';
import './forms.css';
import './interactions.css';
import './movements.css';

const manrope = Manrope({ variable: '--font-manrope', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Pesito — Finanzas personales',
  description: 'Registrá tus gastos por WhatsApp y entendé mejor tu dinero.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  icons: {
    icon: [{ url: '/icon-192.png', type: 'image/png', sizes: '192x192' }],
    apple: [{ url: '/apple-touch-icon.png', type: 'image/png', sizes: '180x180' }],
  },
  openGraph: {
    title: 'Pesito',
    description: 'Tus gastos, claros.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Pesito — Tus gastos, claros.' }],
  },
  twitter: { card: 'summary_large_image', title: 'Pesito', description: 'Tus gastos, claros.', images: ['/og.png'] },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={manrope.variable}><ServiceWorkerRegister />{children}</body>
    </html>
  );
}
