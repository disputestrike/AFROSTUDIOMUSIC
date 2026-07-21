'use client';

import { useEffect, useRef, useState } from 'react';
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
        <div className="mt-10 grid gap-6">
          <ProfilePicture />
          <WorkspaceTeam />
        </div>
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

      <div className="mt-10 grid gap-6">
        <ProfilePicture />
        <WorkspaceTeam />
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

interface MeProfile {
  userId: string;
  role?: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

/**
 * PROFILE PICTURE (identity wave). Upload → presigned PUT → PATCH /auth/me
 * with the storage key; the server verifies the real bytes (PNG/JPEG/WebP,
 * ≤5MB) before the avatar exists. Shown here and in the top bar.
 */
function ProfilePicture() {
  const api = useApi();
  const fileInput = useRef<HTMLInputElement>(null);
  const [me, setMe] = useState<MeProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get<MeProfile>('/auth/me').then(setMe).catch(() => setMe(null));
  }, [api]);

  async function upload(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const { key } = await api.uploadImageToStorage(file, 'avatar');
      const updated = await api.patch<MeProfile>('/auth/me', { avatarKey: key });
      setMe((m) => (m ? { ...m, avatarUrl: updated.avatarUrl } : m));
      setMsg({ ok: true, text: 'Profile picture updated ✓ (refresh to see it in the top bar)' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message.slice(0, 200) });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function removeAvatar() {
    setBusy(true);
    setMsg(null);
    try {
      await api.patch('/auth/me', { avatarKey: null });
      setMe((m) => (m ? { ...m, avatarUrl: null } : m));
      setMsg({ ok: true, text: 'Removed.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message.slice(0, 200) });
    } finally {
      setBusy(false);
    }
  }

  const initial = (me?.name || me?.email || '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="rounded-2xl border-gradient glass p-5">
      <h2 className="font-display text-2xl">🖼 Profile picture</h2>
      <p className="mt-2 text-sm text-slate-400">Shown in the top bar and to your teammates. JPEG, PNG, or WebP — up to 5MB.</p>
      <div className="mt-4 flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/5 font-grotesk text-xl text-slate-200">
          {me?.avatarUrl ? (
            <img src={me.avatarUrl} alt="Your avatar" className="h-full w-full object-cover" />
          ) : (
            initial
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          aria-label="Upload profile picture"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <button
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
        >
          {busy ? 'Uploading…' : me?.avatarUrl ? 'Change picture' : 'Upload picture'}
        </button>
        {me?.avatarUrl && (
          <button onClick={() => void removeAvatar()} disabled={busy} className="text-xs text-slate-500 hover:text-slate-300">
            Remove
          </button>
        )}
        {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: string;
  active: boolean;
}

interface MemberRow {
  userId: string;
  role: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface InviteRow {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  inviteUrl?: string | null;
}

const INVITE_ROLES = ['ADMIN', 'PRODUCER', 'VIEWER'] as const;

/**
 * WORKSPACES & TEAM (identity wave). List/create/switch workspaces; ADMIN+
 * invites members (single-use link, 7 days); OWNER changes roles / removes
 * members. Presentation follows the role from /auth/me — the server enforces
 * every gate regardless.
 */
function WorkspaceTeam() {
  const api = useApi();
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [me, setMe] = useState<MeProfile | null>(null);
  const [newName, setNewName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('PRODUCER');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const myRole = workspaces.find((w) => w.active)?.role ?? me?.role ?? 'PRODUCER';
  const isOwner = myRole === 'OWNER';
  const isAdmin = isOwner || myRole === 'ADMIN';

  async function refresh() {
    const [ws, m] = await Promise.all([
      api.get<WorkspaceRow[]>('/workspaces').catch(() => [] as WorkspaceRow[]),
      api.get<MeProfile>('/auth/me').catch(() => null),
    ]);
    setWorkspaces(ws);
    setMe(m);
    const admin = m?.role === 'OWNER' || m?.role === 'ADMIN';
    const [mem, inv] = await Promise.all([
      api.get<MemberRow[]>('/workspaces/members').catch(() => [] as MemberRow[]),
      admin ? api.get<InviteRow[]>('/workspaces/invites').catch(() => [] as InviteRow[]) : Promise.resolve([] as InviteRow[]),
    ]);
    setMembers(mem);
    setInvites(inv);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function createWorkspace() {
    if (!newName.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/workspaces', { name: newName.trim() });
      setNewName('');
      setMsg({ ok: true, text: 'Workspace created — switch to it below.' });
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message.slice(0, 200) });
    } finally {
      setBusy(false);
    }
  }

  async function switchTo(id: string) {
    setBusy(true);
    try {
      await api.post(`/workspaces/${id}/switch`, {});
      // The session cookie now targets the other studio — reload everything.
      window.location.reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message.slice(0, 200) });
      setBusy(false);
    }
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    setMsg(null);
    setInviteLink(null);
    try {
      const created = await api.post<InviteRow & { inviteUrl: string | null; token: string }>(
        '/workspaces/invites',
        { email: inviteEmail.trim(), role: inviteRole },
      );
      setInviteEmail('');
      setInviteLink(created.inviteUrl ?? null);
      setMsg({ ok: true, text: created.inviteUrl ? 'Invite created — share the link below.' : 'Invite created.' });
      await refresh();
    } catch (e) {
      const raw = (e as Error).message;
      setMsg({
        ok: false,
        text: /already_a_member/.test(raw) ? 'That person is already in this workspace.' : raw.slice(0, 200),
      });
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, role: string) {
    setBusy(true);
    setMsg(null);
    try {
      await api.patch(`/workspaces/members/${userId}`, { role });
      await refresh();
    } catch (e) {
      const raw = (e as Error).message;
      setMsg({ ok: false, text: /last_owner/.test(raw) ? 'Promote another OWNER first — a workspace always keeps one.' : raw.slice(0, 200) });
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(userId: string) {
    setBusy(true);
    setMsg(null);
    try {
      await api.del(`/workspaces/members/${userId}`);
      await refresh();
    } catch (e) {
      const raw = (e as Error).message;
      setMsg({ ok: false, text: /last_owner/.test(raw) ? 'A workspace always keeps at least one OWNER.' : raw.slice(0, 200) });
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvite(id: string) {
    setBusy(true);
    try {
      await api.del(`/workspaces/invites/${id}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border-gradient glass p-5">
      <h2 className="font-display text-2xl">👥 Workspaces &amp; team</h2>
      <p className="mt-2 text-sm text-slate-400">
        Each workspace is its own studio — catalog, credits, and team. You are {myRole} here.
      </p>

      {/* My workspaces + switcher */}
      <div className="mt-4 grid gap-2">
        {workspaces.map((w) => (
          <div key={w.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="min-w-0">
              <span className="truncate text-sm text-slate-200">{w.name}</span>
              <span className="ml-2 text-xs text-slate-500">{w.role}</span>
            </div>
            {w.active ? (
              <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs text-emerald-300">Active</span>
            ) : (
              <button
                onClick={() => void switchTo(w.id)}
                disabled={busy}
                className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-50"
              >
                Switch
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New workspace name"
          aria-label="New workspace name"
          maxLength={80}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
        />
        <button
          onClick={() => void createWorkspace()}
          disabled={busy || !newName.trim()}
          className="rounded-full border border-white/15 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
        >
          + Create workspace
        </button>
      </div>

      {/* Members */}
      <h3 className="mt-6 font-grotesk text-sm uppercase tracking-wide text-slate-400">Members</h3>
      <div className="mt-2 grid gap-2">
        {members.map((m) => (
          <div key={m.userId} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/5 text-xs text-slate-300">
                {m.avatarUrl ? <img src={m.avatarUrl} alt="" className="h-full w-full object-cover" /> : (m.name || m.email).charAt(0).toUpperCase()}
              </span>
              <span className="truncate text-sm text-slate-200">{m.name || m.email}</span>
              {m.userId === me?.userId && <span className="text-xs text-slate-500">(you)</span>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isOwner && m.userId !== me?.userId ? (
                <>
                  <select
                    value={m.role}
                    onChange={(e) => void changeRole(m.userId, e.target.value)}
                    disabled={busy}
                    aria-label={`Role for ${m.email}`}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                  >
                    {['OWNER', 'ADMIN', 'PRODUCER', 'VIEWER'].map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => void removeMember(m.userId)}
                    disabled={busy}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="text-xs text-slate-500">{m.role}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Invites (ADMIN+) */}
      {isAdmin && (
        <>
          <h3 className="mt-6 font-grotesk text-sm uppercase tracking-wide text-slate-400">Invite someone</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@email.com"
              aria-label="Invite email"
              type="email"
              className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              aria-label="Invite role"
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm"
            >
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button
              onClick={() => void sendInvite()}
              disabled={busy || !inviteEmail.trim()}
              className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-50"
            >
              Invite
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            ADMIN manages people &amp; settings · PRODUCER makes music · VIEWER listens only. Links last 7 days, single use.
          </p>
          {inviteLink && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
              <code className="min-w-0 flex-1 truncate text-xs text-emerald-300">{inviteLink}</code>
              <button
                onClick={() => void navigator.clipboard?.writeText(inviteLink)}
                className="shrink-0 text-xs text-emerald-300 hover:text-emerald-200"
              >
                Copy
              </button>
            </div>
          )}
          {invites.length > 0 && (
            <div className="mt-3 grid gap-1.5">
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 px-3 py-1.5 text-xs text-slate-400">
                  <span className="truncate">{inv.email} · {inv.role} · expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
                  <button onClick={() => void revokeInvite(inv.id)} disabled={busy} className="shrink-0 text-red-400 hover:text-red-300">
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {msg && <p className={`mt-3 text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>}
    </div>
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
