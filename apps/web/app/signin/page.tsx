'use client';

/**
 * SIGN IN / SIGN UP — the multi-tenant front door (T1).
 *
 * Email + password against /auth/login and /auth/signup; the returned JWT is
 * stored as afrohit.token and rides every API call as a Bearer header. Signup
 * provisions the whole tenant (workspace + artist), so a new user lands in
 * Create ready to make a song. In internal (single-owner) mode this page still
 * works for preparing accounts before AUTH_MODE=jwt goes live.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';

export default function SignInPage() {
  const api = useApi();
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [stageName, setStageName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr('');
    setBusy(true);
    try {
      const r =
        mode === 'signup'
          ? await api.post<{ token: string }>('/auth/signup', { email: email.trim(), password, stageName: stageName.trim() || undefined })
          : await api.post<{ token: string }>('/auth/login', { email: email.trim(), password });
      localStorage.setItem('afrohit.token', r.token);
      router.push('/create');
    } catch (e) {
      const m = (e as Error).message || '';
      setErr(
        /email_in_use/.test(m) ? 'That email already has an account — sign in instead.'
        : /invalid_credentials/.test(m) ? 'Wrong email or password.'
        : /disabled/.test(m) ? 'Accounts are not enabled on this studio yet.'
        : 'Could not sign you in — try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-3xl border-gradient glass p-8 shadow-card">
        <h1 className="font-display text-3xl text-gradient">{mode === 'signup' ? 'Create your studio' : 'Welcome back'}</h1>
        <p className="mt-2 text-sm text-slate-400">
          {mode === 'signup' ? 'Your own AI studio — write, sing and master real records.' : 'Sign in to your studio.'}
        </p>

        <div className="mt-6 space-y-3">
          {mode === 'signup' && (
            <input value={stageName} onChange={(e) => setStageName(e.target.value)} placeholder="Artist / stage name" maxLength={80}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-600" />
          )}
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" autoComplete="email"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-600" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'Password (8+ characters)' : 'Password'} type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void submit(); }}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-600" />
        </div>

        {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

        <button disabled={busy || !email.trim() || password.length < (mode === 'signup' ? 8 : 1)} onClick={() => void submit()}
          className="mt-5 w-full rounded-full bg-brand-gradient px-5 py-3 font-medium text-ink shadow-glow disabled:opacity-40">
          {busy ? 'One moment…' : mode === 'signup' ? '🎤 Create my studio' : 'Sign in'}
        </button>

        <button onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setErr(''); }}
          className="mt-4 w-full text-center text-sm text-slate-400 hover:text-slate-200">
          {mode === 'signup' ? 'Already have a studio? Sign in' : 'New here? Create your studio'}
        </button>
      </div>
    </div>
  );
}
