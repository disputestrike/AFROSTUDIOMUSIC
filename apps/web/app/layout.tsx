import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  title: 'AfroHit Studio',
  description: 'A responsible AI production studio for African and diaspora artists.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen bg-ink text-slate-100 antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
