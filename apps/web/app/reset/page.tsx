'use client';

/**
 * SET A NEW PASSWORD — the destination of the emailed reset link. It reads the
 * single-use token from the URL (?token=…), collects a new password, and posts
 * both to /auth/reset-password. The server validates the token (unused +
 * unexpired), sets the new scrypt hash, and consumes the token. On success the
 * user is sent to sign in with the new password.
 */

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, CircleAlert, KeyRound, LockKeyhole } from 'lucide-react';
import { useApi } from '@/lib/api';

const MIN_PASSWORD = 12;

export default function ResetPasswordPage() {
  const api = useApi();
  const router = useRouter();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setToken((query.get('token') ?? '').trim());
  }, []);

  const passwordOk = password.length >= MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = !!token && passwordOk && confirm === password && !busy;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      setDone(true);
      setTimeout(() => router.push('/signin'), 2200);
    } catch (cause) {
      const raw = (cause as Error).message || '';
      setError(
        /invalid_or_expired_token|400/.test(raw)
          ? 'This reset link is invalid or has expired. Request a new one from the sign-in page.'
          : /at least 12|password/i.test(raw)
            ? `Use at least ${MIN_PASSWORD} characters.`
            : "We couldn't reset your password. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="studio-auth-shell">
        <section className="studio-auth-panel" aria-labelledby="reset-done-title">
          <div className="studio-auth-brand"><img src="/logo.png" alt="" aria-hidden="true" className="studio-auth-logo" /> AfroStudioMusic</div>
          <div className="mt-8 flex h-12 w-12 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
            <Check className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 id="reset-done-title" className="mt-5 font-display text-3xl text-white">Password updated</h1>
          <p className="mt-2 text-sm text-slate-400">Taking you to sign in with your new password…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="studio-auth-shell">
      <section className="studio-auth-panel" aria-labelledby="reset-title">
        <div className="studio-auth-brand"><img src="/logo.png" alt="" aria-hidden="true" className="studio-auth-logo" /> AfroStudioMusic</div>
        <div className="mt-9">
          <h1 id="reset-title" className="font-display text-3xl text-white">Set a new password</h1>
          <p className="mt-2 text-sm text-slate-400">Choose a new password for your account.</p>
        </div>

        {!token && (
          <div role="alert" className="studio-error-callout mt-5">
            <CircleAlert aria-hidden="true" />
            <span>This page needs a valid reset link. Open the link from your email, or request a new one from sign in.</span>
          </div>
        )}

        <form className="mt-7 space-y-5" onSubmit={submit} noValidate>
          <div>
            <label htmlFor="new-password" className="studio-field-label">New password</label>
            <div className="studio-input-wrap">
              <LockKeyhole aria-hidden="true" />
              <input id="new-password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" name="new-password" autoComplete="new-password" minLength={MIN_PASSWORD} placeholder="At least 12 characters" required />
            </div>
            <p className={`mt-2 flex items-center gap-1.5 text-xs ${passwordOk ? 'text-emerald-400' : 'text-slate-500'}`}>
              {passwordOk ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
              {passwordOk ? 'Password meets the requirement.' : `Use at least ${MIN_PASSWORD} characters. A short sentence works well.`}
            </p>
          </div>

          <div>
            <label htmlFor="confirm-password" className="studio-field-label">Confirm new password</label>
            <div className={`studio-input-wrap ${mismatch ? 'is-invalid' : ''}`}>
              <LockKeyhole aria-hidden="true" />
              <input id="confirm-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" name="confirm-password" autoComplete="new-password" placeholder="Re-enter your new password" required />
            </div>
            {mismatch && <p className="mt-2 text-xs text-red-400">The two passwords don&apos;t match.</p>}
          </div>

          {error && (
            <div role="alert" className="studio-error-callout">
              <CircleAlert aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" disabled={!canSubmit} className="studio-primary-button w-full">
            {busy ? 'Please wait' : 'Set new password'}
            {!busy && <ArrowRight aria-hidden="true" />}
          </button>
        </form>
      </section>
    </main>
  );
}
