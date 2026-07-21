'use client';

/**
 * Registers the minimal app-shell service worker (public/sw.js) so the PWA can
 * open with no internet. Registration is best-effort and non-blocking: any
 * failure (unsupported browser, insecure context) is swallowed — the app works
 * identically online whether or not the SW registers. The SW itself never
 * caches the API or auth, so this can never serve stale private data.
 */

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    // Register after load so it never competes with first paint / hydration.
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);
  return null;
}
