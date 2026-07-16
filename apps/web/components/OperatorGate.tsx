'use client';

/**
 * TENANT SURFACE ISOLATION (Wave 8a) — the web's operator-vs-tenant seam.
 *
 * `useOperatorView` is the ONE place the client learns who it is talking to:
 * it reads GET /auth/me (which carries the server-computed `operator` boolean
 * from the ADMIN_EMAILS allowlist — the list itself never leaves the server)
 * and the operator's local "View as user" preview toggle.
 *
 * <OperatorGate> wraps operator pages so a consumer deep-link gets a polite
 * explanation instead of a crash. PRESENTATION ONLY — every operator route
 * group is independently requireAdmin-gated server-side; a consumer calling
 * the API directly gets 403 regardless of anything in this file.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useApi } from '@/lib/api';

export interface SessionMe {
  userId: string;
  email: string | null;
  name: string | null;
  operator?: boolean;
  workspace?: { name: string; plan: string; creditsCents: number } | null;
}

const VIEW_AS_USER_KEY = 'afrohit.viewAsUser';
const VIEW_MODE_EVENT = 'afrohit:view-mode';

// One /auth/me round-trip per hard page load, shared by the NavBar and every
// gate on the page (same session-fetch pattern the NavBar already used).
let mePromise: Promise<SessionMe | null> | null = null;

function readViewAsUser(): boolean {
  try {
    return window.localStorage.getItem(VIEW_AS_USER_KEY) === '1';
  } catch {
    return false;
  }
}

export function useOperatorView() {
  const api = useApi();
  // undefined = still resolving (matches the server-rendered markup);
  // null = signed out; object = the session user.
  const [me, setMe] = useState<SessionMe | null | undefined>(undefined);
  const [viewAsUser, setViewAsUserState] = useState(false);

  useEffect(() => {
    let active = true;
    if (!mePromise) {
      mePromise = api.get<SessionMe>('/auth/me').catch(() => {
        mePromise = null; // a failed read is retryable on the next mount
        return null;
      });
    }
    void mePromise.then((resolved) => {
      if (active) setMe(resolved);
    });
    setViewAsUserState(readViewAsUser());
    const onChange = () => setViewAsUserState(readViewAsUser());
    window.addEventListener(VIEW_MODE_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      active = false;
      window.removeEventListener(VIEW_MODE_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, [api]);

  const setViewAsUser = useCallback((next: boolean) => {
    try {
      if (next) window.localStorage.setItem(VIEW_AS_USER_KEY, '1');
      else window.localStorage.removeItem(VIEW_AS_USER_KEY);
    } catch {
      /* storage unavailable — the in-memory event still flips this tab */
    }
    window.dispatchEvent(new Event(VIEW_MODE_EVENT));
  }, []);

  const operator = me?.operator === true;
  return {
    /** true until /auth/me resolves (or fails). */
    loading: me === undefined,
    /** null while loading, then true/false. */
    signedIn: me === undefined ? null : me !== null,
    me: me ?? null,
    /** Server-verdict: is this session on the operator allowlist? */
    operator,
    /** Operator previewing the consumer experience right now. */
    viewingAsUser: operator && viewAsUser,
    /** What the UI should render as: operator surfaces shown only when true. */
    effectiveOperator: operator && !viewAsUser,
    setViewAsUser,
  };
}

export function OperatorGate({ children }: { children: React.ReactNode }) {
  const view = useOperatorView();

  if (view.loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking access…
      </div>
    );
  }

  if (view.effectiveOperator) return <>{children}</>;

  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
        <ShieldAlert className="h-6 w-6 text-afrobrand-400" />
      </div>
      <h1 className="mt-5 font-display text-2xl">This area is for studio operators</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">
        The tools behind this door run the production house itself. Everything you need to make and
        keep your music lives in Create, Chat and your Catalog.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/create"
          className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow"
        >
          Back to Create
        </Link>
        {view.viewingAsUser && (
          <button
            type="button"
            onClick={() => view.setViewAsUser(false)}
            className="rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-4 py-2 text-sm text-afrobrand-300 hover:bg-afrobrand-500/20"
          >
            You&apos;re viewing as a user — switch back
          </button>
        )}
      </div>
    </div>
  );
}
