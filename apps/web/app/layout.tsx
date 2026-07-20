import type { Metadata } from 'next';
import { Anton, Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';

const anton = Anton({ weight: '400', subsets: ['latin'], variable: '--font-display', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-grotesk', display: 'swap' });

export const viewport = { themeColor: '#0B0F19' };

export const metadata: Metadata = {
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: '/icon-192.png',
  },
  title: 'AfroHit Studio - the AI production house',
  description:
    'Bring your beat, finish the whole record. Hooks, lyrics, vocals, industry mastering, cover art and release - one AI production house built for African and diaspora artists.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const buildId = (process.env.RAILWAY_GIT_COMMIT_SHA ?? 'dev').slice(0, 7);
  return (
    <html lang="en" className={`${anton.variable} ${inter.variable} ${grotesk.variable}`}>
      <body data-build-id={buildId} className="min-h-screen bg-night-950 font-sans text-slate-100 antialiased">
        <div className="aurora" aria-hidden />
        <div className="grain" aria-hidden />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
