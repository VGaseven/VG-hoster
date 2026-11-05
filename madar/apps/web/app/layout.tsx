import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'مدار | مواعيد الحضور المرن',
  description: 'احجز موعد حضورك المرن، واعرف متى تنطلق.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  appleWebApp: { capable: true, title: 'مدار', statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#104631', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        <Script id="sw" strategy="afterInteractive">
          {`if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});`}
        </Script>
      </body>
    </html>
  );
}
