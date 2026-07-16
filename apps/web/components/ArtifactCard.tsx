"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/api";
import { formatElapsed } from "@/lib/utils";
import { humanizeChatError } from "@afrohit/shared";
import {
  CheckCircle2,
  ListMusic,
  FileText,
  Image as ImageIcon,
  Film,
  ShieldCheck,
  Clock,
  Pencil,
  Check,
  RotateCcw,
} from "lucide-react";

interface Props {
  toolName: string;
  output: unknown;
  /** Send a follow-up message to the chat (e.g. "use hook 3"). */
  onAction?: (prompt: string) => void;
}

/**
 * Renders the right card for each chat tool's return shape. We deliberately
 * keep this minimal in MVP — every artifact has an obvious next-action button
 * the user can hit.
 */
export function ArtifactCard({ toolName, output, onAction }: Props) {
  const o = output as Record<string, unknown>;
  if (!o) return null;
  if ((o as { pending?: boolean }).pending) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Clock className="h-4 w-4 animate-pulse text-afrobrand-400" /> running…
      </div>
    );
  }
  if ((o as { error?: string }).error) {
    // §1.11 THE WALL: never render the machine error string — one human
    // sentence, one retry, internals behind a collapsed expander.
    const human = humanizeChatError(o);
    return (
      <div className="rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-200">
        <div>{human.text}</div>
        <div className="mt-2 flex items-start gap-3">
          {human.canRetry && onAction && (
            <button
              onClick={() => onAction("Run that last step again.")}
              className="flex items-center gap-1.5 rounded-full border border-red-800/60 px-3 py-1 text-xs text-red-200 hover:bg-red-900/40"
            >
              <RotateCcw className="h-3 w-3" /> Try again
            </button>
          )}
          {human.details && (
            <details className="min-w-0 text-[10px] text-red-300/50">
              <summary className="cursor-pointer select-none py-1">Details</summary>
              <div className="mt-1 whitespace-pre-wrap break-words">{human.details}</div>
            </details>
          )}
        </div>
      </div>
    );
  }

  switch (toolName) {
    case "generate_hooks":
      return (
        <HookList
          hooks={
            (
              o as {
                hooks: Array<{
                  id: string;
                  text: string;
                  score?: number | null;
                  viralScore?: number | null;
                  tiktokMoment?: string | null;
                }>;
              }
            ).hooks ?? []
          }
          projectId={(o as { projectId?: string }).projectId}
          onAction={onAction}
        />
      );
    case "score_hooks":
      return (
        <ScoresList
          scores={
            (
              o as {
                scores: Array<{ id: string; overall: number; notes?: string }>;
              }
            ).scores ?? []
          }
        />
      );
    case "generate_lyrics":
      return (
        <LyricSummary
          lyric={(o as { lyric: { id: string; title: string } }).lyric}
        />
      );
    case "research_trends":
      return <TrendsCard o={o as never} />;
    case "polish_brief":
      return (
        <BriefSummary
          brief={(o as { polished: Record<string, unknown> }).polished}
        />
      );
    case "create_beat_job":
    case "render_demo_vocal":
    case "generate_cover_art":
    case "render_video":
    case "create_release_kit":
    case "master_song":
    case "make_snippet":
    case "separate_stems":
    case "make_material_beat":
    case "assemble_beat": {
      // Some material-path results come back without a trackable job — a quiet
      // chip beats a poller aimed at /jobs/undefined.
      const jobId = (o as { jobId?: unknown }).jobId;
      if (typeof jobId !== "string" || !jobId)
        return <DoneChip label={PRETTY[toolName] ?? "Queued"} />;
      return <JobPending jobId={jobId} kind={toolName} onAction={onAction} />;
    }
    case "generate_video_storyboard":
      return (
        <Storyboard
          concept={
            (o as { concept: { id: string; title: string; shots: unknown[] } })
              .concept
          }
        />
      );
    case "approve_hook":
      return (
        <ApprovedHook
          hookId={String((o as { hookId: string }).hookId)}
          songId={String((o as { songId: string }).songId)}
        />
      );
    case "run_rights_check":
      return <RightsResult o={o as never} />;
    case "request_approval":
      return (
        <ApprovalRequest
          gate={String((o as { gate: string }).gate)}
          note={String((o as { note?: string }).note ?? "")}
        />
      );
    case "predict_hit":
      return <HitScoreCard o={o as never} />;
    case "list_catalog":
    case "list_beats":
      return (
        <CatalogList
          o={o as never}
          label={toolName === "list_beats" ? "beats" : "songs"}
        />
      );
    case "show_data_lake":
      return <DataLakeCard o={o as never} />;
    case "run_drop":
      return <DropSummary o={o as never} />;
    // Everything else: a quiet confirmation chip. The model's own message already
    // explains what happened — NEVER dump raw tool JSON into the chat (that was the
    // "why is it showing json" bug).
    default:
      return <DoneChip label={PRETTY[toolName] ?? "Done"} />;
  }
}

const PRETTY: Record<string, string> = {
  master_song: "Master queued",
  make_snippet: "Snippet queued",
  analyze_audio: "Listening to the track…",
  separate_stems: "Stems queued",
  forge_materials: "Forging loops",
  assemble_beat: "Assembling the beat",
  learn_lyrics: "Learned the craft",
  set_release_rights: "Rights updated",
  reject_hook: "Hook rejected",
};

function DoneChip({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> {label}
    </div>
  );
}

function HitScoreCard({
  o,
}: {
  o: {
    hitScore?: number;
    viralScore?: number;
    verdict?: string;
    toMakeItBigger?: string[];
  };
}) {
  const hit = o.hitScore ?? 0;
  const viral = o.viralScore ?? 0;
  const best = Math.max(hit, viral);
  const tone =
    best >= 70
      ? "text-emerald-300"
      : best >= 50
        ? "text-amber-300"
        : "text-red-300";
  return (
    <div className="text-sm">
      <div className="mb-1 flex items-center gap-2 font-medium text-slate-200">
        <ShieldCheck className="h-4 w-4 text-afrobrand-400" /> Will it hit?
      </div>
      <div className={`flex gap-4 font-semibold ${tone}`}>
        <span>Hit {hit}/100</span>
        <span>🔥 Viral {viral}/100</span>
      </div>
      {o.verdict && <p className="mt-1 text-xs text-slate-400">{o.verdict}</p>}
      {o.toMakeItBigger?.length ? (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-300">
          {o.toMakeItBigger.slice(0, 3).map((n, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="shrink-0 text-afrobrand-400">→</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CatalogList({
  o,
  label,
}: {
  o: {
    count?: number;
    songs?: Array<{
      title?: string;
      status?: string;
      audioUrl?: string | null;
    }>;
    beats?: Array<{ title?: string; provider?: string }>;
  };
  label: string;
}) {
  const rows = (o.songs ?? o.beats ?? []) as Array<{
    title?: string;
    status?: string;
    audioUrl?: string | null;
    provider?: string;
  }>;
  return (
    <div className="text-sm">
      <div className="mb-1 flex items-center gap-2 font-medium text-slate-200">
        <ListMusic className="h-4 w-4 text-afrobrand-400" />{" "}
        {o.count ?? rows.length} {label}
      </div>
      <ul className="space-y-0.5 text-xs text-slate-300">
        {rows.slice(0, 6).map((s, i) => (
          <li key={i} className="flex items-center gap-2 truncate">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.audioUrl ? "bg-emerald-400" : "bg-slate-600"}`}
            />
            <span className="truncate">
              {(s.title || "Untitled").slice(0, 46)}
            </span>
            <span className="ml-auto shrink-0 text-slate-500">
              {s.status ?? s.provider ?? ""}
            </span>
          </li>
        ))}
        {rows.length > 6 && (
          <li className="text-slate-500">+{rows.length - 6} more</li>
        )}
      </ul>
    </div>
  );
}

function DataLakeCard({
  o,
}: {
  o: { totalReferences?: number; byKind?: Record<string, number> };
}) {
  const k = o.byKind ?? {};
  return (
    <div className="text-sm">
      <div className="mb-1 flex items-center gap-2 font-medium text-slate-200">
        <FileText className="h-4 w-4 text-afrobrand-400" /> Data lake —{" "}
        {o.totalReferences ?? 0} references
      </div>
      <div className="text-xs text-slate-400">
        {k.heardSongs ?? 0} heard · {k.lyricCraft ?? 0} lyric-craft ·{" "}
        {k.trendSnapshots ?? 0} trends · {k.selfTraining ?? 0} self-training
        {k.zapped ? ` · ${k.zapped} zapped` : ""}
        {k.referenceFacts ? ` · ${k.referenceFacts} measured facts` : ""}
        {k.unclassified ? ` · ${k.unclassified} unclassified` : ""}
        {k.failed ? ` · ${k.failed} failed` : ""}
      </div>
    </div>
  );
}

function DropSummary({
  o,
}: {
  o: { drop?: Array<{ hookText?: string; score?: number | null }> };
}) {
  const d = o.drop ?? [];
  return (
    <div className="text-sm">
      <div className="mb-1 flex items-center gap-2 font-medium text-slate-200">
        <ListMusic className="h-4 w-4 text-afrobrand-400" /> Drop — {d.length}{" "}
        take{d.length === 1 ? "" : "s"}
      </div>
      <ul className="space-y-0.5 text-xs text-slate-300">
        {d.slice(0, 4).map((t, i) => (
          <li key={i} className="truncate">
            {(t.hookText || "").slice(0, 50)}{" "}
            {typeof t.score === "number" && (
              <span className="text-afrobrand-300">({t.score.toFixed(1)})</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

type HookItem = {
  id: string;
  text: string;
  score?: number | null;
  viralScore?: number | null;
  tiktokMoment?: string | null;
};

function HookList({
  hooks,
  projectId,
  onAction,
}: {
  hooks: HookItem[];
  projectId?: string;
  onAction?: (prompt: string) => void;
}) {
  const api = useApi();
  const [items, setItems] = useState<HookItem[]>(hooks);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [usedId, setUsedId] = useState<string | null>(null);

  async function saveEdit(id: string) {
    const text = draft.trim();
    if (!text || !projectId) {
      setEditId(null);
      return;
    }
    setBusy(`${id}:edit`);
    try {
      const r = await api.patch<{ text: string }>(
        `/projects/${projectId}/hooks/${id}`,
        { text }
      );
      setItems(arr => arr.map(h => (h.id === id ? { ...h, text: r.text } : h)));
    } catch {
      /* keep the old text */
    } finally {
      setEditId(null);
      setBusy("");
    }
  }

  async function selectHook(h: HookItem) {
    setBusy(`${h.id}:use`);
    try {
      if (projectId)
        await api.post(`/projects/${projectId}/hooks/${h.id}/approve`, {});
      setUsedId(h.id);
      // Deterministic selection done server-side; ask the model to continue.
      onAction?.(
        `I approved this hook: "${h.text.replace(/\n/g, " ").slice(0, 90)}". Write the full lyrics for it, then produce the song.`
      );
    } catch {
      onAction?.(
        `Approve the hook "${h.text.replace(/\n/g, " ").slice(0, 60)}" and write its lyrics.`
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-medium text-slate-200">
        <ListMusic className="h-4 w-4 text-afrobrand-400" /> {items.length}{" "}
        hooks — edit any, then pick one
      </div>
      <ol className="grid gap-2 sm:grid-cols-2">
        {items.map((h, i) => (
          <li
            key={h.id}
            className={`flex flex-col gap-1.5 rounded-lg border p-2.5 text-slate-100 ${usedId === h.id ? "border-emerald-500/50 bg-emerald-500/5" : "border-slate-800 bg-black/30"}`}
          >
            {editId === h.id ? (
              <div className="flex flex-col gap-1.5">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
                  autoFocus
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={() => void saveEdit(h.id)}
                    disabled={busy === `${h.id}:edit`}
                    className="rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-2.5 py-0.5 text-xs text-afrobrand-300 hover:bg-afrobrand-500/20"
                  >
                    <Check className="mr-0.5 inline h-3 w-3" />
                    Save
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-slate-400 hover:bg-white/5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <span className="mt-0.5 select-none text-xs font-semibold text-afrobrand-400">
                    {i + 1}.
                  </span>
                  <span className="whitespace-pre-wrap text-sm leading-snug">
                    {h.text}
                  </span>
                  {typeof h.score === "number" && (
                    <span
                      className="ml-auto shrink-0 self-start rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-afrobrand-300"
                      title="A&R overall score"
                    >
                      {h.score.toFixed(1)}
                    </span>
                  )}
                </div>
                {typeof h.viralScore === "number" && (
                  <div className="pl-5 text-[10px] text-pink-300">
                    🔥 viral {h.viralScore.toFixed(1)}/10
                    {h.tiktokMoment ? ` · ${h.tiktokMoment}` : ""}
                  </div>
                )}
                <div className="flex gap-1.5 pl-5">
                  <button
                    onClick={() => {
                      setEditId(h.id);
                      setDraft(h.text);
                    }}
                    className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-slate-300 hover:bg-white/10"
                  >
                    <Pencil className="mr-0.5 inline h-3 w-3" />
                    Edit
                  </button>
                  <button
                    onClick={() => void selectHook(h)}
                    disabled={busy === `${h.id}:use` || usedId === h.id}
                    className="rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-2.5 py-0.5 text-xs text-afrobrand-300 hover:bg-afrobrand-500/20 disabled:opacity-50"
                  >
                    {usedId === h.id ? "Using ✓" : "Use this hook →"}
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ScoresList({
  scores,
}: {
  scores: Array<{ id: string; overall: number; notes?: string }>;
}) {
  const sorted = [...scores].sort((a, b) => b.overall - a.overall);
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-slate-300">
        A&R scores
      </div>
      <ul className="space-y-1.5">
        {sorted.map((s, i) => (
          <li
            key={s.id}
            className="flex items-center gap-3 rounded-lg border border-slate-800 bg-black/30 p-2 text-xs"
          >
            <span className="select-none text-slate-500">{i + 1}.</span>
            <span className="w-10 text-right font-semibold text-afrobrand-400">
              {s.overall.toFixed(1)}
            </span>
            <span className="text-slate-300">{s.notes ?? "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LyricSummary({ lyric }: { lyric: { id: string; title: string } }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-200">
      <FileText className="h-4 w-4 text-afrobrand-400" />
      Lyric ready: <span className="font-medium">{lyric.title}</span>
    </div>
  );
}

function TrendsCard({
  o,
}: {
  o: { digest?: string; sources?: Array<{ title: string; url: string }> };
}) {
  return (
    <div className="text-sm">
      <div className="mb-1 flex items-center gap-2 font-medium text-slate-200">
        <ListMusic className="h-4 w-4 text-afrobrand-400" /> Trending now
      </div>
      <p className="whitespace-pre-wrap text-slate-300">{o.digest}</p>
      {o.sources && o.sources.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {o.sources.slice(0, 5).map((s, i) => (
            <li key={i} className="truncate text-xs">
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="text-afrobrand-400 hover:underline"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BriefSummary({ brief }: { brief: Record<string, unknown> }) {
  const b = brief as {
    mood?: string;
    topic?: string;
    language?: string[];
    audience?: string;
    bpm?: number;
    references?: Array<{ name: string; lane: string }>;
    notes?: string;
  };
  const row = (label: string, value?: React.ReactNode) =>
    value ? (
      <div className="flex gap-2">
        <span className="w-20 shrink-0 text-slate-500">{label}</span>
        <span className="text-slate-200">{value}</span>
      </div>
    ) : null;
  return (
    <div className="space-y-1 text-sm">
      <div className="mb-1 flex items-center gap-2 font-medium text-slate-200">
        <FileText className="h-4 w-4 text-afrobrand-400" /> Song brief
      </div>
      {row("Mood", b.mood)}
      {row("Topic", b.topic)}
      {row("Language", b.language?.join(", "))}
      {row("Audience", b.audience)}
      {row("BPM", b.bpm)}
      {row("Lane", b.references?.map(r => `${r.name} (${r.lane})`).join(", "))}
      {row("Notes", b.notes)}
    </div>
  );
}

function Storyboard({
  concept,
}: {
  concept: { id: string; title: string; shots: unknown[] };
}) {
  return (
    <div className="text-sm text-slate-200">
      <div className="flex items-center gap-2">
        <Film className="h-4 w-4 text-afrobrand-400" /> Storyboard:{" "}
        <span className="font-medium">{concept.title}</span>
      </div>
      <div className="mt-1 text-xs text-slate-400">
        {concept.shots.length} shots — review before rendering (renders cost
        credits).
      </div>
    </div>
  );
}

const JOB_LABEL: Record<string, string> = {
  create_beat_job: "Making the beat",
  render_demo_vocal: "Rendering your vocal",
  generate_cover_art: "Painting the cover art",
  render_video: "Rendering the video",
  create_release_kit: "Bundling the release",
  master_song: "Mastering",
  make_snippet: "Cutting the snippet",
  separate_stems: "Splitting the stems",
  make_material_beat: "Building the beat",
  assemble_beat: "Assembling the beat",
};

const JOB_DONE_LABEL: Record<string, string> = {
  create_beat_job: "Your track is ready",
  render_demo_vocal: "Vocal ready",
  generate_cover_art: "Cover art ready",
  render_video: "Video ready",
  create_release_kit: "Release bundle ready",
  master_song: "Master ready",
  make_snippet: "Snippet ready",
  separate_stems: "Stems ready",
  make_material_beat: "Your beat is ready",
  assemble_beat: "Your beat is ready",
};

type JobRow = {
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  errorJson?: { message?: string } | null;
  outputJson?: Record<string, unknown> | null;
};

/**
 * A background render, tracked honestly: one status line with REAL elapsed
 * time (no fake progress bar), a playable result card when it lands, and a
 * one-tap retry when it fails. Renders can take minutes — the poll backs off
 * (3s → 6s → 10s) and keeps watching for ~30 minutes.
 */
function JobPending({
  jobId,
  kind,
  onAction,
}: {
  jobId: string;
  kind: string;
  onAction?: (prompt: string) => void;
}) {
  const api = useApi();
  const [job, setJob] = useState<JobRow | null>(null);
  const [pollNote, setPollNote] = useState("");
  const [startedAt] = useState(() => Date.now());
  const [elapsedS, setElapsedS] = useState(0);

  const terminal =
    job?.status === "SUCCEEDED" ||
    job?.status === "FAILED" ||
    job?.status === "CANCELED";

  useEffect(() => {
    if (terminal) return;
    const timer = setInterval(
      () => setElapsedS(Math.floor((Date.now() - startedAt) / 1000)),
      1_000
    );
    return () => clearInterval(timer);
  }, [terminal, startedAt]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const delayFor = (n: number) => (n < 20 ? 3_000 : n < 50 ? 6_000 : 10_000);

    const poll = async () => {
      try {
        const next = await api.get<JobRow>(
          `/jobs/${encodeURIComponent(jobId)}`
        );
        if (!active) return;
        setJob(next);
        setPollNote("");
        if (
          next.status === "SUCCEEDED" ||
          next.status === "FAILED" ||
          next.status === "CANCELED"
        )
          return;
      } catch {
        if (!active) return;
        setPollNote("reconnecting…");
      }
      attempts += 1;
      if (active && attempts < 220)
        timer = setTimeout(() => void poll(), delayFor(attempts));
      else if (active)
        setPollNote("still running — it lands in your Catalog when done");
    };

    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [api, jobId]);

  if (job?.status === "SUCCEEDED") {
    const out = (job.outputJson ?? {}) as { masterUrl?: unknown; url?: unknown };
    const rawUrl =
      typeof out.masterUrl === "string"
        ? out.masterUrl
        : typeof out.url === "string"
          ? out.url
          : null;
    const mediaUrl = rawUrl && !/\.zip(\?|$)/i.test(rawUrl) ? rawUrl : null;
    const isImage = kind === "generate_cover_art";
    const isVideo = kind === "render_video" || kind === "make_snippet";
    return (
      <div className="text-sm">
        <div className="flex items-center gap-2 text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> {JOB_DONE_LABEL[kind] ?? "Done"}
        </div>
        {mediaUrl && isImage && (
          <img
            src={mediaUrl}
            alt="Cover art"
            className="mt-2 h-40 w-40 rounded-xl border border-slate-800 object-cover"
          />
        )}
        {mediaUrl && isVideo && (
          <video
            src={mediaUrl}
            controls
            preload="none"
            className="mt-2 max-h-64 rounded-xl border border-slate-800"
          />
        )}
        {mediaUrl && !isImage && !isVideo && (
          <audio src={mediaUrl} controls preload="none" className="mt-2 w-full" />
        )}
        <div className="mt-2 flex gap-1.5">
          <a
            href="/catalog"
            className="rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-2.5 py-0.5 text-xs text-afrobrand-300 hover:bg-afrobrand-500/20"
          >
            Open in Catalog →
          </a>
          {onAction && (
            <button
              onClick={() => onAction("Run that again — I want another take.")}
              className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs text-slate-300 hover:bg-white/10"
            >
              Another take
            </button>
          )}
        </div>
      </div>
    );
  }

  if (job?.status === "FAILED" || job?.status === "CANCELED") {
    const human =
      job.status === "CANCELED"
        ? { text: "That job was canceled.", canRetry: true, details: undefined }
        : humanizeChatError({ message: job.errorJson?.message ?? "render failed" });
    return (
      <div className="text-sm text-red-200">
        <div>{human.text}</div>
        <div className="mt-2 flex items-start gap-3">
          {onAction && (
            <button
              onClick={() => onAction("That render failed — run it again.")}
              className="flex items-center gap-1.5 rounded-full border border-red-800/60 px-3 py-1 text-xs text-red-200 hover:bg-red-900/40"
            >
              <RotateCcw className="h-3 w-3" /> Try again
            </button>
          )}
          {human.details && (
            <details className="min-w-0 text-[10px] text-red-300/50">
              <summary className="cursor-pointer select-none py-1">Details</summary>
              <div className="mt-1 whitespace-pre-wrap break-words">{human.details}</div>
            </details>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-slate-300">
      <Clock className="h-4 w-4 animate-pulse text-afrobrand-400" />
      <span>{JOB_LABEL[kind] ?? "Working"}…</span>
      <span className="text-xs tabular-nums text-slate-500">
        {formatElapsed(elapsedS)}
      </span>
      {pollNote && <span className="text-xs text-slate-600">{pollNote}</span>}
    </div>
  );
}

function ApprovedHook({ songId: _songId }: { hookId: string; songId: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-emerald-300">
      <CheckCircle2 className="h-4 w-4" /> Hook approved — song started
    </div>
  );
}

function RightsResult({
  o,
}: {
  o: { receiptId: string; check: { overallRisk: string; okToExport: boolean } };
}) {
  const ok = o.check.okToExport;
  return (
    <div
      className={`flex items-center gap-2 text-sm ${ok ? "text-emerald-300" : "text-amber-300"}`}
    >
      <ShieldCheck className="h-4 w-4" /> Rights check:{" "}
      {o.check.overallRisk.toUpperCase()} risk ·{" "}
      {ok ? "cleared to release" : "needs review"}
    </div>
  );
}

function ApprovalRequest({ gate, note }: { gate: string; note: string }) {
  return (
    <div className="text-sm text-amber-200">
      Approval requested at gate <span className="font-mono">{gate}</span>
      {note && <span className="text-slate-300"> — {note}</span>}
    </div>
  );
}

// Re-export for the chat to render image-like artifacts when we add streaming.
export { ImageIcon };
