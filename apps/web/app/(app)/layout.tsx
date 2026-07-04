import Link from 'next/link';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <Link href="/studio" className="font-display text-xl tracking-tight">
          AFROHIT STUDIO
        </Link>
        <nav className="flex items-center gap-6 text-sm text-slate-300">
          <Link href="/studio">Chat</Link>
          <Link href="/projects">Projects</Link>
          <Link href="/catalog">Catalog</Link>
          <Link href="/billing">Billing</Link>
          <Link href="/settings">Settings</Link>
          <Link href="/admin" className="text-slate-500 hover:text-slate-300">Admin</Link>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-400">Internal</span>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
