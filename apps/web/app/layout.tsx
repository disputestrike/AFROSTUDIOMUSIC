import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  title: 'AfroHit Studio',
  description: 'A responsible AI production studio for African and diaspora artists.',
};

// Clerk publishable keys are inlined at BUILD time (NEXT_PUBLIC_*). If the real
// key isn't set, the build would crash while prerendering /_not-found through
// ClerkProvider. This valid-format placeholder (decodes to clerk.example.com)
// lets the build succeed even with zero env vars set. The real key, when
// present in the Railway build environment, overrides it. Auth only works with
// a real key — set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY for that.
const CLERK_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <html lang="en">
        <body className="min-h-screen bg-ink text-slate-100 antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
