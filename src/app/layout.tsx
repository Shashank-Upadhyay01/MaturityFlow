import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { AmbientField, ThemeScript } from '@/components/layout/ambient';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'MaturityFlow — Maturity Payout Control',
    template: '%s · MaturityFlow',
  },
  description:
    'Turns a maturity approval into an exact, day-by-day payout schedule — and measures every rupee against it.',
  applicationName: 'MaturityFlow',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef1f8' },
    { media: '(prefers-color-scheme: dark)', color: '#060911' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <link rel="preconnect" href="https://rsms.me/" />
        <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
      </head>
      <body className="antialiased">
        <AmbientField />
        {children}
        <Toaster
          position="top-center"
          toastOptions={{
            className: 'glass !border !rounded-[15px]',
            style: { backdropFilter: 'blur(20px) saturate(180%)' },
          }}
        />
      </body>
    </html>
  );
}
