'use client';

/**
 * Quiet, progressive account entry. An incoming brief survives authentication,
 * but it is only ever carried into Create as a visible prefill. Authentication
 * must never trigger generation or spend credits.
 */
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Headphones,
  KeyRound,
  LibraryBig,
  LockKeyhole,
  Mail,
  Music2,
  ShieldCheck,
} from 'lucide-react';
import { useApi } from '@/lib/api';

const MIN_PASSWORD = 12;

function friendlyError(raw: string, mode: 'signin' | 'signup'): string {
  if (/signup_closed/.test(raw)) return 'Sign-ups are invite-only right now. Existing members can still sign in.';
  if (/email_in_use/.test(raw)) return 'That email already has an account. Sign in instead.';
  if (/invalid_credentials/.test(raw)) return 'The email or password is incorrect.';
  if (/no_workspace/.test(raw)) return 'Your account is not attached to a studio. Ask the studio owner to add you.';
  if (/browser.request.verification|browser_request_verification/.test(raw)) {
    return 'We could not verify this browser request. Refresh the page and try again.';
  }
  if (/capacity is busy/.test(raw) || /503/.test(raw)) return 'The studio is busy. Wait a few seconds and try again.';
  if (/disabled/.test(raw)) return 'Accounts are not enabled on this studio yet.';
  if (/password/i.test(raw) || /at least 12/.test(raw)) return `Use at least ${MIN_PASSWORD} characters for your password.`;
  if (/email/i.test(raw)) return 'Enter a valid email address.';
  return mode === 'signup' ? 'We could not create your studio. Try again.' : 'We could not sign you in. Try again.';
}

export default function SignInPage() {
  const api = useApi();
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [stageName, setStageName] = useState('');
  const [intent, setIntent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [accountReady, setAccountReady] = useState(false);
  // Forgotten-password: once the request is sent we show the SAME confirmation
  // regardless of whether the email exists (anti-enumeration mirrors the API).
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get('mode') === 'signup') setMode('signup');
    const rawIntent = query.get('intent');
    if (rawIntent) setIntent(rawIntent.replace(/\s+/g, ' ').trim().slice(0, 200));
  }, []);

  const passwordShort = password.length > 0 && password.length < MIN_PASSWORD;
  const passwordOk = password.length >= MIN_PASSWORD;
  const createHref = intent ? `/create?vibe=${encodeURIComponent(intent)}&onboarding=brief` : '/create?onboarding=brief';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      if (mode === 'signup') {
        await api.post('/auth/signup', {
          email: email.trim(),
          password,
          stageName: stageName.trim() || undefined,
        });
        setAccountReady(true);
      } else if (mode === 'reset') {
        // The API always answers the same (anti-enumeration), so a thrown error
        // here is only a transport failure — show the confirmation regardless.
        await api.post('/auth/request-reset', { email: email.trim() }).catch(() => undefined);
        setResetSent(true);
      } else {
        await api.post('/auth/login', { email: email.trim(), password });
        router.push(createHref);
      }
    } catch (cause) {
      setError(friendlyError((cause as Error).message || '', mode === 'reset' ? 'signin' : mode));
    } finally {
      setBusy(false);
    }
  }

  if (resetSent) {
    return (
      <main className="studio-auth-shell">
        <section className="studio-auth-panel" aria-labelledby="reset-sent-title">
          <div className="studio-auth-brand"><img src="/logo.png" alt="" aria-hidden="true" className="studio-auth-logo" /> AfroStudioMusic</div>
          <div className="mt-8 flex h-12 w-12 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
            <Mail className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 id="reset-sent-title" className="mt-5 font-display text-3xl text-white">Check your email</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
            If an account exists for that email, we&apos;ve sent a link to reset your password. The link works once and
            expires in an hour. Be sure to check your spam folder.
          </p>
          <button
            type="button"
            onClick={() => { setResetSent(false); setMode('signin'); setPassword(''); setError(''); }}
            className="mt-7 flex items-center justify-center gap-2 text-sm text-slate-400 transition hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to sign in
          </button>
        </section>
      </main>
    );
  }

  if (accountReady) {
    return (
      <main className="studio-auth-shell">
        <section className="studio-auth-panel" aria-labelledby="next-step-title">
          <div className="studio-auth-brand"><img src="/logo.png" alt="" aria-hidden="true" className="studio-auth-logo" /> AfroStudioMusic</div>
          <div className="studio-step-row" aria-label="Signup progress">
            <span className="is-complete"><Check aria-hidden="true" /> Account</span>
            <span className="is-current">2 of 2: Start</span>
          </div>

          <div className="mt-8 flex h-12 w-12 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
            <Check className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 id="next-step-title" className="mt-5 font-display text-3xl text-white">Your studio is ready</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
            Choose how to begin. Both paths stay available, and contributing your music is never required to use the studio.
          </p>

          {intent && (
            <div className="studio-intent-note mt-5">
              <span className="text-xs font-semibold uppercase text-slate-500">Saved brief</span>
              <p className="mt-1 text-sm text-slate-200">{intent}</p>
              <p className="mt-1 text-xs text-slate-500">It will prefill Create. Nothing runs or spends credits until you confirm.</p>
            </div>
          )}

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => router.push('/listen?onboarding=sound')} className="studio-choice-card">
              <span className="studio-choice-icon"><Headphones aria-hidden="true" /></span>
              <span>
                <strong>Teach it my sound</strong>
                <small>Upload music you own or control and build a private sound profile.</small>
              </span>
              <ArrowRight aria-hidden="true" />
            </button>
            <button type="button" onClick={() => router.push(createHref)} className="studio-choice-card">
              <span className="studio-choice-icon"><LibraryBig aria-hidden="true" /></span>
              <span>
                <strong>Start with a brief</strong>
                <small>Describe the record, instrumental, film sound, or video you need.</small>
              </span>
              <ArrowRight aria-hidden="true" />
            </button>
          </div>

          <div className="mt-6 flex items-start gap-2 border-t border-white/10 pt-5 text-xs leading-5 text-slate-500">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sage" aria-hidden="true" />
            Your uploads stay governed by the rights and consent choices shown at upload time. Sound learning is opt-in.
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="studio-auth-shell">
      <section className="studio-auth-panel" aria-labelledby="auth-title">
        <div className="flex items-center justify-between gap-4">
          <div className="studio-auth-brand"><img src="/logo.png" alt="" aria-hidden="true" className="studio-auth-logo" /> AfroStudioMusic</div>
          {mode === 'signup' && <div className="studio-step-row"><span className="is-current">1 of 2: Account</span></div>}
        </div>

        <div className="mt-9">
          <h1 id="auth-title" className="font-display text-3xl text-white">
            {mode === 'signup' ? 'Create your studio' : mode === 'reset' ? 'Reset your password' : 'Sign in'}
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            {mode === 'signup'
              ? 'Set up your private workspace, then choose how to begin.'
              : mode === 'reset'
                ? "Enter your email and we'll send a link to set a new password."
                : 'Continue to your studio workspace.'}
          </p>
        </div>

        {intent && (
          <div className="studio-intent-note mt-5">
            <span className="text-xs font-semibold uppercase text-slate-500">Your brief is saved</span>
            <p className="mt-1 line-clamp-2 text-sm text-slate-200">{intent}</p>
            <p className="mt-1 text-xs text-slate-500">Signing in will only prefill the brief. It will not start a paid render.</p>
          </div>
        )}

        <form className="mt-7 space-y-5" onSubmit={submit} noValidate>
          {mode === 'signup' && (
            <div>
              <label htmlFor="stage-name" className="studio-field-label">Artist or stage name <span>Optional</span></label>
              <div className="studio-input-wrap">
                <Music2 aria-hidden="true" />
                <input id="stage-name" value={stageName} onChange={(event) => setStageName(event.target.value)} maxLength={80} autoComplete="nickname" name="stageName" placeholder="How should we address you?" />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="email" className="studio-field-label">Email</label>
            <div className="studio-input-wrap">
              <Mail aria-hidden="true" />
              <input id="email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" inputMode="email" autoComplete="email" name="email" placeholder="name@yourstudio.com" required />
            </div>
          </div>

          {mode !== 'reset' && (
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="studio-field-label">Password</label>
                {mode === 'signin' && (
                  <button
                    type="button"
                    onClick={() => { setMode('reset'); setError(''); setTouched(false); }}
                    className="text-xs text-slate-400 transition hover:text-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className={`studio-input-wrap ${mode === 'signup' && touched && passwordShort ? 'is-invalid' : ''}`}>
                <LockKeyhole aria-hidden="true" />
                <input id="password" value={password} onChange={(event) => { setPassword(event.target.value); setTouched(true); }} type="password" name="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? MIN_PASSWORD : 1} placeholder="Enter your password" required aria-describedby={mode === 'signup' ? 'password-help' : undefined} />
              </div>
              {mode === 'signup' && (
                <p id="password-help" className={`mt-2 flex items-center gap-1.5 text-xs ${passwordOk ? 'text-emerald-400' : touched && passwordShort ? 'text-red-400' : 'text-slate-500'}`}>
                  {passwordOk ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
                  {passwordOk ? 'Password meets the requirement.' : `Use at least ${MIN_PASSWORD} characters. A short sentence works well.`}
                </p>
              )}
            </div>
          )}

          {error && (
            <div role="alert" className="studio-error-callout">
              <CircleAlert aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" disabled={busy || !email.trim() || (mode !== 'reset' && password.length < (mode === 'signup' ? MIN_PASSWORD : 1))} className="studio-primary-button w-full">
            {busy ? 'Please wait' : mode === 'signup' ? 'Continue' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
            {!busy && <ArrowRight aria-hidden="true" />}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            if (mode === 'reset') { setMode('signin'); setError(''); setTouched(false); return; }
            setMode(mode === 'signup' ? 'signin' : 'signup');
            setError('');
            setTouched(false);
          }}
          className="mt-5 flex w-full items-center justify-center gap-2 text-sm text-slate-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        >
          {(mode === 'signup' || mode === 'reset') && <ArrowLeft className="h-4 w-4" aria-hidden="true" />}
          {mode === 'signup' ? 'I already have an account' : mode === 'reset' ? 'Back to sign in' : 'Create a new studio'}
        </button>
      </section>
    </main>
  );
}
