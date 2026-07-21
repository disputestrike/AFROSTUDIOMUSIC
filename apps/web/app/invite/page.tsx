'use client';

/**
 * ACCEPT A WORKSPACE INVITE — the destination of the invite link (?token=…).
 *
 * The page first asks the server who the invite is for (/auth/invite-info):
 * an existing account enters ITS password; a new person chooses one (the
 * signup floor, 12+). Acceptance posts to /auth/accept-invite, which claims
 * the single-use token, joins (or creates) the account, and sets the session
 * cookie for the invited workspace — so success lands straight in the studio.
 * Invited signup works even while public signup is closed.
 */

import { FormEvent, useEffect, useState } from 'react';
import { ArrowRight, CircleAlert, LockKeyhole, Music2, Users } from 'lucide-react';
import { useApi } from '@/lib/api';

const MIN_PASSWORD = 12;

interface InviteInfo {
  email: string;
  role: string;
  workspaceName: string;
  existingAccount: boolean;
  expiresAt: string;
}

export default function InvitePage() {
  const api = useApi();
  const [token, setToken] = useState('');
  const [info, setInfo] = useState<InviteInfo | null | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const t = (query.get('token') ?? '').trim();
    setToken(t);
    if (!t) {
      setInfo(null);
      return;
    }
    api
      .post<InviteInfo>('/auth/invite-info', { token: t })
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [api]);

  const needsNewPassword = info ? !info.existingAccount : false;
  const passwordOk = needsNewPassword ? password.length >= MIN_PASSWORD : password.length > 0;
  const canSubmit = !!token && !!info && passwordOk && !busy;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/accept-invite', {
        token,
        password,
        ...(needsNewPassword && name.trim() ? { name: name.trim() } : {}),
      });
      // The session cookie now targets the invited workspace — go make music.
      window.location.href = '/create';
    } catch (cause) {
      const raw = (cause as Error).message || '';
      setError(
        /invalid_or_expired_invite/.test(raw)
          ? 'This invite is invalid, already used, or has expired. Ask for a fresh one.'
          : /invalid_credentials|password_required|401/.test(raw)
            ? 'That password is incorrect for this account.'
            : /password_too_short/.test(raw)
              ? `Choose a password of at least ${MIN_PASSWORD} characters.`
              : "We couldn't accept this invite. Try again.",
      );
      setBusy(false);
    }
  }

  return (
    <main className="studio-auth-shell">
      <section className="studio-auth-panel" aria-labelledby="invite-title">
        <div className="studio-auth-brand"><Music2 aria-hidden="true" /> AfroStudioMusic</div>
        <div className="mt-9">
          <h1 id="invite-title" className="font-display text-3xl text-white">Join the studio</h1>
          {info ? (
            <p className="mt-2 text-sm text-slate-400">
              <Users className="mr-1 inline h-4 w-4 align-[-2px]" aria-hidden="true" />
              <strong className="text-slate-200">{info.workspaceName}</strong> invited{' '}
              <strong className="text-slate-200">{info.email}</strong> as {info.role}.
            </p>
          ) : info === undefined ? (
            <p className="mt-2 text-sm text-slate-400">Checking your invite…</p>
          ) : (
            <div role="alert" className="studio-error-callout mt-5">
              <CircleAlert aria-hidden="true" />
              <span>This invite link is invalid, already used, or expired. Ask the workspace admin for a fresh one.</span>
            </div>
          )}
        </div>

        {info && (
          <form className="mt-7 space-y-5" onSubmit={submit} noValidate>
            {needsNewPassword && (
              <div>
                <label htmlFor="invite-name" className="studio-field-label">Your name (optional)</label>
                <div className="studio-input-wrap">
                  <Users aria-hidden="true" />
                  <input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} type="text" name="name" autoComplete="name" placeholder="How should we address you?" />
                </div>
              </div>
            )}
            <div>
              <label htmlFor="invite-password" className="studio-field-label">
                {needsNewPassword ? 'Choose a password' : 'Your password'}
              </label>
              <div className="studio-input-wrap">
                <LockKeyhole aria-hidden="true" />
                <input
                  id="invite-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  name="password"
                  autoComplete={needsNewPassword ? 'new-password' : 'current-password'}
                  minLength={needsNewPassword ? MIN_PASSWORD : 1}
                  placeholder={needsNewPassword ? `At least ${MIN_PASSWORD} characters` : 'The password for this account'}
                  required
                />
              </div>
              {needsNewPassword && (
                <p className="mt-2 text-xs text-slate-500">
                  You&apos;re new here — this creates your account with the invited email.
                </p>
              )}
            </div>

            {error && (
              <div role="alert" className="studio-error-callout">
                <CircleAlert aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={!canSubmit} className="studio-primary-button w-full">
              {busy ? 'Joining…' : 'Accept invite'}
              {!busy && <ArrowRight aria-hidden="true" />}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
