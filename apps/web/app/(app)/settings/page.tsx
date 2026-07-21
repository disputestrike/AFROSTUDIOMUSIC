'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';

interface Artist {
  id: string;
  stageName: string;
  bio: string | null;
  vocalRangeLow: string | null;
  vocalRangeHigh: string | null;
  vocalTone: string[];
  languages: string[];
  laneSummary: string | null;
  cornyBanned: string[];
  morningDrop: boolean;
}

/**
 * Settings = the Artist DNA editor.
 * Without this filled in, hooks/lyrics will be generic.
 */
export default function SettingsPage() {
  const api = useApi();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get<Artist[]>('/artists').then((list) => setArtist(list[0] ?? null)).catch(() => setArtist(null));
  }, []);

  if (!artist) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <MusicEngine />
        <h1 className="mt-10 font-display text-4xl">Artist DNA</h1>
        <p className="mt-3 text-sm text-slate-300">No artist profile yet. Create one in your workspace to start.</p>
      </div>
    );
  }

  async function save() {
    if (!artist) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      // Auto-provisioned artists carry NULL bio/range/lane fields, and the
      // schema's .optional() accepts undefined ONLY — sending null was a silent
      // 400 on every save. Send only fields that hold a real value.
      const body: Record<string, unknown> = {
        vocalTone: artist.vocalTone,
        languages: artist.languages,
        cornyBanned: artist.cornyBanned,
        morningDrop: artist.morningDrop,
      };
      if (artist.stageName.trim()) body.stageName = artist.stageName.trim();
      for (const k of ['bio', 'vocalRangeLow', 'vocalRangeHigh', 'laneSummary'] as const) {
        const v = artist[k];
        if (typeof v === 'string' && v.trim()) body[k] = v;
      }
      await api.patch(`/artists/${artist.id}`, body);
      setSaveMsg({ ok: true, text: 'Saved ✓' });
    } catch (e) {
      setSaveMsg({ ok: false, text: `Couldn't save: ${(e as Error).message.slice(0, 200)}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <MusicEngine />

      <h1 className="mt-10 font-display text-4xl">Artist DNA</h1>
      <p className="mt-2 text-sm text-slate-400">
        This shapes every hook, lyric, and beat. The more specific you are about your lane and banned clichés, the less generic the output.
      </p>

      <div className="mt-6 grid gap-4">
        <Field label="Stage name">
          <input className="input" value={artist.stageName} onChange={(e) => setArtist({ ...artist, stageName: e.target.value })} />
        </Field>
        <Field label="Bio">
          <textarea className="input" rows={3} value={artist.bio ?? ''} onChange={(e) => setArtist({ ...artist, bio: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vocal range low (e.g. A2)">
            <input className="input" value={artist.vocalRangeLow ?? ''} onChange={(e) => setArtist({ ...artist, vocalRangeLow: e.target.value })} />
          </Field>
          <Field label="Vocal range high (e.g. F5)">
            <input className="input" value={artist.vocalRangeHigh ?? ''} onChange={(e) => setArtist({ ...artist, vocalRangeHigh: e.target.value })} />
          </Field>
        </div>
        <Field label="Vocal tone (comma separated)">
          <input
            className="input"
            value={artist.vocalTone.join(', ')}
            onChange={(e) => setArtist({ ...artist, vocalTone: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          />
        </Field>
        <Field label="Languages (yo, ig, ha, pcm, en)">
          <input
            className="input"
            value={artist.languages.join(', ')}
            onChange={(e) => setArtist({ ...artist, languages: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          />
        </Field>
        <Field label="Lane summary (free text — your fingerprint)">
          <textarea className="input" rows={3} value={artist.laneSummary ?? ''} onChange={(e) => setArtist({ ...artist, laneSummary: e.target.value })} />
        </Field>
        <Field label="Banned/corny phrases (comma separated)">
          <input
            className="input"
            value={artist.cornyBanned.join(', ')}
            onChange={(e) => setArtist({ ...artist, cornyBanned: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          />
        </Field>

        <label className="mt-2 flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <input
            type="checkbox"
            checked={artist.morningDrop}
            onChange={(e) => setArtist({ ...artist, morningDrop: e.target.checked })}
            className="mt-1 h-4 w-4 accent-afrobrand-500"
          />
          <span>
            <span className="block font-medium text-slate-200">☀️ Morning Drop</span>
            <span className="block text-xs text-slate-400">
              Every night the studio writes and scores 20 fresh hooks against your DNA and taste
              history, then emails you the top 10. Costs one hooks batch (~$0.15/night) from your credits.
            </span>
          </span>
        </label>
      </div>

      <button
        onClick={() => void save()}
        disabled={saving}
        className="mt-6 rounded-full bg-afrobrand-500 px-4 py-2 text-sm font-medium text-ink hover:bg-afrobrand-400 disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save DNA'}
      </button>
      {saveMsg && (
        <span className={`ml-3 text-xs ${saveMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{saveMsg.text}</span>
      )}

      <div className="mt-10">
        <ChangePassword />
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          background: #0f172a;
          border: 1px solid #1f2937;
          color: #e2e8f0;
          padding: 8px 12px;
          border-radius: 10px;
          font-size: 14px;
        }
        :global(.input:focus) {
          outline: none;
          border-color: #f97316;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-400">{label}</span>
      {children}
    </label>
  );
}

const MIN_PASSWORD = 12;

/**
 * CHANGE PASSWORD (signed in). Verifies the current password server-side and
 * sets a new one. The password never leaves this form except over the
 * authenticated POST; the server hashes it (scrypt) and never stores cleartext.
 */
function ChangePassword() {
  const api = useApi();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit = current.length > 0 && next.length >= MIN_PASSWORD && confirm === next && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      setMsg({ ok: true, text: 'Password changed ✓' });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      const raw = (err as Error).message || '';
      setMsg({
        ok: false,
        text: /invalid_current_password|401/.test(raw)
          ? 'Your current password is incorrect.'
          : /password_unchanged/.test(raw)
            ? 'Choose a password different from your current one.'
            : /at least 12|password/i.test(raw)
              ? `Use at least ${MIN_PASSWORD} characters.`
              : "Couldn't change your password. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border-gradient glass p-5">
      <h2 className="font-display text-2xl">🔒 Password</h2>
      <p className="mt-2 text-sm text-slate-400">
        Change the password you use to sign in. You&apos;ll need your current one.
      </p>
      <form onSubmit={submit} className="mt-4 grid max-w-md gap-3">
        <Field label="Current password">
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label={`New password (at least ${MIN_PASSWORD} characters)`}>
          <input className="input" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {tooShort && <p className="text-xs text-red-400">Use at least {MIN_PASSWORD} characters.</p>}
        {mismatch && <p className="text-xs text-red-400">The two new passwords don&apos;t match.</p>}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
          >
            {busy ? 'Changing…' : 'Change password'}
          </button>
          {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</span>}
        </div>
      </form>
    </div>
  );
}

interface Integration {
  musicProvider: string | null;
  musicConnected: boolean;
  keyHint: string | null;
  sunoRouteAllowed: boolean;
  elevenRouteAllowed: boolean;
}

function musicEngineLabel(provider: string | null): string {
  if (provider === 'suno') return 'Flagship';
  if (provider === 'eleven') return 'Advanced';
  if (provider === 'replicate') return 'Standard';
  return 'Unknown';
}

/**
 * Connect your AI music engine right here — no Railway, no env vars.
 * Paste your engine key, Save, and it tests the connection live.
 * §1.11 THE WALL: public copy speaks in engine CLASSES, never vendor names.
 */
function MusicEngine() {
  const api = useApi();
  const [provider, setProvider] = useState('replicate');
  const [apiKey, setApiKey] = useState('');
  const [state, setState] = useState<Integration>({ musicProvider: null, musicConnected: false, keyHint: null, sunoRouteAllowed: false, elevenRouteAllowed: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .get<Integration>('/settings/integrations')
      .then((r) => {
        setState(r);
        if (r.musicProvider) setProvider(r.musicProvider);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.patch<Integration>('/settings/integrations', {
        musicProvider: provider,
        ...(apiKey.trim() ? { musicApiKey: apiKey.trim() } : {}),
      });
      setState(r);
      setApiKey('');
      // live test
      const t = await api
        .post<{ ok: boolean; message?: string; error?: string }>('/settings/integrations/test', {})
        .catch((e): { ok: boolean; message?: string; error?: string } => ({ ok: false, error: (e as Error).message }));
      setMsg(t.ok ? { ok: true, text: t.message ?? 'Connected ✅' } : { ok: false, text: t.error ?? 'Test failed' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const r = await api.patch<Integration>('/settings/integrations', { musicApiKey: null });
      setState(r);
      setMsg({ ok: true, text: 'Disconnected.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border-gradient glass p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl">🎵 Music engine</h2>
        <span className={`rounded-full px-3 py-1 text-xs ${state.musicConnected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-slate-400'}`}>
          {state.musicConnected ? `Connected · ${musicEngineLabel(state.musicProvider)} ${state.keyHint ?? ''}` : 'Not connected — renders fail until a key is set (no placeholders)'}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-400">
        Paste your key once here — that&apos;s it. No Railway, no settings files. It turns your beats into real AI-generated audio.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[160px_1fr]">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        >
          <option value="replicate">Standard engine</option>
          {(state.elevenRouteAllowed || provider === 'eleven') && (
            <option value="eleven" disabled={!state.elevenRouteAllowed}>Advanced engine{state.elevenRouteAllowed ? '' : ' (commercial approval required)'}</option>
          )}
          {(state.sunoRouteAllowed || provider === 'suno') && (
            <option value="suno" disabled={!state.sunoRouteAllowed}>Flagship engine{state.sunoRouteAllowed ? '' : ' (first-party only)'}</option>
          )}
        </select>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={state.musicConnected ? 'Key saved — paste a new one to replace' : 'Paste your API key (e.g. r8_…)'}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
        >
          {busy ? 'Saving & testing…' : 'Save & test'}
        </button>
        {state.musicConnected && (
          <button onClick={() => void disconnect()} disabled={busy} className="text-xs text-slate-500 hover:text-slate-300">
            Disconnect
          </button>
        )}
        {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</span>}
      </div>

      <p className="mt-3 text-[11px] text-slate-500">
        Your key is stored privately and never shown again. Key setup details live in the operator docs (.env.example).
      </p>
    </div>
  );
}
