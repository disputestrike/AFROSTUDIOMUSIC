import { AppShellRouter } from '@/components/consumer/AppShellRouter';

/**
 * (app) LAYOUT — role-gated shell (USERSHELL, owner order 2026-07-19).
 * The operator keeps today's top-bar frame; every other account gets the
 * Suno-shaped consumer shell (sidebar + persistent player). The decision
 * lives in AppShellRouter, driven by GET /auth/me. Children stay server
 * components — they pass through the client shell as a slot.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShellRouter>{children}</AppShellRouter>;
}
