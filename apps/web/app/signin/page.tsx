'use client';

/**
 * SIGN IN / SIGN UP — the multi-tenant front door (T1).
 *
 * Email + password against /auth/login and /auth/signup. The API stores the
 * short-lived session in an HttpOnly cookie that browser JavaScript cannot read. Signup
 * provisions the whole tenant (workspace + artist), so a new user lands in
 * Create ready to make a song.
 *
 * UX laws (owner feedback, 2026-07-15): the password RULES are always visible —
 * never only in a placeholder that vanishes when you type — and every API
 * failure maps to a message that says what actually went wrong and what to do.
 * A real <form> submit is used so browser password managers offer to save.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';

const MIN_PASSWORD = 12;

function friendlyError(raw: string, mode: 'signin' | 'signup'): string {
  if (/signup_closed/.test(raw)) return 'Sign-ups are invite-only right now. If you have a studio, use Sign in.';
  if (/email_in_use/.test(raw)) return 'That email already has an account — sign in instead.';
  if (/invalid_credentials/.test(raw)) return 'Wrong email or password.';
  if (/no_workspace/.test(raw)) return 'Your account has no studio attached yet — contact the studio owner.';
  if (/browser.request.verification|browser_request_verification/.test(raw))
    return 'Your browser request could not be verified — refresh the page and try again.';
  if (/capacity is busy/.test(raw) || /503/.test(raw)) return 'The studio is busy for a moment — try again in a few seconds.';
  if (/disabled/.test(raw)) return 'Accounts are not enabled on this studio yet.';
  if (/password/i.test(raw) || /at least 12/.test(raw))
    return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (/email/i.test(raw)) return 'That does not look like a valid email address.';
  return mode === 'signup' ? 'Could not create your studio — try again.' : 'Could not sign you in — try again.';
}

export default function SignInPage() {
  const api = useApi();
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [stageName, setStageName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  // FUNNEL (Wave 8b): the landing chat hero deep-links with &intent=<prompt>.
  // The prompt survives BOTH signup and login submits and is handed to the
  // EXISTING /create?vibe= prefill — it arrives VISIBLE in the vibe field and
  // the user presses Create themselves. Never ?produce=1 (that auto-fires a
  // paid render — the "re-creates for days" incident class).
  const [intent, setIntent] = useState('');

  // Landing CTAs deep-link to /signin?mode=signup. Read the params on mount
  // (not useSearchParams — that would force a Suspense boundary for one flag)
  // so the server-rendered markup stays identical and hydration never differs.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('mode') === 'signup') setMode('signup');
    const raw = q.get('intent');
    if (raw) setIntent(raw.replace(/\s+/g, ' ').trim().slice(0, 200));
  }, []);

  const passwordShort = password.length > 0 && password.length < MIN_PASSWORD;
  const passwordOk = password.length >= MIN_PASSWORD;

  async function submit() {
    setErr('');
    setBusy(true);
    try {
      if (mode === 'signup') {
        await api.post('/auth/signup', { email: email.trim(), password, stageName: stageName.trim() || undefined });
      } else {
        await api.post('/auth/login', { email: email.trim(), password });
      }
      // Carry the landing prompt into the studio via the existing ?vibe=
      // prefill — visible in the form, never auto-firing a render.
      router.push(intent ? `/create?vibe=${encodeURIComponent(intent)}` : '/create');
    } catch (e) {
      setErr(friendlyError((e as Error).message || '', mode));
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
        {intent && (
          <div className="mt-3 rounded-xl border border-afrobrand-500/30 bg-afrobrand-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-slate-300">
            <span className="font-medium text-afrobrand-300">Coming with you into the studio:</span> “{intent}”
          </div>
        )}

        <form
          className="mt-6 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void submit();
          }}
        >
          {mode === 'signup' && (
            <input value={stageName} onChange={(e) => setStageName(e.target.value)} placeholder="Artist / stage name" maxLength={80}
              autoComplete="nickname" name="stageName"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-600" />
          )}
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" autoComplete="email" name="email"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-600" />
          <div>
            <input value={password} onChange={(e) => { setPassword(e.target.value); setTouched(true); }}
              placeholder="Password" type="password" name="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={mode === 'signup' ? MIN_PASSWORD : 1}
              className={`w-full rounded-xl border bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-600 ${
                mode === 'signup' && touched && passwordShort ? 'border-red-500/70' : 'border-slate-700'
              }`} />
            {mode === 'signup' && (
              <p className={`mt-1.5 text-xs ${passwordOk ? 'text-emerald-400' : touched && passwordShort ? 'text-red-400' : 'text-slate-500'}`}>
                {passwordOk
                  ? `✓ Password looks good (${password.length} characters)`
                  : `Password must be at least ${MIN_PASSWORD} characters${passwordShort ? ` — ${MIN_PASSWORD - password.length} more to go` : ''}. A short sentence works great.`}
              </p>
            )}
          </div>

          {err && <p className="mt-1 text-sm text-red-400">{err}</p>}

          <button type="submit" disabled={busy || !email.trim() || password.length < (mode === 'signup' ? MIN_PASSWORD : 1)}
            className="mt-2 w-full rounded-full bg-brand-gradient px-5 py-3 font-medium text-ink shadow-glow disabled:opacity-40">
            {busy ? 'One moment…' : mode === 'signup' ? '🎤 Create my studio' : 'Sign in'}
          </button>
        </form>

        <button onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setErr(''); setTouched(false); }}
          className="mt-4 w-full text-center text-sm text-slate-400 hover:text-slate-200">
          {mode === 'signup' ? 'Already have a studio? Sign in' : 'New here? Create your studio'}
        </button>
      </div>
    </div>
  );
}
