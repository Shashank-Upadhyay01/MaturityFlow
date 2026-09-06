import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Toaster } from 'sonner';
import { AmbientField, ThemeScript } from '@/components/layout/ambient';
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '@/lib/brand';
import './globals.css';

/*
  Inter, served from our own domain instead of rsms.me.

  It used to arrive as a stylesheet link to a third party, which put a render-blocking request to
  someone else's server in front of every single page. Measured from the branch it answered in
  1.1 to 2.0 seconds - for eleven kilobytes - so every screen in the office waited that long
  before it could draw any text, warm cache or cold, and an outage there would have been an
  outage here.

  The same font files, byte for byte, now sit beside the app and come off the same edge cache as
  everything else. next/font inlines the @font-face rules into the document, preloads the woff2
  and gives it a stable class name, so there is no second round trip and no flash of a fallback
  face. `swap` keeps text visible while it loads rather than holding the page blank.
*/
const inter = localFont({
  src: [
    { path: './fonts/InterVariable.woff2', weight: '100 900', style: 'normal' },
    { path: './fonts/InterVariable-Italic.woff2', weight: '100 900', style: 'italic' },
  ],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
});

export const metadata: Metadata = {
  title: {
    default: PRODUCT_NAME,
    template: `%s · ${PRODUCT_NAME}`,
  },
  description: PRODUCT_DESCRIPTION,
  applicationName: PRODUCT_NAME,
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
    <html lang="en-IN" className={inter.variable} suppressHydrationWarning>
      <head>
        <ThemeScript />
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
