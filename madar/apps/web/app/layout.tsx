import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'مدار',
  description: 'اختر موعد حضورك المرن، واعرف متى تنطلق.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  appleWebApp: { capable: true, title: 'مدار', statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#0f5c4d', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        {children}
        <Script id="sw" strategy="afterInteractive">
          {`if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});`}
        </Script>
      </body>
    </html>
  );
}
