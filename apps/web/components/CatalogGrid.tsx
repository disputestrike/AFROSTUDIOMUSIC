"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/api";
import {
  Trash2,
  Download,
  Wand2,
  FileText,
  Copy,
  Recycle,
  Pencil,
  Sliders,
  X,
  Loader2,
  Music2,
  Clapperboard,
  Layers,
  TrendingUp,
  RefreshCw,
  Mic,
  Disc3,
  Sparkles,
  GitCompare,
  ShieldCheck,
} from "lucide-react";
import dynamic from "next/dynamic";
// R-1: the bridge is an admin-only LAZY chunk — its code never loads in a
// browser without the first-party unlock (and the component itself ships zero
// vendor strings; they arrive from the admin-gated bridge-export endpoint).
const FlagshipBridge = dynamic(
  () => import("./FlagshipBridge").then(m => m.FlagshipBridge),
  { ssr: false }
);
import { SongChat } from "./SongChat";

interface HitPrediction {
  hitScore: number;
  viralScore: number;
  verdict: string;
  strengths: string[];
  risks: string[];
  toMakeItBigger: string[];
  comparableLane: string;
  tiktokMoment: string | null;
}

/** The newest master's measured report card — every number MEASURED by the
 *  worker at render/re-certification time and served verbatim by the API
 *  (masterReportSummary in routes/songs.ts). Absent = that master carries no
 *  persisted report; nothing is recomputed or invented client-side. */
export interface MasterReportRow {
  preset?: string | null;
  measuredAt?: string | null;
  lufs?: number | null;
  dBTP?: number | null;
  lra?: number | null;
  crest?: number | null;
  tiltDbPerOct?: number | null;
  correlation?: number | null;
  drivePasses?: Array<{
    pass?: number;
    stage?: string;
    driveDb?: number;
    reason?: string;
    measured?: { lufs?: number; truePeakDb?: number; lra?: number } | null;
  }> | null;
  appliedMatchEq?: {
    bandsDb?: number[];
    clampDb?: number;
    referenceGenre?: string;
  } | null;
  referenceDelta?: {
    genre?: string;
    delta?: Record<string, number | number[]>;
  } | null;
}

export interface SongRow {
  id: string;
  title: string;
  versionLabel?: string | null;
  status: string;
  artist: string;
  projectId: string;
  projectTitle: string;
  genre: string;
  bpm: number | null;
  audioUrl: string | null;
  currentAudio?: { certification?: { certified?: boolean } } | null;
  masterReport?: MasterReportRow | null;
  masterUrl?: string | null;
  mixUrl?: string | null;
  beatUrl?: string | null;
  beatId?: string | null;
  stemCount?: number;
  hasLyrics?: boolean;
  releaseReady?: boolean;
  hitScore?: number | null;
  viralScore?: number | null;
  coverUrl: string | null;
  createdAt: string;
  // NEVER-LOSE REPOSITORY: soft-deleted and quarantined rows surface in the
  // "Show ALL songs" view flagged with their reason — recoverable, never
  // silently vanished (Restore / Un-quarantine hang off these).
  deleted?: boolean;
  deletedReason?: string | null;
  quarantined?: boolean;
  quarantineReason?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  SKETCH: "Sketch",
  DEMO: "Demo",
  FULL: "Full",
  MIXED: "Mixed",
  MASTERED: "Mastered",
  RELEASED: "Released",
};

/**
 * When the song was made — date AND time, on every song, always.
 * Song.createdAt has always been stored and returned by the API; the catalog
 * simply never rendered it.
 *
 * Rendered in the VIEWER's own timezone, because "when did I make this" only
 * means anything in the time the artist was actually living in. That makes the
 * string differ between the server (UTC) and the browser, and these cards are
 * server-rendered from `initial` — so every element printing one carries
 * suppressHydrationWarning. That attribute is correct here rather than a
 * workaround: the mismatch is intended and one-level-deep (text only).
 */
function madeAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Render a measured number or nothing — an unmeasured axis simply doesn't
 *  print (honesty law: no dashes pretending to be data). */
function measuredNum(n: number | null | undefined, digits = 1): string | null {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : null;
}

/** The clean one-line stat row of the master report — measured axes only. */
function masterReportLine(r: MasterReportRow): string {
  const parts: string[] = [];
  const lufs = measuredNum(r.lufs);
  const tp = measuredNum(r.dBTP);
  const lra = measuredNum(r.lra);
  const tilt = measuredNum(r.tiltDbPerOct);
  const corr = measuredNum(r.correlation, 2);
  if (lufs) parts.push(`Loudness ${lufs} LUFS`);
  if (tp) parts.push(`True peak ${tp} dB`);
  if (lra) parts.push(`Dynamics LRA ${lra}`);
  if (tilt) parts.push(`Tilt ${tilt} dB/oct`);
  if (corr) parts.push(`Stereo ${corr}`);
  return parts.join(" · ");
}

/**
 * One honest verdict line. Thresholds (all measured against commercial Afro
 * chart masters — the same law the mastering chain targets):
 *   - integrated loudness: -11..-8 LUFS is the commercial window (the -9
 *     preset's home); quieter loses every A/B, hotter risks crush.
 *   - LRA: commercial Afro sits ~6-8; > 8.5 reads as more dynamic than
 *     commercial (the chain's own density ceiling), < 3 as very dense.
 *   - true peak: above -0.8 dBTP risks clipping on lossy transcode (chain
 *     targets -1.0).
 *   - stereo correlation: < 0.5 warns of phase loss when clubs fold to mono.
 * No loudness measurement → no verdict claimed.
 */
function masterReportVerdict(r: MasterReportRow): string {
  const lufs = typeof r.lufs === "number" && Number.isFinite(r.lufs) ? r.lufs : null;
  if (lufs === null) return "Loudness unmeasured — no verdict claimed.";
  let verdict =
    lufs > -8
      ? "Hotter than commercial Afro loudness"
      : lufs < -11
        ? "Quieter than commercial Afro loudness"
        : "Within commercial Afro loudness range";
  const lra = typeof r.lra === "number" && Number.isFinite(r.lra) ? r.lra : null;
  if (lra !== null && lra > 8.5) verdict += " · more dynamic than commercial (LRA > 8.5)";
  else if (lra !== null && lra < 3) verdict += " · very dense (LRA < 3)";
  const tp = typeof r.dBTP === "number" && Number.isFinite(r.dBTP) ? r.dBTP : null;
  if (tp !== null && tp > -0.8) verdict += " · true peak may clip on lossy transcode";
  const corr = typeof r.correlation === "number" && Number.isFinite(r.correlation) ? r.correlation : null;
  if (corr !== null && corr < 0.5) verdict += " · stereo phase risk on mono systems";
  return verdict;
}

/** Compact 'vs reference' line — rendered ONLY when the render carried a real
 *  measured reference delta (rights-cleared lane references on file). */
function masterReferenceLine(r: MasterReportRow): string | null {
  const delta = r.referenceDelta?.delta;
  if (!delta || !r.referenceDelta?.genre) return null;
  const label: Record<string, string> = {
    lufs: "LUFS",
    truePeakDb: "dBTP",
    loudnessRangeLra: "LRA",
    crestFactorDb: "crest dB",
    spectralTiltDbPerOct: "tilt dB/oct",
    stereoCorrelation: "stereo",
  };
  const parts: string[] = [];
  for (const [key, name] of Object.entries(label)) {
    const v = delta[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      parts.push(`${v >= 0 ? "+" : ""}${v.toFixed(key === "stereoCorrelation" ? 2 : 1)} ${name}`);
    }
  }
  if (!parts.length) return null;
  return `vs ${r.referenceDelta.genre.replace(/_/g, " ")} reference: ${parts.join(" · ")}`;
}

// STUDIO TRUTH — the per-song proof pack from GET /songs/:id/proof. Everything
// in it is STORED fact (the API never recomputes or invents), and engines
// arrive as CLASSES only — no vendor name ever reaches this component (§1.11).
interface ProofPack {
  request?: {
    note?: string;
    selectedGenre?: string | null;
    effectiveGenre?: string | null;
    fusionGenres?: string[];
    mood?: string | null;
    languages?: string[];
    voice?: string | null;
    engineRequested?: string | null;
    promptStyleTags?: string[];
    vibePrompt?: string | null;
  };
  training?: {
    usedReferenceIds?: string[];
    measuredCount?: number;
    totalCount?: number;
    pinnedReferenceId?: string | null;
    note?: string;
  };
  materials?: {
    usedMaterialIds?: Array<string | null>;
    roles?: Array<string | null>;
    note?: string;
  };
  render?: {
    note?: string;
    engineClass?: string;
    takesTried?: number;
    takesRendered?: number;
    rankedBy?: string;
    earRead?: string;
    repairApplied?: string;
    qc?: { verdict?: string; integratedLufs?: number | null } | null;
  };
  lane?: {
    score?: number | null;
    coverage?: number | null;
    drift?: string | null;
    failedCritical?: string[];
    judgedAgainst?: string;
    note?: string;
  };
  ar?: {
    hitScore?: number | null;
    viralScore?: number | null;
    willBlow?: boolean | null;
    note?: string;
  };
  master?: {
    note?: string;
    preset?: string;
    measuredLufs?: number | null;
    qcVerdict?: string;
  };
  failures?: { count?: number; lastError?: string | null; note?: string };
  whyThisWon?: string;
}

type DownloadFile = { label: string; url: string; kind: string; dl?: string };
type LyricVer = {
  body: string;
  title: string | null;
  at: string;
  label?: string;
};
/** A song's recommended video treatment — shot list as the API stores it. */
type VideoShot = {
  index: number;
  prompt: string;
  duration_s: number;
  motion?: string;
  lighting?: string;
  subjects?: string[];
};
type VideoConceptRow = {
  id: string;
  title: string;
  storyboard: VideoShot[];
  durationS: number;
  format: string;
  createdAt: string;
};
interface VersionsResp {
  songId: string;
  versionLabel: string | null;
  hasBigger: boolean;
  audioVersions: Array<{
    index: number;
    label: string;
    url: string;
    at: string;
    isCurrent?: boolean;
    dl?: string;
    canRevert?: boolean;
    // Per-take certification truth from the server — an uncertified (pre-
    // certification-era) take shows an 'unverified' tag instead of hiding or
    // 409ing; certification gates RELEASE, not catalog reverts.
    certification?: { certified?: boolean; status?: string };
  }>;
  lyricVersions: Array<{
    label: string;
    title: string | null;
    body: string;
    at: string | null;
  }>;
}

export default function CatalogGrid({ initial }: { initial: SongRow[] }) {
  const [chatFor, setChatFor] = useState<string | null>(null);
  const api = useApi();
  const router = useRouter();
  const [songs, setSongs] = useState<SongRow[]>(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string>(""); // `${id}:${action}`
  const [toast, setToast] = useState<string>("");
  const [editing, setEditing] = useState<{
    id: string;
    lyricId?: string;
    title: string;
    body: string;
    versions?: LyricVer[];
  } | null>(null);
  // Keyed by songId so a treatment can never be shown against the wrong song —
  // the same discipline the lyrics themselves now follow server-side.
  const [videoOpen, setVideoOpen] = useState<SongRow | null>(null);
  const [makingVideo, setMakingVideo] = useState(false);
  const [videoConcept, setVideoConcept] = useState<{
    songId: string;
    state: "loading" | "ready";
    concept?: VideoConceptRow | null;
  } | null>(null);
  const [downloads, setDownloads] = useState<{
    id: string;
    files: DownloadFile[];
  } | null>(null);
  const [hit, setHit] = useState<{ title: string; p: HitPrediction } | null>(
    null
  );
  const [bridge, setBridge] = useState<{
    songId: string;
    projectId: string;
  } | null>(null);
  // Server-authorized operator sessions reveal the internal bridge tooling.
  const [firstParty, setFirstParty] = useState(false);
  useEffect(() => {
    void api
      .get<{ admin: boolean }>("/admin/status")
      .then(result => setFirstParty(result.admin))
      .catch(() => setFirstParty(false));
  }, [api]);
  const [compare, setCompare] = useState<{
    title: string;
    loading: boolean;
    data?: VersionsResp;
  } | null>(null);
  // NOTHING IS LOST: the default list hides old lyric-only shells (failed /
  // never-ran renders). This toggle fetches EVERYTHING (?all=1) — including
  // soft-deleted and quarantined songs, flagged — so "lost versions" are
  // always findable and RECOVERABLE (restore / un-quarantine) from here.
  const [showingAll, setShowingAll] = useState(false);
  const toggleShowAll = async () => {
    try {
      const next = !showingAll;
      const rows = await api.get<SongRow[]>(next ? "/songs?all=1" : "/songs");
      setSongs(rows);
      setShowingAll(next);
    } catch {
      flash("Could not load the full list");
    }
  };
  // Re-pull the CURRENT view — recovery actions change which rows belong in it.
  const refreshList = async () => {
    try {
      setSongs(await api.get<SongRow[]>(showingAll ? "/songs?all=1" : "/songs"));
    } catch {
      router.refresh();
    }
  };

  // NEVER-LOSE RECOVERY — the client half the server has been waiting for:
  // DELETE stamps deletedAt and POST /:id/restore clears it, but nothing in the
  // web ever called restore, so "recoverable" was a claim with no button.
  async function restore(s: SongRow) {
    setBusy(`${s.id}:restore`);
    try {
      await api.post(`/songs/${s.id}/restore`, {});
      flash("Restored — the song is back in the catalog.");
      await refreshList();
    } catch (e) {
      flash((e as Error).message || "Restore failed");
    } finally {
      setBusy("");
    }
  }

  // Quarantine is reversible by design (PATCH /songs/:id carries the toggle);
  // auto-quarantined songs used to vanish from EVERY view with no way back.
  async function unquarantine(s: SongRow) {
    setBusy(`${s.id}:unquarantine`);
    try {
      await api.patch(`/songs/${s.id}`, {
        quarantined: false,
        quarantineReason: null,
      });
      flash("Quarantine lifted — the song is visible again.");
      await refreshList();
    } catch (e) {
      flash((e as Error).message || "Could not lift quarantine");
    } finally {
      setBusy("");
    }
  }

  // ---- PLAYER QUALITY-OF-LIFE (owner-requested, 2026-07-16) ----
  // Loop per card = the native audio `loop` attribute, nothing clever.
  const [looping, setLooping] = useState<Record<string, boolean>>({});
  // MASTER REPORT expander — per-card, only rendered when the newest master
  // carries a persisted measured report (server decides; see SongRow).
  const [reportOpen, setReportOpen] = useState<Record<string, boolean>>({});
  // PLAY ALL — the visible songs in card order, advanced on 'ended'. The
  // app-wide AudioSolo listener already enforces one-audio-at-a-time, so
  // starting the next element IS the discipline; no new deps, no new player.
  // A ref mirror avoids acting on stale state from inside media callbacks.
  const audioEls = useRef<Map<string, HTMLAudioElement>>(new Map());
  const playAllRef = useRef<{ ids: string[]; idx: number } | null>(null);
  const [playAll, setPlayAllState] = useState<{ ids: string[]; idx: number } | null>(null);
  const setPlayAll = (v: { ids: string[]; idx: number } | null) => {
    playAllRef.current = v;
    setPlayAllState(v);
  };
  const playAt = (ids: string[], idx: number) => {
    const el = audioEls.current.get(ids[idx]!);
    if (!el) {
      skipTo(ids, idx + 1); // card unmounted/filtered — skip, never stall
      return;
    }
    try {
      el.currentTime = 0;
    } catch {
      /* metadata not loaded yet — play() below still starts from 0 */
    }
    void el.play().catch(() => skipTo(ids, idx + 1));
  };
  const skipTo = (ids: string[], idx: number) => {
    if (idx >= ids.length) {
      setPlayAll(null);
      flash("Played the whole view.");
      return;
    }
    setPlayAll({ ids, idx });
    playAt(ids, idx);
  };
  const startPlayAll = () => {
    const ids = songs.filter(x => x.audioUrl).map(x => x.id);
    if (!ids.length) {
      flash("Nothing playable in this view yet.");
      return;
    }
    setPlayAll({ ids, idx: 0 });
    playAt(ids, 0);
  };
  const stopPlayAll = () => {
    const cur = playAllRef.current;
    if (cur) audioEls.current.get(cur.ids[cur.idx]!)?.pause();
    setPlayAll(null);
  };
  const onCardEnded = (songId: string) => {
    const cur = playAllRef.current;
    if (!cur || cur.ids[cur.idx] !== songId) return; // not our queue's track
    skipTo(cur.ids, cur.idx + 1);
  };

  async function openCompare(s: SongRow) {
    setCompare({ title: s.title, loading: true });
    try {
      const data = await api.get<VersionsResp>(`/songs/${s.id}/versions`);
      setCompare({ title: s.title, loading: false, data });
    } catch (e) {
      flash((e as Error).message || "Could not load versions");
      setCompare(null);
    }
  }

  // TRUTH REPORT — prove what shaped this song (request, training references,
  // shelf materials, ranking, failures) from stored facts, on demand for ANY
  // song. The API speaks engine classes only; so does everything rendered here.
  const [truth, setTruth] = useState<{
    title: string;
    loading: boolean;
    proof?: ProofPack;
    persisted?: boolean;
  } | null>(null);
  async function openTruth(s: SongRow) {
    setTruth({ title: s.title, loading: true });
    try {
      const r = await api.get<{ proof: ProofPack; persisted?: boolean }>(
        `/songs/${s.id}/proof`
      );
      setTruth({
        title: s.title,
        loading: false,
        proof: r.proof,
        persisted: r.persisted,
      });
    } catch (e) {
      flash((e as Error).message || "Could not load the truth report");
      setTruth(null);
    }
  }

  // Make ANY prior take the current version, then refresh the modal + the card audio.
  async function revertAudio(index: number) {
    const data = compare?.data;
    if (!data) return;
    setBusy(`${data.songId}:revert${index}`);
    try {
      await api.post(`/songs/${data.songId}/versions/revert`, { index });
      flash("Reverted — that take is now the current version.");
      const fresh = await api.get<VersionsResp>(
        `/songs/${data.songId}/versions`
      );
      setCompare(c => (c ? { ...c, data: fresh } : c));
      router.refresh(); // update the catalog card's current audio
    } catch (e) {
      flash((e as Error).message || "Revert failed");
    } finally {
      setBusy("");
    }
  }

  // Kick off a Demucs instrumental for a SPECIFIC take (downloadable when it finishes).
  async function versionInstrumental(index: number) {
    const data = compare?.data;
    if (!data) return;
    setBusy(`${data.songId}:inst${index}`);
    try {
      await api.post(`/songs/${data.songId}/versions/instrumental`, { index });
      flash(
        "Instrumental is separating — it’ll be downloadable from Download in a few minutes."
      );
    } catch (e) {
      flash((e as Error).message || "Could not start instrumental");
    } finally {
      setBusy("");
    }
  }

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 3500);
  };
  const isBusy = (id: string, a: string) => busy === `${id}:${a}`;

  // Inline two-step confirm — native confirm() can be silently suppressed by
  // the browser ("prevent additional dialogs"), which made Delete LOOK broken.
  const [armedDelete, setArmedDelete] = useState("");
  async function remove(id: string) {
    if (armedDelete !== id) {
      setArmedDelete(id);
      setTimeout(() => setArmedDelete(cur => (cur === id ? "" : cur)), 4000);
      return;
    }
    setArmedDelete("");
    const before = songs;
    setSongs(s => s.filter(x => x.id !== id));
    try {
      await api.del(`/songs/${id}`);
      flash("Deleted — recoverable anytime from “Show ALL songs”.");
      // In the repository view the row should REAPPEAR flagged deleted (with
      // its Restore button), not vanish like a hard delete.
      if (showingAll) await refreshList();
    } catch (e) {
      // NEVER pretend: if the server refused, put the song back and say so —
      // a silently-failed delete is exactly the "it always comes back" bug.
      setSongs(before);
      flash(`Couldn’t delete: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  async function remaster(s: SongRow) {
    setBusy(`${s.id}:master`);
    try {
      await api.post(`/songs/${s.id}/master`, { preset: "afro_stream_-9" });
      flash("Re-master queued — refresh in ~1 min for the new master.");
    } catch (e) {
      flash((e as Error).message || "Master failed");
    } finally {
      setBusy("");
    }
  }

  async function makeItBigger(s: SongRow) {
    setBusy(`${s.id}:bigger`);
    try {
      const res = await api.post<{ whatChanged: string[]; jobId?: string }>(
        `/songs/${s.id}/make-it-bigger`,
        {}
      );
      // The old score no longer describes this song — clear it locally too
      // (the gate re-scores automatically once the new render lands).
      setSongs(prev =>
        prev.map(x =>
          x.id === s.id
            ? {
                ...x,
                hitScore: null,
                viralScore: null,
                versionLabel: "bigger (A&R notes applied)",
              }
            : x
        )
      );
      flash(
        `A&R notes implemented — re-singing the bigger version. Changed: ${(res.whatChanged ?? []).slice(0, 2).join("; ") || "see lyrics"}`
      );
      // FOLLOW THE RENDER — the silent gap that ate takes during the credit
      // drought: the sync rewrite succeeded, the downstream re-sing died, and
      // nobody was told. Now the button watches its own job to the end.
      if (res.jobId) {
        void (async () => {
          for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 5000));
            try {
              const j = await api.get<{
                status: string;
                errorJson?: { message?: string } | null;
              }>(`/jobs/${res.jobId}`);
              if (j.status === "SUCCEEDED") {
                flash(
                  `Bigger version LANDED for “${s.title}” — compare it in Versions.`
                );
                return;
              }
              if (j.status === "FAILED") {
                flash(
                  `Bigger re-sing FAILED for “${s.title}” — ${j.errorJson?.message ?? "no reason recorded"}.`
                );
                return;
              }
            } catch {
              /* blip */
            }
          }
        })();
      }
    } catch (e) {
      flash((e as Error).message || "Make-it-bigger failed");
    } finally {
      setBusy("");
    }
  }

  async function reuseBeat(s: SongRow) {
    setBusy(`${s.id}:reuse`);
    try {
      const r = await api.post<{ projectId: string; message?: string }>(
        `/songs/${s.id}/reuse-beat`,
        {}
      );
      flash(r.message || "Beat reused in a new song. Opening the studio…");
      setTimeout(() => router.push(`/projects/${r.projectId}`), 1400);
    } catch (e) {
      flash((e as Error).message || "Reuse failed");
    } finally {
      setBusy("");
    }
  }

  // Reuse ONLY the lyrics into a fresh song (write a new beat under them).
  async function reuseLyrics(s: SongRow) {
    setBusy(`${s.id}:reuselyrics`);
    try {
      const r = await api.post<{ projectId: string; message?: string }>(
        `/songs/${s.id}/reuse-lyrics`,
        {}
      );
      flash(r.message || "Lyrics reused in a new song. Opening the studio…");
      setTimeout(() => router.push(`/projects/${r.projectId}`), 1400);
    } catch (e) {
      flash((e as Error).message || "Reuse lyrics failed");
    } finally {
      setBusy("");
    }
  }

  // Reuse ONLY the clean instrumental — SEAMLESSLY. If the stems don't exist
  // yet, this orchestrates the whole chain itself: separate → wait → reuse.
  // The user clicks once; the studio does the work and narrates it.
  async function reuseInstrumental(s: SongRow) {
    setBusy(`${s.id}:reuseinst`);
    try {
      try {
        const r = await api.post<{ projectId: string; message?: string }>(
          `/songs/${s.id}/reuse-instrumental`,
          {}
        );
        flash(
          r.message || "Instrumental reused in a new song. Opening the studio…"
        );
        setTimeout(() => router.push(`/projects/${r.projectId}`), 1400);
        return;
      } catch (e) {
        if (!/no_instrumental_stem/.test((e as Error).message)) throw e;
      }
      // No clean instrumental yet — make one first, then finish the job.
      flash(
        "No clean instrumental yet — separating the vocals now (a few minutes)…"
      );
      const sep = await api.post<{ jobId: string }>(`/songs/${s.id}/stems`, {
        mode: "instrumental",
      });
      for (let i = 0; i < 36; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const j = await api.get<{ status: string }>(`/jobs/${sep.jobId}`);
        if (j.status === "SUCCEEDED") break;
        if (j.status === "FAILED")
          throw new Error("Separation failed — try again in a moment.");
        if (i === 35)
          throw new Error(
            "Separation is taking long — it will finish in the background; try Reuse instrumental again shortly."
          );
      }
      const r2 = await api.post<{ projectId: string; message?: string }>(
        `/songs/${s.id}/reuse-instrumental`,
        {}
      );
      flash(
        r2.message ||
          "Clean instrumental extracted + reused in a new song. Opening the studio…"
      );
      setTimeout(() => router.push(`/projects/${r2.projectId}`), 1400);
    } catch (e) {
      flash((e as Error).message.slice(0, 140));
    } finally {
      setBusy("");
    }
  }

  // Start an ALBUM anchored to this song's sound — every next track holds it.
  async function startAlbum(s: SongRow) {
    setBusy(`${s.id}:album`);
    try {
      const a = await api.post<{ id: string; title: string }>("/albums", {
        anchorSongId: s.id,
      });
      flash(`Album started: “${a.title}”. Opening Albums…`);
      setTimeout(() => router.push("/albums"), 1200);
    } catch (e) {
      flash((e as Error).message.slice(0, 140));
    } finally {
      setBusy("");
    }
  }

  // Re-sing the song with its CURRENT (edited) lyrics — surgical edit → new take.
  async function resing(s: SongRow) {
    setBusy(`${s.id}:resing`);
    try {
      await api.post(`/songs/${s.id}/regenerate-beat`, {});
      flash(
        "Re-singing with the current lyrics — refresh in ~1–2 min for the new version."
      );
    } catch (e) {
      flash((e as Error).message || "Re-sing failed");
    } finally {
      setBusy("");
    }
  }

  async function duplicate(s: SongRow) {
    setBusy(`${s.id}:dup`);
    try {
      await api.post(`/songs/${s.id}/duplicate`, {});
      flash("Duplicated. Refresh to see the copy.");
    } catch (e) {
      flash((e as Error).message || "Duplicate failed");
    } finally {
      setBusy("");
    }
  }

  async function willItHit(s: SongRow) {
    setBusy(`${s.id}:hit`);
    try {
      const p = await api.post<HitPrediction>(`/songs/${s.id}/hit-score`, {});
      setHit({ title: s.title, p });
    } catch (e) {
      flash((e as Error).message || "A&R scout unavailable");
    } finally {
      setBusy("");
    }
  }

  async function separate(s: SongRow, mode: "instrumental" | "full") {
    setBusy(`${s.id}:${mode}`);
    try {
      await api.post(`/songs/${s.id}/stems`, { mode });
      flash(
        mode === "instrumental"
          ? "Making the instrumental — the full song minus the voice. It’ll appear in Download in a few minutes."
          : "Separating stems — they’ll appear in Download in a few minutes."
      );
    } catch (e) {
      flash((e as Error).message || "Separation failed");
    } finally {
      setBusy("");
    }
  }

  async function rename(s: SongRow) {
    const title = prompt("Rename song", s.title);
    if (!title || title === s.title) return;
    setSongs(arr => arr.map(x => (x.id === s.id ? { ...x, title } : x)));
    try {
      await api.patch(`/songs/${s.id}`, { title });
    } catch (e) {
      flash((e as Error).message || "Rename failed");
    }
  }

  /**
   * The song's recommended VIDEO TREATMENT — the piece that sits beside its
   * lyrics. Fetched per song and keyed to `editing.id`, exactly like the lyrics
   * themselves, so switching songs can never leave another song's treatment on
   * screen. Deliberately non-blocking: a song with no concept yet is a normal
   * state, not an error, so a failure here never stops the lyrics opening.
   */
  /** Write the video plan for a song ON DEMAND — cheap text generation from
   *  the song's own words; never touches a video-render credit. Legacy songs
   *  predate per-song treatments entirely, so this is how they get theirs. */
  async function makeVideoPlan(s: SongRow) {
    setMakingVideo(true);
    try {
      await api.post(`/videos/storyboards`, { projectId: s.projectId, songId: s.id });
      // POST creates a NEW concept row and GET returns the newest — a rewrite
      // therefore replaces what the modal shows without deleting anything.
      await loadVideoConcept(s.id);
    } catch (e) {
      // A failed (re)write must not blank an EXISTING plan off the screen —
      // reload whatever the server still has and say what went wrong.
      flash((e as Error).message?.slice(0, 140) || "Could not write the video plan");
      await loadVideoConcept(s.id);
    } finally {
      setMakingVideo(false);
    }
  }

  async function loadVideoConcept(songId: string) {
    setVideoConcept({ songId, state: "loading" });
    try {
      const r = await api.get<{ concept: VideoConceptRow | null }>(
        `/songs/${songId}/video-concept`
      );
      setVideoConcept({ songId, state: "ready", concept: r.concept });
    } catch {
      setVideoConcept({ songId, state: "ready", concept: null });
    }
  }

  async function openLyrics(s: SongRow) {
    setBusy(`${s.id}:lyrics`);
    try {
      const r = await api.get<{
        lyric: {
          id: string;
          title?: string;
          body: string;
          versions?: LyricVer[];
        } | null;
      }>(`/songs/${s.id}/lyrics`);
      setEditing({
        id: s.id,
        lyricId: r.lyric?.id,
        title: r.lyric?.title ?? s.title,
        body: r.lyric?.body ?? "",
        versions: r.lyric?.versions ?? [],
      });
      void loadVideoConcept(s.id);
    } catch (e) {
      flash((e as Error).message || "Could not load lyrics");
    } finally {
      setBusy("");
    }
  }

  // Revert the lyric to a saved prior take — the original is never lost.
  async function revertLyric(index: number) {
    if (!editing) return;
    setBusy(`${editing.id}:revert`);
    try {
      const r = await api.post<{
        lyric: { title?: string; body: string; versions?: LyricVer[] };
        needsRegeneration?: boolean;
        revertedTo?: string;
      }>(`/songs/${editing.id}/lyrics/revert`, { index });
      setEditing({
        ...editing,
        title: r.lyric.title ?? editing.title,
        body: r.lyric.body,
        versions: r.lyric.versions ?? [],
      });
      flash(
        `Reverted to ${r.revertedTo ?? "that take"}.${r.needsRegeneration ? " Use “Re-sing” to hear it." : ""}`
      );
    } catch (e) {
      flash((e as Error).message || "Revert failed");
    } finally {
      setBusy("");
    }
  }

  async function saveLyrics(andResing = false) {
    if (!editing) return;
    const id = editing.id;
    setBusy(`${id}:savelyrics`);
    try {
      const r = await api.patch<{ needsRegeneration?: boolean }>(
        `/songs/${id}/lyrics`,
        { title: editing.title, body: editing.body }
      );
      setEditing(null);
      if (andResing) {
        flash("Lyrics saved — re-singing the song now…");
        await api.post(`/songs/${id}/regenerate-beat`, {});
        flash(
          "Re-singing with your edits — refresh in ~1–2 min for the new version."
        );
      } else {
        flash(
          r.needsRegeneration
            ? "Lyrics saved. Use “Re-sing” to hear the new version."
            : "Lyrics saved."
        );
      }
    } catch (e) {
      flash((e as Error).message || "Save failed");
    } finally {
      setBusy("");
    }
  }

  async function openDownloads(s: SongRow) {
    setBusy(`${s.id}:dl`);
    try {
      const r = await api.get<{ files: DownloadFile[] }>(
        `/songs/${s.id}/download`
      );
      setDownloads({ id: s.id, files: r.files ?? [] });
    } catch (e) {
      flash((e as Error).message || "Could not load files");
    } finally {
      setBusy("");
    }
  }

  if (songs.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">
        {showingAll
          ? "Nothing here at all — not even hidden songs."
          : "No songs yet. Head to "}
        {!showingAll && <span className="text-afrobrand-400">Create</span>}
        {!showingAll && " and make one."}
        <div className="mt-4">
          <button
            onClick={() => void toggleShowAll()}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
          >
            {showingAll
              ? "Back to normal view"
              : "🔎 Check for hidden/failed songs"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8">
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-white/10 px-4 py-2 text-sm text-white backdrop-blur">
          {toast}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-2">
        {/* PLAY ALL (owner-requested): the visible songs, in order, one after
            the other — the AudioSolo listener keeps it one-at-a-time. */}
        <button
          onClick={() => (playAll ? stopPlayAll() : startPlayAll())}
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
        >
          {playAll ? "⏹ Stop play all" : "▶ Play all"}
        </button>
        <button
          onClick={() => void toggleShowAll()}
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
        >
          {showingAll
            ? "Hide incomplete songs"
            : "🔎 Show ALL songs (recover hidden/failed)"}
        </button>
      </div>

      {/* Now-playing bar for Play all — enough to see where you are, skip, stop. */}
      {playAll && (
        <div className="fixed bottom-4 left-1/2 z-40 flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-slate-900/95 px-4 py-2 text-xs shadow-xl backdrop-blur">
          <span className="shrink-0 text-slate-500">
            {playAll.idx + 1}/{playAll.ids.length}
          </span>
          <span className="truncate text-slate-200">
            {songs.find(x => x.id === playAll.ids[playAll.idx])?.title ?? "…"}
          </span>
          <button
            onClick={() => skipTo(playAll.ids, playAll.idx + 1)}
            className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-slate-300 hover:bg-white/10"
          >
            ⏭ Next
          </button>
          <button
            onClick={stopPlayAll}
            className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-slate-300 hover:bg-white/10"
          >
            ⏹ Stop
          </button>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {songs.map(s => (
          <div
            key={s.id}
            className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40"
          >
            <button
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                setChatFor(chatFor === s.id ? null : s.id);
              }}
              title="Talk to this song"
              className="absolute left-2 top-2 z-10 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg"
            >
              💬 Talk
            </button>
            <div className="aspect-square w-full bg-slate-800">
              {s.coverUrl ? (
                <img
                  src={s.coverUrl}
                  alt={s.title}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center font-display text-5xl text-slate-700">
                  ♪
                </div>
              )}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="font-display text-lg leading-tight">
                  {s.title}
                  {s.versionLabel ? (
                    <span className="ml-1 text-xs text-slate-500">
                      · {s.versionLabel}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  {/* Recovery truth: a deleted/quarantined row SAYS so (the
                      reason rides the tooltip) instead of vanishing. */}
                  {s.deleted && (
                    <span
                      title={s.deletedReason || "Soft-deleted — everything kept; Restore brings it back whole"}
                      className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-300"
                    >
                      Deleted
                    </span>
                  )}
                  {s.quarantined && (
                    <span
                      title={s.quarantineReason || "Quarantined by QA — reversible"}
                      className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-300"
                    >
                      Quarantined
                    </span>
                  )}
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                </div>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {s.artist} · {s.genre.replace("_", " ")}
                {s.bpm ? ` · ${s.bpm} bpm` : ""}
                {s.stemCount ? ` · ${s.stemCount} stems` : ""}
              </div>
              {/* Every song carries the date AND time it was made. */}
              {madeAt(s.createdAt) ? (
                <div
                  className="mt-1 text-[11px] text-slate-500"
                  suppressHydrationWarning
                  title={`Created ${new Date(s.createdAt).toISOString()}`}
                >
                  Made {madeAt(s.createdAt)}
                </div>
              ) : null}
              {s.audioUrl ? (
                <>
                  <audio
                    controls
                    preload="none"
                    loop={!!looping[s.id]}
                    ref={el => {
                      if (el) audioEls.current.set(s.id, el);
                      else audioEls.current.delete(s.id);
                    }}
                    onEnded={() => onCardEnded(s.id)}
                    className="mt-3 w-full"
                    src={s.audioUrl}
                  />
                  <div className="mt-1 flex items-center justify-between gap-2">
                    {/* Loop = the native attribute; the button just flips it. */}
                    <button
                      onClick={() =>
                        setLooping(cur => ({ ...cur, [s.id]: !cur[s.id] }))
                      }
                      title={looping[s.id] ? "Looping — click to play once" : "Loop this song"}
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${looping[s.id] ? "border-afrobrand-500/50 bg-afrobrand-500/15 text-afrobrand-300" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"}`}
                    >
                      🔁 {looping[s.id] ? "Looping" : "Loop"}
                    </button>
                    {/* HONESTY TAG: pre-certification-era renders play fine but
                        haven't been hash-verified; say so instead of hiding
                        them. Re-master (user-triggered) is what verifies. */}
                    {s.currentAudio && s.currentAudio.certification?.certified === false ? (
                      <div className="text-[10px] text-slate-500">
                        Legacy render — plays fine; Re-master verifies it.
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="mt-3 text-xs text-slate-600">
                  No audio rendered yet.
                </div>
              )}

              {/* MASTER REPORT CARD — the measured verdict of the newest
                  master (worker-persisted, served verbatim). Rendered only
                  when a report exists; every line is measurement, the verdict
                  thresholds live in masterReportVerdict above. */}
              {s.masterReport && (
                <div className="mt-2">
                  <button
                    onClick={() =>
                      setReportOpen(cur => ({ ...cur, [s.id]: !cur[s.id] }))
                    }
                    title="Measured loudness, dynamics, tilt and stereo health of the newest master"
                    className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400 hover:bg-white/10"
                  >
                    📊 Master report {reportOpen[s.id] ? "▴" : "▾"}
                  </button>
                  {reportOpen[s.id] && (
                    <div className="mt-1.5 space-y-1 rounded-lg border border-white/10 bg-black/20 p-2 text-[11px] leading-relaxed text-slate-400">
                      {masterReportLine(s.masterReport) ? (
                        <div>{masterReportLine(s.masterReport)}</div>
                      ) : null}
                      <div className="text-slate-300">
                        {masterReportVerdict(s.masterReport)}
                      </div>
                      {/* Density iteration — shown only when the chain earned
                          its single extra gentle pass. */}
                      {(() => {
                        const density = (s.masterReport.drivePasses ?? []).find(
                          p => p?.stage === "density" && (p.driveDb ?? 0) > 0
                        );
                        if (!density) return null;
                        const after = measuredNum(density.measured?.lra);
                        return (
                          <div className="text-slate-500">
                            Density: one extra gentle drive pass +
                            {(density.driveDb ?? 0).toFixed(1)} dB
                            {after ? ` → LRA ${after}` : ""}
                          </div>
                        );
                      })()}
                      {/* Match-EQ — only when a rights-cleared reference vector
                          actually shaped this render. */}
                      {s.masterReport.appliedMatchEq?.bandsDb ? (
                        <div className="text-slate-500">
                          Match-EQ: ±
                          {s.masterReport.appliedMatchEq.clampDb ?? 3} dB-clamped
                          correction toward the{" "}
                          {(s.masterReport.appliedMatchEq.referenceGenre ?? s.genre).replace(/_/g, " ")}{" "}
                          reference (
                          {s.masterReport.appliedMatchEq.bandsDb.filter(b => b !== 0).length}{" "}
                          bands)
                        </div>
                      ) : null}
                      {/* vs reference — deltas print ONLY when a reference
                          exists; absence is stated by absence. */}
                      {masterReferenceLine(s.masterReport) ? (
                        <div className="text-slate-500">
                          {masterReferenceLine(s.masterReport)}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              {/* Action bar — the workstation */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {/* Recovery actions lead when the row needs recovering. */}
                {s.deleted && (
                  <Action
                    label="♻ Restore"
                    busy={isBusy(s.id, "restore")}
                    onClick={() => void restore(s)}
                  />
                )}
                {s.quarantined && (
                  <Action
                    label="Un-quarantine"
                    busy={isBusy(s.id, "unquarantine")}
                    onClick={() => void unquarantine(s)}
                  />
                )}
                <Action
                  label="Download"
                  icon={<Download className="h-3.5 w-3.5" />}
                  busy={isBusy(s.id, "dl")}
                  onClick={() => void openDownloads(s)}
                />
                <Action
                  label="Lyrics"
                  icon={<FileText className="h-3.5 w-3.5" />}
                  busy={isBusy(s.id, "lyrics")}
                  onClick={() => void openLyrics(s)}
                />
                <Action
                  label={
                    s.hitScore != null
                      ? `A&R ${s.hitScore}/100`
                      : "Will it hit?"
                  }
                  icon={<TrendingUp className="h-3.5 w-3.5" />}
                  busy={isBusy(s.id, "hit")}
                  onClick={() => void willItHit(s)}
                />
                <Action
                  label="Truth"
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  onClick={() => void openTruth(s)}
                />
                {s.hitScore != null && (
                  <Action
                    label="🚀 Make it bigger"
                    busy={isBusy(s.id, "bigger")}
                    onClick={() => void makeItBigger(s)}
                  />
                )}
                {/* Every song can hold multiple takes — comparing them was
                    gated behind the "bigger" flow only, which read as the
                    feature having vanished (owner report, 2026-07-16). The
                    modal itself says when there is only one take. */}
                <Action
                  label="⤢ Compare versions"
                  icon={<GitCompare className="h-3.5 w-3.5" />}
                  onClick={() => void openCompare(s)}
                />
                <Action
                  label="🎬 Video"
                  icon={<Clapperboard className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setVideoOpen(s);
                    void loadVideoConcept(s.id);
                  }}
                />
                <Action
                  label="Re-master"
                  icon={<Wand2 className="h-3.5 w-3.5" />}
                  busy={isBusy(s.id, "master")}
                  onClick={() => void remaster(s)}
                />
                {/* §1.11 THE WALL: the bridge is a FIRST-PARTY tool — rendered only
                    when the operator has unlocked with the admin key. Customers
                    never see it; public copy never names the vendor. */}
                {firstParty && (
                  <button
                    onClick={() =>
                      setBridge({ songId: s.id, projectId: s.projectId })
                    }
                    title="Generate this in your own flagship-studio account (best audio, your rights), then bring it back to master + score"
                    className="inline-flex items-center gap-1 rounded-full border border-afrobrand-500/40 bg-afrobrand-500/10 px-2.5 py-1 text-xs text-afrobrand-300 hover:bg-afrobrand-500/20"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Flagship bridge
                  </button>
                )}
                <button
                  onClick={() => setOpenId(openId === s.id ? null : s.id)}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10"
                >
                  {openId === s.id ? "Less" : "More"}
                </button>
              </div>
              {openId === s.id && (
                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/5 pt-2">
                  <Action
                    label="Re-sing (apply lyric edits)"
                    icon={<RefreshCw className="h-3.5 w-3.5" />}
                    busy={isBusy(s.id, "resing")}
                    onClick={() => void resing(s)}
                  />
                  <Action
                    label="Instrumental"
                    icon={<Music2 className="h-3.5 w-3.5" />}
                    busy={isBusy(s.id, "instrumental")}
                    onClick={() => void separate(s, "instrumental")}
                  />
                  <Action
                    label="Stems"
                    icon={<Layers className="h-3.5 w-3.5" />}
                    busy={isBusy(s.id, "full")}
                    onClick={() => void separate(s, "full")}
                  />
                  <Action
                    label="Reuse beat"
                    icon={<Recycle className="h-3.5 w-3.5" />}
                    busy={isBusy(s.id, "reuse")}
                    onClick={() => void reuseBeat(s)}
                  />
                  <Action
                    label="Reuse lyrics"
                    icon={<FileText className="h-3.5 w-3.5" />}
                    busy={isBusy(s.id, "reuselyrics")}
                    onClick={() => void reuseLyrics(s)}
                  />
                  <Action
                    label="Reuse instrumental"
                    icon={<Mic className="h-3.5 w-3.5" />}
                    busy={isBusy(s.id, "reuseinst")}
                    onClick={() => void reuseInstrumental(s)}
                  />
                  <Action
                    label="Start an album from this"
                    icon={<Disc3 className="h-3.5 w-3.5" />}
                    busy={isBusy(s.id, "album")}
                    onClick={() => void startAlbum(s)}
                  />
                  <Action
                    label="Duplicate"
                    icon={<Copy className="h-3.5 w-3.5" />}
                    busy={isBusy(s.id, "dup")}
                    onClick={() => void duplicate(s)}
                  />
                  <Action
                    label="Rename"
                    icon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() => void rename(s)}
                  />
                  <Action
                    label="Studio"
                    icon={<Sliders className="h-3.5 w-3.5" />}
                    onClick={() =>
                      router.push(
                        `/projects/${s.projectId}?song=${encodeURIComponent(s.id)}`
                      )
                    }
                  />
                  <button
                    onClick={() => void remove(s.id)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${armedDelete === s.id ? "border-red-500/60 bg-red-500/20 font-medium text-red-300" : "border-white/10 bg-white/5 text-red-400 hover:bg-red-500/10"}`}
                  >
                    <Trash2 className="inline h-3.5 w-3.5" />{" "}
                    {armedDelete === s.id ? "Really delete?" : "Delete"}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {/* Talk opens ON the song — a centered modal, never a panel at the page
          bottom the user gets scrolled away to. */}
      {chatFor && (
        <Modal
          onClose={() => setChatFor(null)}
          title={`Talk to: ${songs.find(x => x.id === chatFor)?.title ?? "this song"}`}
        >
          <SongChat songId={chatFor} onNewVersion={() => router.refresh()} />
        </Modal>
      )}

      {/* Lyric editor */}
      {editing && (
        <Modal onClose={() => setEditing(null)} title="Edit lyrics">
          <input
            value={editing.title}
            onChange={e => setEditing({ ...editing, title: e.target.value })}
            className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            placeholder="Title"
          />
          <textarea
            value={editing.body}
            onChange={e => setEditing({ ...editing, body: e.target.value })}
            rows={16}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs leading-relaxed"
            placeholder="[Hook]…"
          />

          {/* VIDEO RECOMMENDATION — its own piece, right beside the lyrics.
              Guarded on songId so a stale fetch from a previously-opened song
              can never paint its treatment onto this one. */}
          {videoConcept?.songId === editing.id && (
            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                <Clapperboard className="h-3 w-3 text-afrobrand-400" /> Video
                treatment
                {videoConcept.concept ? (
                  <span className="font-normal text-slate-500">
                    · {videoConcept.concept.durationS}s ·{" "}
                    {videoConcept.concept.format}
                  </span>
                ) : null}
              </div>
              {videoConcept.state === "loading" ? (
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              ) : videoConcept.concept ? (
                <div>
                  <div className="mb-1.5 text-xs font-medium text-slate-200">
                    {videoConcept.concept.title}
                  </div>
                  <ol className="space-y-1.5">
                    {videoConcept.concept.storyboard.map(shot => (
                      <li
                        key={shot.index}
                        className="rounded border border-white/5 bg-black/20 px-2 py-1.5 text-[11px] leading-relaxed text-slate-400"
                      >
                        <span className="font-medium text-slate-300">
                          Shot {shot.index + 1}
                        </span>
                        <span className="text-slate-600">
                          {" "}
                          · {shot.duration_s}s
                        </span>
                        <div className="mt-0.5 text-slate-400">
                          {shot.prompt}
                        </div>
                        {shot.motion || shot.lighting ? (
                          <div className="mt-0.5 text-slate-600">
                            {[shot.motion, shot.lighting]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <button
                  disabled={makingVideo}
                  onClick={() => {
                    const row = songs.find(x => x.id === editing.id);
                    if (row) void makeVideoPlan(row);
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-white/10 disabled:opacity-40"
                >
                  {makingVideo
                    ? "Writing the treatment…"
                    : "🎬 Write the video plan from this song's words"}
                </button>
              )}
            </div>
          )}

          {editing.versions && editing.versions.length > 0 && (
            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                <RefreshCw className="h-3 w-3 text-afrobrand-400" /> Version
                history — your original is always here
              </div>
              <ul className="space-y-1">
                {editing.versions.map((v, i) => (
                  <li key={i} className="flex items-center gap-2 text-[11px]">
                    <span
                      className={`rounded-full px-1.5 py-0.5 ${v.label === "original" ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-slate-400"}`}
                    >
                      {v.label ?? `take ${editing.versions!.length - i}`}
                    </span>
                    <span className="truncate text-slate-500">
                      {v.body
                        .replace(/\[[^\]]*\]/g, "")
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 54)}
                      …
                    </span>
                    <button
                      onClick={() => void revertLyric(i)}
                      disabled={isBusy(editing.id, "revert")}
                      className="ml-auto shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/10 disabled:opacity-50"
                    >
                      {isBusy(editing.id, "revert") ? "…" : "Revert"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-[11px] text-slate-500">
            Editing the words? “Save &amp; re-sing” re-records the vocal with
            your new lyrics and makes it the current version. “Save only” keeps
            the text edit without re-rendering. Every rewrite keeps your
            previous take above — “Revert” restores it (then Re-sing to hear
            it).
          </p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button
              onClick={() => setEditing(null)}
              className="rounded-full border border-white/15 px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => void saveLyrics(false)}
              disabled={isBusy(editing.id, "savelyrics")}
              className="rounded-full border border-white/15 px-4 py-2 text-sm"
            >
              {isBusy(editing.id, "savelyrics") ? "Saving…" : "Save only"}
            </button>
            <button
              onClick={() => void saveLyrics(true)}
              disabled={isBusy(editing.id, "savelyrics")}
              className="inline-flex items-center gap-1 rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink"
            >
              <RefreshCw className="h-3.5 w-3.5" />{" "}
              {isBusy(editing.id, "savelyrics") ? "Working…" : "Save & re-sing"}
            </button>
          </div>
        </Modal>
      )}

      {/* A&R hit prediction */}
      {hit && (
        <Modal onClose={() => setHit(null)} title={`A&R read — ${hit.title}`}>
          <div className="flex gap-4">
            <ScorePill label="HIT" value={hit.p.hitScore} />
            <ScorePill label="VIRAL" value={hit.p.viralScore} />
          </div>
          <p className="mt-3 text-sm text-slate-200">{hit.p.verdict}</p>
          {hit.p.comparableLane && (
            <p className="mt-1 text-xs text-slate-400">
              Lane: {hit.p.comparableLane}
            </p>
          )}
          {hit.p.tiktokMoment && (
            <p className="mt-1 text-xs text-afrobrand-300">
              📱 TikTok moment: {hit.p.tiktokMoment}
            </p>
          )}
          {hit.p.strengths?.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-emerald-300">
                Strengths
              </div>
              <ul className="mt-1 list-disc pl-4 text-xs text-slate-300">
                {hit.p.strengths.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {hit.p.risks?.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-medium text-amber-300">Risks</div>
              <ul className="mt-1 list-disc pl-4 text-xs text-slate-300">
                {hit.p.risks.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {hit.p.toMakeItBigger?.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-medium text-afrobrand-300">
                To make it bigger
              </div>
              <ul className="mt-1 list-disc pl-4 text-xs text-slate-300">
                {hit.p.toMakeItBigger.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
        </Modal>
      )}

      {/* STUDIO TRUTH — the proof pack, readable: what was asked, what trained
          it, whose materials are in it, how it won, what failed on the way. */}
      {truth && (
        <Modal
          onClose={() => setTruth(null)}
          title={`Truth report — ${truth.title}`}
        >
          {truth.loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Assembling the proof…
            </div>
          ) : truth.proof ? (
            <TruthBody proof={truth.proof} persisted={!!truth.persisted} />
          ) : (
            <div className="text-sm text-slate-400">
              No proof available for this song.
            </div>
          )}
        </Modal>
      )}

      {/* Download list */}
      {downloads && (
        <Modal onClose={() => setDownloads(null)} title="Download">
          {downloads.files.length === 0 ? (
            <div className="text-sm text-slate-400">
              No downloadable files yet — render a master first.
            </div>
          ) : (
            <ul className="space-y-2">
              {downloads.files.map((f, i) => (
                <li key={i}>
                  <a
                    href={f.dl ? api.fileHref(f.dl) : f.url}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                  >
                    <span>{f.label}</span>
                    <Download className="h-4 w-4 text-slate-400" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {firstParty && bridge && (
        <FlagshipBridge
          songId={bridge.songId}
          projectId={bridge.projectId}
          onClose={() => setBridge(null)}
          onDone={() =>
            flash(
              "Flagship file received — mastering + scoring. It updates here in ~1 min."
            )
          }
        />
      )}

      {/* VIDEO TREATMENT — first-class per-song piece (owner law: "a piece for
          the video recommendation just like you have lyrics"). It previously
          lived only inside the lyrics editor, invisible unless you knew. */}
      {videoOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setVideoOpen(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-950 p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 font-display text-lg">
                <Clapperboard className="h-4 w-4 text-afrobrand-400" /> Video —{" "}
                {videoOpen.title}
              </div>
              <button
                onClick={() => setVideoOpen(null)}
                className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400 hover:bg-white/10"
              >
                Close
              </button>
            </div>
            {videoConcept?.songId !== videoOpen.id ||
            videoConcept.state === "loading" ? (
              <div className="flex items-center gap-1.5 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : videoConcept.concept ? (
              <div>
                <div className="mb-2 text-sm font-medium text-slate-200">
                  {videoConcept.concept.title}
                  <span className="ml-2 font-normal text-slate-500">
                    · {videoConcept.concept.durationS}s ·{" "}
                    {videoConcept.concept.format}
                  </span>
                </div>
                <ol className="space-y-2">
                  {videoConcept.concept.storyboard.map(shot => (
                    <li
                      key={shot.index}
                      className="rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-xs leading-relaxed text-slate-400"
                    >
                      <span className="font-medium text-slate-300">
                        Scene {shot.index + 1}
                      </span>
                      <span className="text-slate-600"> · {shot.duration_s}s</span>
                      <div className="mt-1 text-slate-400">{shot.prompt}</div>
                      {shot.motion || shot.lighting ? (
                        <div className="mt-1 text-slate-600">
                          {[shot.motion, shot.lighting].filter(Boolean).join(" · ")}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
                {/* REWRITE (owner-requested): plans written before the
                    PERFORMER LAW (0475f1d) carry the wrong lead. POST
                    /videos/storyboards creates a NEW concept and the GET
                    returns the newest, so a rewrite replaces the view without
                    deleting anything. Text only — no video-render credits. */}
                <button
                  disabled={makingVideo}
                  onClick={() => void makeVideoPlan(videoOpen)}
                  className="mt-3 rounded-full border border-white/15 px-4 py-2 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-40"
                >
                  {makingVideo ? "Rewriting the plan…" : "✍️ Rewrite plan"}
                </button>
              </div>
            ) : (
              <div>
                <p className="mb-3 text-sm text-slate-400">
                  No video plan for this song yet. Write one from this
                  song&apos;s own words — text only, no video credits spent.
                </p>
                <button
                  disabled={makingVideo}
                  onClick={() => void makeVideoPlan(videoOpen)}
                  className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-medium text-ink shadow-glow disabled:opacity-40"
                >
                  {makingVideo ? "Writing the treatment…" : "🎬 Write the video plan"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {compare && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setCompare(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-950 p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 font-display text-lg">
                <GitCompare className="h-4 w-4 text-afrobrand-400" /> Compare —{" "}
                {compare.title}
              </div>
              <button
                onClick={() => setCompare(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {compare.loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading versions…
              </div>
            ) : (
              <>
                <p className="mb-3 text-xs text-slate-500">
                  The original and each “bigger” take, side by side — play them,
                  read them, and pick the one you like. Nothing was lost; the
                  originals were just hidden behind the newest.
                </p>
                {/* Audio takes */}
                <div className="mb-4">
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                    Audio
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {compare.data?.audioVersions.map((a, i) => (
                      <div
                        key={i}
                        className={`rounded-xl border p-2.5 ${a.label.includes("Original") ? "border-white/10 bg-white/5" : "border-afrobrand-500/30 bg-afrobrand-500/5"}`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-slate-200">
                            {a.label}
                          </span>
                          <span className="flex items-center gap-1">
                            {/* Pre-certification-era takes are shown AND
                                revertable — tagged, never hidden. Release
                                keeps its own strict certification gate. */}
                            {a.certification?.certified === false && (
                              <span
                                title="Made before hash+QC certification — plays and reverts fine; a Re-master verifies it. Release still requires certification."
                                className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300"
                              >
                                unverified
                              </span>
                            )}
                            {a.isCurrent && (
                              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                                current
                              </span>
                            )}
                          </span>
                        </div>
                        <audio
                          controls
                          preload="none"
                          src={a.url}
                          className="w-full"
                        />
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <a
                            href={api.fileHref(
                              a.dl ??
                                `/songs/${compare.data!.songId}/file?type=version&index=${a.index}`
                            )}
                            download
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10"
                          >
                            <Download className="h-3.5 w-3.5" /> Download
                          </a>
                          {a.canRevert && (
                            <Action
                              label={
                                isBusy(compare.data!.songId, `revert${a.index}`)
                                  ? "Reverting…"
                                  : "Make current"
                              }
                              icon={<RefreshCw className="h-3.5 w-3.5" />}
                              onClick={() => void revertAudio(a.index)}
                              busy={isBusy(
                                compare.data!.songId,
                                `revert${a.index}`
                              )}
                            />
                          )}
                          <Action
                            label={
                              isBusy(compare.data!.songId, `inst${a.index}`)
                                ? "Starting…"
                                : "Instrumental"
                            }
                            icon={<Music2 className="h-3.5 w-3.5" />}
                            onClick={() => void versionInstrumental(a.index)}
                            busy={isBusy(
                              compare.data!.songId,
                              `inst${a.index}`
                            )}
                          />
                        </div>
                      </div>
                    ))}
                    {!compare.data?.audioVersions.length && (
                      <div className="text-xs text-slate-500">
                        No audio takes found.
                      </div>
                    )}
                  </div>
                </div>
                {/* Lyric takes */}
                <div>
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                    Lyrics
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {compare.data?.lyricVersions.map((l, i) => (
                      <div
                        key={i}
                        className={`rounded-xl border p-2.5 ${/original/i.test(l.label) ? "border-white/10 bg-white/5" : "border-afrobrand-500/30 bg-afrobrand-500/5"}`}
                      >
                        <div className="mb-1 text-xs font-medium text-slate-200">
                          {l.label}
                          {l.title ? ` · ${l.title}` : ""}
                        </div>
                        <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                          {l.body}
                        </pre>
                      </div>
                    ))}
                    {(compare.data?.lyricVersions.length ?? 0) < 2 && (
                      <div className="text-xs text-slate-500">
                        Only one lyric take is on record (the original text may
                        predate version history — the audio original above is
                        still here).
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Truth report body — renders the proof pack VERBATIM: stored facts, honest
 *  notes for what isn't stored, engine CLASSES only (the API enforces the wall,
 *  and nothing here re-labels them). Selected-vs-effective genre mismatch is
 *  flagged in amber — a fact worth seeing, not a bug to hide. */
function TruthBody({
  proof,
  persisted,
}: {
  proof: ProofPack;
  persisted: boolean;
}) {
  const lane = (g?: string | null) => (g ? g.replace(/_/g, " ") : "—");
  const req = proof.request ?? {};
  const genreMismatch = !!(
    req.selectedGenre &&
    req.effectiveGenre &&
    req.selectedGenre !== req.effectiveGenre
  );
  const tr = proof.training;
  const mat = proof.materials;
  const rend = proof.render ?? {};
  const fails = proof.failures;
  return (
    <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
      <p className="text-[11px] text-slate-500">
        Every line is read from what the studio stored while it worked — nothing
        recomputed, nothing invented. Unmeasured fields say so.
        {persisted ? " Sealed at green-light." : ""}
      </p>

      <TruthSection title="Request — what you asked for">
        {req.note ? (
          <div className="text-slate-500">{req.note}</div>
        ) : (
          <>
            <TruthKV
              k="Selected genre"
              v={lane(req.selectedGenre)}
              amber={genreMismatch}
            />
            <TruthKV
              k="Effective genre (project lane)"
              v={lane(req.effectiveGenre)}
              amber={genreMismatch}
            />
            {genreMismatch && (
              <div className="text-amber-300">
                ⚠ Selected ≠ effective — the project lane judged this take, not
                the genre picked at render time.
              </div>
            )}
            {!!req.fusionGenres?.length && (
              <TruthKV
                k="Fusion"
                v={req.fusionGenres.map(g => lane(g)).join(" + ")}
              />
            )}
            {req.mood && <TruthKV k="Mood" v={req.mood} />}
            {!!req.languages?.length && (
              <TruthKV k="Languages" v={req.languages.join(", ")} />
            )}
            {req.voice && <TruthKV k="Voice" v={req.voice} />}
            <TruthKV k="Engine requested" v={req.engineRequested ?? "auto"} />
            {!!req.promptStyleTags?.length && (
              <TruthKV k="Style tags" v={req.promptStyleTags.join(", ")} />
            )}
            {req.vibePrompt && (
              <div className="pt-0.5 text-slate-400">“{req.vibePrompt}”</div>
            )}
          </>
        )}
      </TruthSection>

      <TruthSection title="Training — what shaped the sound">
        <TruthKV
          k="References used"
          v={String(tr?.usedReferenceIds?.length ?? 0)}
        />
        {tr?.totalCount != null && (
          <TruthKV
            k="Deep-measured"
            v={`${tr.measuredCount ?? 0} of ${tr.totalCount}`}
          />
        )}
        <TruthKV
          k="Pinned reference"
          v={
            tr?.pinnedReferenceId
              ? `…${tr.pinnedReferenceId.slice(-8)}`
              : "none"
          }
        />
        {tr?.note && <div className="text-slate-500">{tr.note}</div>}
      </TruthSection>

      <TruthSection title="Materials — your shelf in this take">
        {mat?.roles?.length ? (
          <TruthKV
            k={`${mat.usedMaterialIds?.length ?? mat.roles.length} used`}
            v={mat.roles.filter(Boolean).join(", ")}
          />
        ) : (
          <div className="text-slate-500">
            {mat?.note ?? "no material log stored"}
          </div>
        )}
      </TruthSection>

      <TruthSection title="Render">
        {rend.note ? (
          <div className="text-slate-500">{rend.note}</div>
        ) : (
          <>
            <TruthKV k="Engine class" v={rend.engineClass ?? "—"} />
            <TruthKV
              k="Takes"
              v={`${rend.takesRendered ?? 1} rendered · ranked by ${rend.rankedBy ?? "single take"}`}
            />
            {rend.earRead && <TruthKV k="Ear read" v={rend.earRead} />}
            {rend.qc && (
              <TruthKV
                k="QC"
                v={`${rend.qc.verdict ?? "not measured"}${rend.qc.integratedLufs != null ? ` · ${rend.qc.integratedLufs} LUFS` : ""}`}
              />
            )}
          </>
        )}
        {proof.master && !proof.master.note && (
          <TruthKV
            k="Master"
            v={`${proof.master.qcVerdict ?? "not measured"}${proof.master.measuredLufs != null ? ` · ${proof.master.measuredLufs} LUFS` : ""}`}
          />
        )}
      </TruthSection>

      <TruthSection title="Lane — judged against your sound">
        <TruthKV
          k="Lane score"
          v={
            proof.lane?.score != null
              ? `${proof.lane.score}/100`
              : "not yet listened-back"
          }
        />
        {proof.lane?.judgedAgainst && (
          <div className="text-slate-400">{proof.lane.judgedAgainst}</div>
        )}
        {proof.lane?.note && (
          <div className="text-slate-500">{proof.lane.note}</div>
        )}
      </TruthSection>

      <TruthSection title="A&R (advisory)">
        <TruthKV
          k="Hit / viral"
          v={
            proof.ar?.hitScore != null
              ? `${proof.ar.hitScore} / ${proof.ar.viralScore ?? "—"}`
              : "no read stored"
          }
        />
        {proof.ar?.note && (
          <div className="text-slate-500">{proof.ar.note}</div>
        )}
      </TruthSection>

      <TruthSection title="Failed attempts">
        {fails?.count ? (
          <>
            <TruthKV k="Failed renders" v={String(fails.count)} amber />
            {fails.lastError && (
              <div className="text-slate-400">Last: {fails.lastError}</div>
            )}
          </>
        ) : (
          <div className="text-slate-500">
            {fails?.note ?? "none on record"}
          </div>
        )}
      </TruthSection>

      {proof.whyThisWon && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-2.5 text-xs text-emerald-200">
          <span className="font-medium">Why this take won:</span>{" "}
          {proof.whyThisWon}
        </div>
      )}
    </div>
  );
}

function TruthSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-widest text-slate-500">
        {title}
      </div>
      <div className="space-y-0.5 text-xs text-slate-300">{children}</div>
    </div>
  );
}

function TruthKV({
  k,
  v,
  amber,
}: {
  k: string;
  v: React.ReactNode;
  amber?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-slate-500">{k}</span>
      <span
        className={`text-right ${amber ? "text-amber-300" : "text-slate-200"}`}
      >
        {v}
      </span>
    </div>
  );
}

function ScorePill({ label, value }: { label: string; value: number }) {
  const color =
    value >= 80
      ? "text-emerald-300"
      : value >= 60
        ? "text-afrobrand-300"
        : value >= 40
          ? "text-amber-300"
          : "text-slate-400";
  return (
    <div className="flex-1 rounded-xl border border-white/10 bg-black/30 p-3 text-center">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">
        {label}
      </div>
      <div className={`font-display text-3xl ${color}`}>{value}</div>
      <div className="text-[10px] text-slate-600">/ 100</div>
    </div>
  );
}

function Action({
  label,
  icon,
  onClick,
  busy,
}: {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-lg">{title}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
