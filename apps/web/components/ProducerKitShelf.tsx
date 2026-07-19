"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COARSE_MATERIAL_ROLES,
  GENRES,
  MATERIAL_FAMILIES,
  inferProducerKitFile,
  isMaterialRole,
  jobOf,
  type ProducerKitAudioMetrics,
} from "@afrohit/shared";
import {
  Check,
  ChevronRight,
  CircleAlert,
  FolderOpen,
  Loader2,
  Music2,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import { useApi } from "@/lib/api";

type Inference = ReturnType<typeof inferProducerKitFile>;

type LocalFile = {
  clientId: string;
  file: File;
  metrics: ProducerKitAudioMetrics | null;
  inference: Inference;
  role: string;
  bpm: string;
  keySignature: string;
  kind: "loop" | "stem";
  progress: number;
  error: string | null;
};

type KitFile = {
  clientId: string;
  fileName: string;
  materialId: string;
  ownedByKit: boolean;
  duplicateOf: string | null;
  kind: string;
  role: string | null;
  bpm: number | null;
  keySignature: string | null;
  durationS: number | null;
  url: string;
  readiness: string;
  qualityState: string;
  roleEvidence: string;
  rightsBasis: string;
  contentHash: string | null;
  inference: Inference;
};

type ShelfReadiness = {
  ready: boolean;
  readyFiles: number;
  roles: string[];
  recommendedRoles: string[];
  missingRecommendedRoles: string[];
  coverage: {
    ready: boolean;
    total: number;
    rhythm: number;
    lowEnd: number;
    tonal: number;
  };
};

type ProducerKit = {
  kitId: string;
  name: string;
  genre: string;
  defaultBpm: number | null;
  defaultKeySignature: string | null;
  state: "staged" | "ready" | "needs_attention";
  createdAt: string;
  confirmedAt: string | null;
  files: KitFile[];
  kitReadiness: ShelfReadiness;
  shelfReadiness: ShelfReadiness;
};

type KitEdit = {
  decision: "accept" | "reject";
  role: string;
  bpm: string;
  keySignature: string;
};

const audioMimeByExtension: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  mpeg: "audio/mpeg",
  mpg: "audio/mpeg",
  flac: "audio/flac",
  aiff: "audio/aiff",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  webm: "audio/webm",
};

function displayGenre(value: string): string {
  return value
    .split("_")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function displayRole(value: string): string {
  return value.replace(/_/g, " ");
}

function normalizedAudioFile(file: File): File {
  if (/^audio\//i.test(file.type)) return file;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = audioMimeByExtension[ext];
  return type ? new File([file], file.name, { type }) : file;
}

function dbfs(value: number): number {
  return value > 0 ? 20 * Math.log10(value) : -160;
}

async function measureInBrowser(file: File): Promise<ProducerKitAudioMetrics | null> {
  let context: AudioContext | null = null;
  try {
    context = new AudioContext();
    const audio = await context.decodeAudioData(await file.arrayBuffer());
    const stride = Math.max(1, Math.floor(audio.length / 300_000));
    let peak = 0;
    let sumSquares = 0;
    let sampled = 0;
    let clipped = 0;
    for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
      const data = audio.getChannelData(channel);
      for (let index = 0; index < data.length; index += stride) {
        const absolute = Math.abs(data[index] ?? 0);
        peak = Math.max(peak, absolute);
        sumSquares += absolute * absolute;
        sampled += 1;
        if (absolute >= 0.999) clipped += 1;
      }
    }
    return {
      durationS: Number(audio.duration.toFixed(4)),
      sampleRate: audio.sampleRate,
      channels: audio.numberOfChannels,
      peakDbfs: Number(dbfs(peak).toFixed(3)),
      rmsDbfs: Number(dbfs(Math.sqrt(sumSquares / Math.max(1, sampled))).toFixed(3)),
      clippedSampleRatio: Number((clipped / Math.max(1, sampled)).toFixed(6)),
    };
  } catch {
    return null;
  } finally {
    await context?.close().catch(() => undefined);
  }
}

function needsBpm(role: string): boolean {
  if (["drums", "percussion", "bass", "chords", "fill"].includes(role))
    return true;
  return isMaterialRole(role)
    ? ["rhythm", "low_end", "harmony"].includes(jobOf(role))
    : false;
}

function cleanError(raw: unknown): string {
  const message = raw instanceof Error ? raw.message : String(raw);
  if (/upload_rate_limited|\b429\b/.test(message))
    return "Upload limit reached. Wait a few minutes, then continue with this kit.";
  if (/material_bpm_required/.test(message))
    return "Add a BPM to every rhythm, bass, and harmony file.";
  if (/material_quality_rejected/.test(message))
    return "One file failed the audio-quality gate. Reject or replace it before confirming.";
  if (/uploaded_audio_size_changed/.test(message))
    return "One upload changed before verification. Choose the files again.";
  return message.split(": ").slice(-1)[0]?.slice(0, 240) || "Could not finish the kit.";
}

export function ProducerKitShelf() {
  const api = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kitName, setKitName] = useState("My Afrobeats kit");
  const [genre, setGenre] = useState<(typeof GENRES)[number]>("afrobeats");
  const [defaultBpm, setDefaultBpm] = useState("104");
  const [defaultKey, setDefaultKey] = useState("");
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([]);
  const [kits, setKits] = useState<ProducerKit[]>([]);
  const [activeKit, setActiveKit] = useState<ProducerKit | null>(null);
  const [edits, setEdits] = useState<Record<string, KitEdit>>({});
  const [busy, setBusy] = useState<"idle" | "analyzing" | "uploading" | "confirming">("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadKits = useCallback(async () => {
    const result = await api.get<{ kits: ProducerKit[] }>("/producer-kits");
    setKits(result.kits);
    return result.kits;
  }, [api]);

  useEffect(() => {
    void loadKits().catch(() => undefined);
  }, [loadKits]);

  const setKitForReview = useCallback((kit: ProducerKit) => {
    setActiveKit(kit);
    setEdits(
      Object.fromEntries(
        kit.files
          .filter(file => file.ownedByKit && !kit.confirmedAt)
          .map(file => [
            file.materialId,
            {
              decision: "accept",
              role: file.role ?? "",
              bpm: file.bpm != null ? String(file.bpm) : "",
              keySignature: file.keySignature ?? "",
            } satisfies KitEdit,
          ])
      )
    );
  }, []);

  async function chooseFiles(selected: FileList | null) {
    if (!selected?.length) return;
    setError(null);
    setNotice(null);
    const files = [...selected].slice(0, 24);
    if ([...selected].length > 24) {
      setNotice("Only the first 24 files were added. Split larger libraries into separate kits.");
    }
    const invalid = files.find(file => file.size < 1_000 || file.size > 80 * 1024 * 1024);
    if (invalid) {
      setError(`${invalid.name} must be between 1 KB and 80 MB.`);
      return;
    }
    setBusy("analyzing");
    try {
      const bpm = defaultBpm ? Number(defaultBpm) : null;
      const measured = await Promise.all(
        files.map(async file => {
          const normalized = normalizedAudioFile(file);
          const metrics = await measureInBrowser(normalized);
          const inference = inferProducerKitFile(normalized.name, metrics, {
            genre,
            bpm: Number.isFinite(bpm) ? bpm : null,
            keySignature: defaultKey || null,
          });
          return {
            clientId: crypto.randomUUID(),
            file: normalized,
            metrics,
            inference,
            role: inference.role.role ?? "",
            bpm: inference.bpm != null ? String(inference.bpm) : "",
            keySignature: inference.keySignature ?? "",
            kind: metrics && metrics.durationS > 64 ? "stem" : "loop",
            progress: 0,
            error: null,
          } satisfies LocalFile;
        })
      );
      setLocalFiles(measured);
    } finally {
      setBusy("idle");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function patchLocal(clientId: string, patch: Partial<LocalFile>) {
    setLocalFiles(current =>
      current.map(file => (file.clientId === clientId ? { ...file, ...patch } : file))
    );
  }

  const canUpload =
    localFiles.length > 0 &&
    localFiles.every(
      file =>
        file.role &&
        (!needsBpm(file.role) || Number(file.bpm) >= 40) &&
        file.inference.quality.status !== "rejected"
    );

  async function uploadKit() {
    if (!canUpload || busy !== "idle") return;
    setBusy("uploading");
    setError(null);
    setNotice(null);
    const kitId = crypto.randomUUID();
    try {
      const uploaded = new Array<{ key: string }>(localFiles.length);
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, localFiles.length) }, async () => {
          for (;;) {
            const index = next++;
            if (index >= localFiles.length) return;
            const local = localFiles[index]!;
            try {
              uploaded[index] = await api.uploadToStorage(local.file, "stem", fraction =>
                patchLocal(local.clientId, { progress: fraction })
              );
            } catch (uploadError) {
              patchLocal(local.clientId, { error: cleanError(uploadError) });
              throw uploadError;
            }
          }
        })
      );
      const kit = await api.post<ProducerKit>("/producer-kits/manifests", {
        kitId,
        name: kitName.trim(),
        genre,
        ...(defaultBpm ? { defaultBpm: Number(defaultBpm) } : {}),
        ...(defaultKey.trim() ? { defaultKeySignature: defaultKey.trim() } : {}),
        files: localFiles.map((local, index) => ({
          clientId: local.clientId,
          key: uploaded[index]!.key,
          fileName: local.file.name,
          sizeBytes: local.file.size,
          kind: local.kind,
          metrics: local.metrics,
          proposedRole: local.role,
          ...(local.bpm ? { proposedBpm: Number(local.bpm) } : {}),
          ...(local.keySignature.trim()
            ? { proposedKeySignature: local.keySignature.trim() }
            : {}),
        })),
        rightsConfirmation: { version: 1, confirmed: true },
      });
      setKitForReview(kit);
      setLocalFiles([]);
      setNotice(
        kit.files.every(file => !file.ownedByKit)
          ? "Every file already existed on your shelf. Nothing was duplicated."
          : "Kit uploaded. Confirm the inferred roles before these sounds enter AfroOne."
      );
      await loadKits();
    } catch (uploadError) {
      setError(cleanError(uploadError));
    } finally {
      setBusy("idle");
    }
  }

  function patchEdit(materialId: string, patch: Partial<KitEdit>) {
    setEdits(current => ({
      ...current,
      [materialId]: { ...current[materialId]!, ...patch },
    }));
  }

  const confirmableFiles = activeKit?.files.filter(file => file.ownedByKit) ?? [];
  const canConfirm =
    !!activeKit &&
    !activeKit.confirmedAt &&
    confirmableFiles.length > 0 &&
    confirmableFiles.every(file => {
      const edit = edits[file.materialId];
      return (
        edit?.decision === "reject" ||
        (!!edit?.role && (!needsBpm(edit.role) || Number(edit.bpm) >= 40))
      );
    });

  async function confirmKit() {
    if (!activeKit || !canConfirm || busy !== "idle") return;
    setBusy("confirming");
    setError(null);
    try {
      const kit = await api.post<ProducerKit>(
        `/producer-kits/${activeKit.kitId}/confirm`,
        {
          files: confirmableFiles.map(file => {
            const edit = edits[file.materialId]!;
            return edit.decision === "reject"
              ? { materialId: file.materialId, decision: "reject" }
              : {
                  materialId: file.materialId,
                  decision: "accept",
                  role: edit.role,
                  bpm: edit.bpm ? Number(edit.bpm) : null,
                  keySignature: edit.keySignature.trim() || null,
                  qualityConfirmed: true,
                };
          }),
        }
      );
      setActiveKit(kit);
      setNotice(
        kit.shelfReadiness.ready
          ? "Shelf confirmed and ready for AfroOne assembly."
          : "Kit confirmed. Shelf readiness shows the remaining roles to add."
      );
      await loadKits();
    } catch (confirmError) {
      setError(cleanError(confirmError));
    } finally {
      setBusy("idle");
    }
  }

  const roleGroups = useMemo(
    () =>
      Object.entries(MATERIAL_FAMILIES).map(([family, roles]) => ({
        family,
        roles: [...roles],
      })),
    []
  );

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase text-afrobrand-300">
            <Music2 className="h-4 w-4" /> Personal material shelf
          </div>
          <h1 className="mt-2 font-display text-3xl text-white">Bring your sound into AfroOne</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Add a kit in one batch. The studio infers each role, tempo, key and audio condition; you make the final call before a sound becomes usable.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400" /> Workspace-private and rights-attested
        </div>
      </div>

      {(error || notice) && (
        <div
          role={error ? "alert" : "status"}
          className={`mt-5 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
            error
              ? "border-red-500/30 bg-red-500/10 text-red-200"
              : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {error ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{error ?? notice}</span>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-slate-400 sm:col-span-2">
              Kit name
              <input
                value={kitName}
                onChange={event => setKitName(event.target.value)}
                maxLength={100}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-afrobrand-500/60"
              />
            </label>
            <label className="text-xs text-slate-400">
              Genre lane
              <select
                value={genre}
                onChange={event => setGenre(event.target.value as (typeof GENRES)[number])}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white outline-none focus:border-afrobrand-500/60"
              >
                {GENRES.map(option => (
                  <option key={option} value={option}>{displayGenre(option)}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-400">
                Default BPM
                <input
                  type="number"
                  min={40}
                  max={220}
                  value={defaultBpm}
                  onChange={event => setDefaultBpm(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-afrobrand-500/60"
                />
              </label>
              <label className="text-xs text-slate-400">
                Default key
                <input
                  value={defaultKey}
                  onChange={event => setDefaultKey(event.target.value)}
                  placeholder="A minor"
                  maxLength={24}
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-afrobrand-500/60"
                />
              </label>
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept="audio/*,.wav,.mp3,.mpeg,.mpg,.flac,.aiff,.m4a,.ogg,.webm"
            className="hidden"
            onChange={event => void chooseFiles(event.target.files)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy !== "idle"}
            className="mt-5 flex min-h-28 w-full items-center justify-center gap-3 rounded-lg border border-dashed border-white/15 bg-white/[0.025] px-5 py-6 text-left transition hover:border-afrobrand-500/50 hover:bg-afrobrand-500/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "analyzing" ? (
              <Loader2 className="h-6 w-6 animate-spin text-afrobrand-400" />
            ) : (
              <FolderOpen className="h-6 w-6 text-afrobrand-400" />
            )}
            <span>
              <span className="block text-sm font-medium text-white">
                {busy === "analyzing" ? "Reading audio measurements…" : "Choose up to 24 kit files"}
              </span>
              <span className="mt-1 block text-xs text-slate-500">WAV, MP3, FLAC, AIFF, M4A, OGG or WebM · 80 MB each</span>
            </span>
          </button>

          {localFiles.length > 0 && (
            <div className="mt-5 overflow-hidden rounded-lg border border-white/10">
              <div className="grid grid-cols-[minmax(150px,1.4fr)_minmax(130px,1fr)_90px_110px_72px] gap-2 border-b border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase text-slate-500">
                <span>File</span><span>Role</span><span>BPM</span><span>Key</span><span>Type</span>
              </div>
              {localFiles.map(local => (
                <div key={local.clientId} className="border-b border-white/5 px-3 py-3 last:border-0">
                  <div className="grid items-center gap-2 md:grid-cols-[minmax(150px,1.4fr)_minmax(130px,1fr)_90px_110px_72px]">
                    <div className="min-w-0">
                      <div className="truncate text-sm text-slate-200" title={local.file.name}>{local.file.name}</div>
                      <div className={`mt-1 text-[11px] ${local.inference.quality.status === "rejected" ? "text-red-300" : local.inference.quality.status === "review" ? "text-amber-300" : "text-emerald-300"}`}>
                        {local.inference.quality.status === "passed" ? "audio check passed" : local.inference.quality.reasons.join("; ")}
                      </div>
                      {local.progress > 0 && local.progress < 1 && (
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-afrobrand-400" style={{ width: `${Math.round(local.progress * 100)}%` }} /></div>
                      )}
                    </div>
                    <select
                      aria-label={`Role for ${local.file.name}`}
                      value={local.role}
                      onChange={event => patchLocal(local.clientId, { role: event.target.value })}
                      className="min-w-0 rounded-lg border border-white/10 bg-ink px-2 py-2 text-xs text-white"
                    >
                      <option value="">Choose role</option>
                      <optgroup label="Broad stems">
                        {COARSE_MATERIAL_ROLES.map(role => <option key={role} value={role}>{displayRole(role)}</option>)}
                        <option value="fill">fill</option>
                      </optgroup>
                      {roleGroups.map(group => (
                        <optgroup key={group.family} label={displayRole(group.family)}>
                          {group.roles.map(role => <option key={role} value={role}>{displayRole(role)}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <input aria-label={`BPM for ${local.file.name}`} type="number" min={40} max={220} value={local.bpm} onChange={event => patchLocal(local.clientId, { bpm: event.target.value })} className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-white" />
                    <input aria-label={`Key for ${local.file.name}`} value={local.keySignature} onChange={event => patchLocal(local.clientId, { keySignature: event.target.value })} placeholder="Optional" className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-white" />
                    <select aria-label={`Kind for ${local.file.name}`} value={local.kind} onChange={event => patchLocal(local.clientId, { kind: event.target.value as "loop" | "stem" })} className="rounded-lg border border-white/10 bg-ink px-2 py-2 text-xs text-white"><option value="loop">Loop</option><option value="stem">Stem</option></select>
                  </div>
                  {local.error && <div className="mt-2 text-xs text-red-300">{local.error}</div>}
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-white/[0.025] px-3 py-3">
                <button type="button" onClick={() => setLocalFiles([])} disabled={busy !== "idle"} className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white disabled:opacity-50"><X className="h-4 w-4" /> Clear</button>
                <button type="button" onClick={() => void uploadKit()} disabled={!canUpload || busy !== "idle"} className="inline-flex items-center gap-2 rounded-lg bg-afrobrand-500 px-4 py-2 text-sm font-medium text-white hover:bg-afrobrand-400 disabled:cursor-not-allowed disabled:opacity-40">
                  {busy === "uploading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                  {busy === "uploading" ? "Uploading kit…" : "Upload for confirmation"}
                </button>
              </div>
            </div>
          )}

          {activeKit && (
            <div className="mt-8 border-t border-white/10 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase text-slate-500">Confirm kit</div>
                  <h2 className="mt-1 text-xl font-semibold text-white">{activeKit.name}</h2>
                  <p className="mt-1 text-xs text-slate-400">{displayGenre(activeKit.genre)} · {activeKit.files.length} files</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs ${activeKit.shelfReadiness.ready ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>
                  {activeKit.shelfReadiness.ready ? "Shelf ready" : `${activeKit.shelfReadiness.readyFiles} ready files`}
                </span>
              </div>

              <div className="mt-4 space-y-2">
                {activeKit.files.map(file => {
                  const edit = edits[file.materialId];
                  const immutable = !file.ownedByKit || !!activeKit.confirmedAt;
                  return (
                    <div key={`${file.clientId}:${file.materialId}`} className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-slate-200">{file.fileName}</div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {file.duplicateOf ? "Already on this workspace shelf" : `${file.inference.role.reason} · ${file.inference.quality.status}`}
                          </div>
                        </div>
                        {file.url && <audio controls preload="none" src={file.url} className="h-8 max-w-full sm:w-64" />}
                      </div>
                      {immutable ? (
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
                          <span>{displayRole(file.role ?? "unassigned")}</span><span>·</span><span>{file.bpm ?? "no BPM"}</span><span>·</span><span>{file.readiness}</span>
                        </div>
                      ) : edit ? (
                        <div className="mt-3 grid items-center gap-2 sm:grid-cols-[minmax(150px,1fr)_90px_120px_auto]">
                          <select value={edit.role} disabled={edit.decision === "reject"} onChange={event => patchEdit(file.materialId, { role: event.target.value })} className="rounded-lg border border-white/10 bg-ink px-2 py-2 text-xs text-white disabled:opacity-40">
                            <option value="">Choose role</option>
                            <optgroup label="Broad stems">{COARSE_MATERIAL_ROLES.map(role => <option key={role} value={role}>{displayRole(role)}</option>)}<option value="fill">fill</option></optgroup>
                            {roleGroups.map(group => <optgroup key={group.family} label={displayRole(group.family)}>{group.roles.map(role => <option key={role} value={role}>{displayRole(role)}</option>)}</optgroup>)}
                          </select>
                          <input type="number" min={40} max={220} value={edit.bpm} disabled={edit.decision === "reject"} onChange={event => patchEdit(file.materialId, { bpm: event.target.value })} aria-label={`Confirmed BPM for ${file.fileName}`} className="rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-white disabled:opacity-40" />
                          <input value={edit.keySignature} disabled={edit.decision === "reject"} onChange={event => patchEdit(file.materialId, { keySignature: event.target.value })} placeholder="Key (optional)" aria-label={`Confirmed key for ${file.fileName}`} className="rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-white disabled:opacity-40" />
                          <button type="button" onClick={() => patchEdit(file.materialId, { decision: edit.decision === "reject" ? "accept" : "reject" })} className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs ${edit.decision === "reject" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-white/10 text-slate-400 hover:text-white"}`}>
                            {edit.decision === "reject" ? <><RefreshCw className="h-3.5 w-3.5" /> Keep</> : <><X className="h-3.5 w-3.5" /> Reject</>}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {!activeKit.confirmedAt && confirmableFiles.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="max-w-xl text-xs leading-5 text-slate-500">By confirming, you attest that each kept file plays cleanly and serves the selected musical role. Rejected files stay out of AfroOne.</p>
                  <button type="button" onClick={() => void confirmKit()} disabled={!canConfirm || busy !== "idle"} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-ink hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
                    {busy === "confirming" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Confirm shelf files
                  </button>
                </div>
              )}

              {!activeKit.shelfReadiness.ready && activeKit.shelfReadiness.missingRecommendedRoles.length > 0 && (
                <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="text-xs font-medium text-amber-200">Recommended next roles</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeKit.shelfReadiness.missingRecommendedRoles.slice(0, 10).map(role => <span key={role} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-slate-400">{displayRole(role)}</span>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="border-l-0 border-white/10 lg:border-l lg:pl-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-white">Your kits</h2>
            <button type="button" onClick={() => void loadKits()} title="Refresh kits" aria-label="Refresh kits" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white"><RefreshCw className="h-4 w-4" /></button>
          </div>
          <div className="mt-3 space-y-2">
            {kits.length === 0 && <p className="text-xs leading-5 text-slate-500">Your confirmed and in-progress kits will appear here.</p>}
            {kits.map(kit => (
              <button key={kit.kitId} type="button" onClick={() => setKitForReview(kit)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.025] px-3 py-3 text-left hover:border-white/20 hover:bg-white/5">
                <span className="min-w-0"><span className="block truncate text-sm text-slate-200">{kit.name}</span><span className="mt-1 block text-[11px] text-slate-500">{displayGenre(kit.genre)} · {kit.files.length} files</span></span>
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-500">{kit.shelfReadiness.ready ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <CircleAlert className="h-3.5 w-3.5 text-amber-400" />}<ChevronRight className="h-3.5 w-3.5" /></span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
