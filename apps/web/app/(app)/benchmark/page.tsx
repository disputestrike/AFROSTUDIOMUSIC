"use client";
import { OperatorGate } from '@/components/OperatorGate';

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  FlaskConical,
  Headphones,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { useApi } from "@/lib/api";

const DIMENSIONS = [
  ["groove", "Groove"],
  ["genreIdentity", "Genre"],
  ["songwriting", "Writing"],
  ["vocals", "Vocals"],
  ["mix", "Mix"],
  ["replayValue", "Replay"],
] as const;

type Dimension = (typeof DIMENSIONS)[number][0];
type Scores = Record<Dimension, number>;
type Side = "a" | "b";

interface Candidate {
  id: string;
  title: string;
  genre: string;
}

interface CompetitivePair {
  id: string;
  genre: string;
  status: string;
  createdAt: string;
  judgmentCount: number;
  judged: boolean;
  audio: { a: string; b: string };
  reveal: {
    afrohitSide: Side;
    afrohitTitle: string;
    competitor: string;
    winner: "afrohit" | "competitor" | "tie";
    judgedAt?: string;
  } | null;
}

interface Evidence {
  schemaVersion: number;
  totalPairs: number;
  competitor: string;
  verdict: string;
  claimReady: boolean;
  statisticalClaimReady: boolean;
  claim: string;
  evidenceHash: string;
  corpus: {
    claimReady: boolean;
    sample: {
      totalPairs: number;
      rightsValidPairs: number;
      protocolValidPairs: number;
      eligiblePairs: number;
      uniqueReferenceHashes: number;
      uniqueAfrohitHashes: number;
      genres: number;
      invalidRightsPairs: number;
      invalidProtocolPairs: number;
      duplicateReferencePairs: number;
      duplicateAfrohitPairs: number;
      crossSideHashCollisions: number;
    };
    gates: {
      rightsPassed: boolean;
      protocolPassed: boolean;
      independencePassed: boolean;
      genreCoveragePassed: boolean;
      required: { minPairs: number; minGenres: number };
    };
  };
  sample: {
    submittedJudgments: number;
    eligibleJudgments: number;
    eligiblePairs: number;
    genres: number;
    wins: number;
    losses: number;
    ties: number;
  };
  winRate: number | null;
  winRateLower95: number | null;
  dimensionDelta: Record<Dimension, number>;
  gates: {
    samplePassed: boolean;
    superiorityPassed: boolean;
    dimensionFloorPassed: boolean;
    corpusPassed: boolean;
    required: {
      minJudgments: number;
      minPairs: number;
      minGenres: number;
      minJudgesPerPair: number;
      maxDimensionDeficit: number;
    };
  };
}

interface QueueItem {
  songId: string | null;
  url: string;
  genre: string;
  engine: string | null;
  laneScore: number | null;
}

interface GenreRow {
  genre: string;
  ratings: number;
  avgHuman: number;
  avgLaneScore: number | null;
  earVsLaneGap: number | null;
}

interface LegacySide {
  token: string;
  url: string;
}

function blankScores(): Scores {
  return {
    groove: 3,
    genreIdentity: 3,
    songwriting: 3,
    vocals: 3,
    mix: 3,
    replayValue: 3,
  };
}

function audioFormat(
  file: File
): "wav" | "mp3" | "flac" | "aiff" | "m4a" | "ogg" | "webm" | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "aif" || ext === "aiff") return "aiff";
  if (ext === "mp4" || ext === "m4a") return "m4a";
  if (ext === "wave" || ext === "wav") return "wav";
  if (ext && ["mp3", "flac", "ogg", "webm"].includes(ext)) {
    return ext as "mp3" | "flac" | "ogg" | "webm";
  }
  return null;
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const json = text.match(/{.*}$/s)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as { message?: string; error?: string };
      return parsed.message ?? parsed.error ?? text;
    } catch {
      return text;
    }
  }
  return text;
}

function ScoreControl({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange(value: number): void;
  disabled?: boolean;
}) {
  return (
    <div className="grid h-8 grid-cols-5 overflow-hidden rounded border border-slate-700">
      {[1, 2, 3, 4, 5].map(score => (
        <button
          key={score}
          type="button"
          disabled={disabled}
          aria-pressed={value === score}
          onClick={() => onChange(score)}
          className={
            "w-8 border-r border-slate-700 text-xs last:border-r-0 disabled:cursor-not-allowed " +
            (value === score
              ? "bg-cyan-400 font-semibold text-slate-950"
              : "bg-slate-950 text-slate-400 hover:bg-slate-800")
          }
        >
          {score}
        </button>
      ))}
    </div>
  );
}

function BenchmarkPageInner() {
  const api = useApi();
  const [view, setView] = useState<"competitive" | "calibration">(
    "competitive"
  );
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pairs, setPairs] = useState<CompetitivePair[]>([]);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [selectedPairId, setSelectedPairId] = useState("");
  const [songId, setSongId] = useState("");
  const [competitor, setCompetitor] = useState<"suno" | "udio" | "other">(
    "suno"
  );
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [rightsBasis, setRightsBasis] = useState<
    "owner" | "licensed_evaluation"
  >("owner");
  const [rightsNote, setRightsNote] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [protocolNote, setProtocolNote] = useState("");
  const [protocolConfirmed, setProtocolConfirmed] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [scores, setScores] = useState<Record<Side, Scores>>({
    a: blankScores(),
    b: blankScores(),
  });
  const [winner, setWinner] = useState<Side | "tie" | null>(null);
  const [confidence, setConfidence] = useState(3);
  const [judgmentNote, setJudgmentNote] = useState("");
  const [busy, setBusy] = useState<"load" | "create" | "judge" | null>("load");
  const [error, setError] = useState("");

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [summary, setSummary] = useState<GenreRow[]>([]);
  const [legacyPair, setLegacyPair] = useState<{
    a: LegacySide;
    b: LegacySide;
  } | null>(null);
  const [legacyNote, setLegacyNote] = useState("");
  const [legacyReveal, setLegacyReveal] = useState<{
    a: string;
    b: string;
    picked: Side;
  } | null>(null);

  const activePair = useMemo(
    () =>
      pairs.find(pair => pair.id === selectedPairId) ??
      pairs.find(pair => !pair.judged) ??
      pairs[0] ??
      null,
    [pairs, selectedPairId]
  );

  const loadCompetitive = useCallback(async () => {
    setBusy(current => current ?? "load");
    try {
      const [candidateRows, pairRows, evidenceRow] = await Promise.all([
        api.get<Candidate[]>("/benchmark/competitor/candidates"),
        api.get<CompetitivePair[]>("/benchmark/competitor/pairs"),
        api.get<Evidence>("/benchmark/competitor/evidence"),
      ]);
      setCandidates(candidateRows);
      setPairs(pairRows);
      setEvidence(evidenceRow);
      setSongId(current => current || candidateRows[0]?.id || "");
      setSelectedPairId(current => {
        if (pairRows.some(pair => pair.id === current)) return current;
        return pairRows.find(pair => !pair.judged)?.id ?? pairRows[0]?.id ?? "";
      });
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setBusy(current => (current === "load" ? null : current));
    }
  }, [api]);

  const loadCalibration = useCallback(async () => {
    try {
      const [queueRows, summaryRows, pairRow] = await Promise.all([
        api.get<QueueItem[]>("/benchmark/queue"),
        api.get<{ genres: GenreRow[] }>("/benchmark/summary"),
        api.get<{ a: LegacySide | null; b: LegacySide | null }>(
          "/benchmark/pair"
        ),
      ]);
      setQueue(queueRows);
      setSummary(summaryRows.genres);
      setLegacyPair(
        pairRow.a && pairRow.b
          ? Math.random() < 0.5
            ? { a: pairRow.a, b: pairRow.b }
            : { a: pairRow.b, b: pairRow.a }
          : null
      );
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [api]);

  useEffect(() => {
    void loadCompetitive();
  }, [loadCompetitive]);

  useEffect(() => {
    if (view === "calibration") void loadCalibration();
  }, [loadCalibration, view]);

  function resetJudgment() {
    setScores({ a: blankScores(), b: blankScores() });
    setWinner(null);
    setConfidence(3);
    setJudgmentNote("");
  }

  async function createPair() {
    if (
      !songId ||
      !referenceFile ||
      !rightsConfirmed ||
      rightsNote.trim().length < 3 ||
      !protocolConfirmed ||
      protocolNote.trim().length < 10
    )
      return;
    const format = audioFormat(referenceFile);
    if (!format) {
      setError("Use WAV, MP3, FLAC, AIFF, M4A, OGG, or WebM audio.");
      return;
    }
    setBusy("create");
    setError("");
    setUploadProgress(0);
    try {
      const upload = await api.uploadToStorage(
        referenceFile,
        "reference",
        progress => {
          setUploadProgress(Math.round(progress * 100));
        }
      );
      const result = await api.post<{ id: string }>(
        "/benchmark/competitor/pairs",
        {
          songId,
          referenceKey: upload.key,
          referenceFormat: format,
          competitor,
          rightsAttestation: {
            confirmed: true,
            basis: rightsBasis,
            note: rightsNote.trim(),
          },
          comparisonProtocol: {
            version: 1,
            blind: true,
            identityMetadataRemoved: true,
            loudnessMatched: true,
            durationMatched: true,
            independentJudgesMin: 3,
            note: protocolNote.trim(),
          },
        }
      );
      setReferenceFile(null);
      setRightsNote("");
      setRightsConfirmed(false);
      setProtocolNote("");
      setProtocolConfirmed(false);
      await loadCompetitive();
      setSelectedPairId(result.id);
      resetJudgment();
    } catch (createError) {
      setError(errorMessage(createError));
    } finally {
      setBusy(null);
      setUploadProgress(0);
    }
  }

  function setScore(side: Side, dimension: Dimension, value: number) {
    setScores(current => ({
      ...current,
      [side]: { ...current[side], [dimension]: value },
    }));
  }

  async function submitJudgment() {
    if (!activePair || activePair.judged || !winner) return;
    setBusy("judge");
    setError("");
    try {
      await api.post(`/benchmark/competitor/pairs/${activePair.id}/judge`, {
        winner,
        scores,
        confidence,
        note: judgmentNote.trim() || undefined,
      });
      await loadCompetitive();
      resetJudgment();
    } catch (judgeError) {
      setError(errorMessage(judgeError));
    } finally {
      setBusy(null);
    }
  }

  async function rate(item: QueueItem, humanRating: number) {
    setBusy("judge");
    try {
      await api.post("/benchmark/rate", {
        genre: item.genre,
        audioUrl: item.url,
        humanRating,
        source: "afrohit",
        songId: item.songId ?? undefined,
        engine: item.engine ?? undefined,
        laneScore: item.laneScore ?? undefined,
      });
      await loadCalibration();
    } catch (rateError) {
      setError(errorMessage(rateError));
    } finally {
      setBusy(null);
    }
  }

  async function pickLegacy(side: Side) {
    if (!legacyPair) return;
    const other = side === "a" ? "b" : "a";
    setBusy("judge");
    try {
      await api.post("/benchmark/pick", {
        winner: legacyPair[side].token,
        loser: legacyPair[other].token,
        note: legacyNote.trim() || undefined,
      });
      const songs =
        await api.get<Array<{ id: string; title: string }>>("/songs");
      const title = (id: string) =>
        songs.find(song => song.id === id)?.title ?? "Unknown";
      setLegacyReveal({
        a: title(legacyPair.a.token),
        b: title(legacyPair.b.token),
        picked: side,
      });
    } catch (pickError) {
      setError(errorMessage(pickError));
    } finally {
      setBusy(null);
    }
  }

  const verdictTone = evidence?.claimReady
    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
    : evidence?.verdict === "behind"
      ? "border-red-500/50 bg-red-500/10 text-red-300"
      : "border-amber-500/50 bg-amber-500/10 text-amber-200";

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="font-display text-2xl text-slate-100">
            Listening Benchmark
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Human evidence for quality decisions and competitor claims.
          </p>
        </div>
        <div
          className="flex h-9 overflow-hidden rounded border border-slate-700"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "competitive"}
            onClick={() => setView("competitive")}
            className={
              "flex items-center gap-2 px-3 text-sm " +
              (view === "competitive"
                ? "bg-cyan-400 text-slate-950"
                : "bg-slate-950 text-slate-300")
            }
          >
            <FlaskConical className="h-4 w-4" />
            Competitive
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "calibration"}
            onClick={() => setView("calibration")}
            className={
              "flex items-center gap-2 border-l border-slate-700 px-3 text-sm " +
              (view === "calibration"
                ? "bg-cyan-400 text-slate-950"
                : "bg-slate-950 text-slate-300")
            }
          >
            <BarChart3 className="h-4 w-4" />
            Calibration
          </button>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"
        >
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      {view === "competitive" ? (
        <>
          <section className="grid gap-3 border-b border-slate-800 pb-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-slate-500">Verdict</p>
              <div
                className={
                  "mt-2 inline-flex min-h-9 items-center gap-2 rounded border px-3 text-sm " +
                  verdictTone
                }
              >
                {evidence?.claimReady ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <LockKeyhole className="h-4 w-4" />
                )}
                {(evidence?.verdict ?? "loading").replace(/_/g, " ")}
              </div>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">
                Eligible judgments
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-100">
                {evidence?.sample.eligibleJudgments ?? 0}
                <span className="text-sm font-normal text-slate-500">
                  {" "}
                  / {evidence?.gates.required.minJudgments ?? 30}
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Eligible pairs</p>
              <p className="mt-2 text-2xl font-semibold text-slate-100">
                {evidence?.sample.eligiblePairs ?? 0}
                <span className="text-sm font-normal text-slate-500">
                  {" "}
                  / {evidence?.gates.required.minPairs ?? 10}
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">
                95% win-rate floor
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-100">
                {evidence?.winRateLower95 == null
                  ? "-"
                  : Math.round(evidence.winRateLower95 * 100) + "%"}
              </p>
            </div>
            <p className="text-sm text-slate-300 sm:col-span-2 lg:col-span-4">
              {evidence?.claim}
            </p>
            {evidence && (
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400 sm:col-span-2 lg:col-span-4">
                <p className="flex items-center gap-1.5">
                  <ShieldCheck
                    className={
                      "h-4 w-4 " +
                      (evidence.gates.corpusPassed
                        ? "text-emerald-300"
                        : "text-amber-300")
                    }
                  />
                  Corpus {evidence.corpus.sample.eligiblePairs}/
                  {evidence.corpus.gates.required.minPairs}
                </p>
                <p>
                  Rights {evidence.corpus.sample.rightsValidPairs}/
                  {evidence.corpus.sample.totalPairs}
                </p>
                <p>
                  Protocol {evidence.corpus.sample.protocolValidPairs}/
                  {evidence.corpus.sample.totalPairs}
                </p>
                <p>
                  Unique audio{" "}
                  {Math.min(
                    evidence.corpus.sample.uniqueReferenceHashes,
                    evidence.corpus.sample.uniqueAfrohitHashes
                  )}
                </p>
                <p title={evidence.evidenceHash}>
                  Evidence {evidence.evidenceHash.slice(0, 12)}
                </p>
              </div>
            )}
          </section>

          <section className="grid gap-6 border-b border-slate-800 pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <UploadCloud className="h-5 w-5 text-cyan-300" />
                <h2 className="font-display text-lg text-slate-100">
                  New frozen pair
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm text-slate-300">
                  AfroHits song
                  <select
                    value={songId}
                    onChange={event => setSongId(event.target.value)}
                    className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-950 px-3"
                  >
                    {candidates.length === 0 && (
                      <option value="">No certified songs</option>
                    )}
                    {candidates.map(candidate => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.title} - {candidate.genre.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Competitor
                  <select
                    value={competitor}
                    onChange={event =>
                      setCompetitor(event.target.value as typeof competitor)
                    }
                    className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-950 px-3"
                  >
                    <option value="suno">Suno</option>
                    <option value="udio">Udio</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Competitor audio
                  <span className="mt-1 flex h-10 cursor-pointer items-center gap-2 rounded border border-dashed border-slate-600 bg-slate-950 px-3 text-slate-400 hover:border-cyan-400">
                    <UploadCloud className="h-4 w-4" />
                    <span className="min-w-0 truncate">
                      {referenceFile?.name ?? "Choose audio file"}
                    </span>
                    <input
                      type="file"
                      accept=".wav,.mp3,.flac,.aiff,.m4a,.ogg,.webm,audio/*"
                      className="hidden"
                      onChange={event =>
                        setReferenceFile(event.target.files?.[0] ?? null)
                      }
                    />
                  </span>
                </label>
                <label className="text-sm text-slate-300">
                  Rights basis
                  <select
                    value={rightsBasis}
                    onChange={event =>
                      setRightsBasis(event.target.value as typeof rightsBasis)
                    }
                    className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-950 px-3"
                  >
                    <option value="owner">I own this render</option>
                    <option value="licensed_evaluation">
                      Licensed for evaluation
                    </option>
                  </select>
                </label>
              </div>
              <label className="block text-sm text-slate-300">
                Evidence note
                <input
                  value={rightsNote}
                  onChange={event => setRightsNote(event.target.value)}
                  maxLength={500}
                  className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-950 px-3"
                />
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={rightsConfirmed}
                  onChange={event => setRightsConfirmed(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-cyan-400"
                />
                <span>
                  I confirm I may store and use this audio for private
                  comparative evaluation.
                </span>
              </label>
              <label className="block text-sm text-slate-300">
                Listening protocol
                <input
                  value={protocolNote}
                  onChange={event => setProtocolNote(event.target.value)}
                  maxLength={500}
                  className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-950 px-3"
                />
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={protocolConfirmed}
                  onChange={event => setProtocolConfirmed(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-cyan-400"
                />
                <span>
                  I confirm source identity was removed and both tracks use the
                  same listening window and matched loudness.
                </span>
              </label>
              <button
                type="button"
                onClick={() => void createPair()}
                disabled={
                  busy !== null ||
                  !songId ||
                  !referenceFile ||
                  !rightsConfirmed ||
                  rightsNote.trim().length < 3 ||
                  !protocolConfirmed ||
                  protocolNote.trim().length < 10
                }
                className="inline-flex h-10 items-center gap-2 rounded bg-cyan-400 px-4 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "create" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                {busy === "create"
                  ? `Freezing audio ${uploadProgress}%`
                  : "Create blind pair"}
              </button>
            </div>

            <div>
              <h2 className="font-display text-lg text-slate-100">
                Pair coverage
              </h2>
              <div className="mt-3 overflow-hidden rounded border border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-950 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Pair</th>
                      <th className="px-3 py-2">Judges</th>
                      <th className="px-3 py-2">You</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.map(pair => (
                      <tr key={pair.id} className="border-t border-slate-800">
                        <td className="p-0">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPairId(pair.id);
                              resetJudgment();
                            }}
                            className={
                              "w-full px-3 py-2 text-left capitalize " +
                              (activePair?.id === pair.id
                                ? "bg-cyan-400/10 text-cyan-200"
                                : "text-slate-300")
                            }
                          >
                            {pair.genre.replace(/_/g, " ")}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-slate-400">
                          {pair.judgmentCount} /{" "}
                          {evidence?.gates.required.minJudgesPerPair ?? 3}
                        </td>
                        <td className="px-3 py-2">
                          {pair.judged ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <span className="text-amber-300">Open</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {pairs.length === 0 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-3 py-5 text-center text-slate-500"
                        >
                          No benchmark pairs.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Headphones className="h-5 w-5 text-amber-300" />
                <h2 className="font-display text-lg text-slate-100">
                  Blind judgment
                </h2>
              </div>
              {activePair?.reveal && (
                <p className="text-sm text-slate-300">
                  AfroHits was{" "}
                  <strong>{activePair.reveal.afrohitSide.toUpperCase()}</strong>{" "}
                  ({activePair.reveal.afrohitTitle}); reference:{" "}
                  {activePair.reveal.competitor}.
                </p>
              )}
            </div>
            {!activePair ? (
              <p className="text-sm text-slate-500">Create a pair to begin.</p>
            ) : (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  {(["a", "b"] as const).map(side => (
                    <article
                      key={side}
                      className="rounded border border-slate-700 bg-slate-950/60 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="font-display text-xl text-slate-100">
                          Side {side.toUpperCase()}
                        </h3>
                        {activePair.reveal?.afrohitSide === side && (
                          <span className="rounded bg-cyan-400 px-2 py-1 text-xs font-semibold text-slate-950">
                            AfroHits
                          </span>
                        )}
                        {activePair.reveal &&
                          activePair.reveal.afrohitSide !== side && (
                            <span className="rounded bg-amber-300 px-2 py-1 text-xs font-semibold text-slate-950">
                              {activePair.reveal.competitor}
                            </span>
                          )}
                      </div>
                      <audio
                        controls
                        preload="metadata"
                        src={api.fileHref(activePair.audio[side])}
                        className="mt-3 w-full"
                      />
                      <div className="mt-4 space-y-2">
                        {DIMENSIONS.map(([dimension, label]) => (
                          <div
                            key={dimension}
                            className="flex min-h-8 items-center justify-between gap-3"
                          >
                            <span className="text-sm text-slate-400">
                              {label}
                            </span>
                            <ScoreControl
                              value={scores[side][dimension]}
                              disabled={activePair.judged}
                              onChange={value =>
                                setScore(side, dimension, value)
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
                {!activePair.judged && (
                  <div className="grid gap-4 border-t border-slate-800 pt-4 lg:grid-cols-[auto_180px_minmax(220px,1fr)_auto] lg:items-end">
                    <div>
                      <p className="mb-1 text-sm text-slate-400">Winner</p>
                      <div className="flex h-10 overflow-hidden rounded border border-slate-700">
                        {(["a", "b", "tie"] as const).map(choice => (
                          <button
                            key={choice}
                            type="button"
                            onClick={() => setWinner(choice)}
                            className={
                              "min-w-16 border-r border-slate-700 px-3 text-sm capitalize last:border-r-0 " +
                              (winner === choice
                                ? "bg-amber-300 font-semibold text-slate-950"
                                : "bg-slate-950 text-slate-300")
                            }
                          >
                            {choice === "tie" ? "Tie" : choice.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="text-sm text-slate-400">
                      Confidence
                      <input
                        type="range"
                        min={1}
                        max={5}
                        value={confidence}
                        onChange={event =>
                          setConfidence(Number(event.target.value))
                        }
                        className="mt-2 w-full accent-cyan-400"
                      />
                      <span className="sr-only">{confidence} of 5</span>
                    </label>
                    <label className="text-sm text-slate-400">
                      Judgment note
                      <input
                        value={judgmentNote}
                        onChange={event => setJudgmentNote(event.target.value)}
                        maxLength={1000}
                        className="mt-1 h-10 w-full rounded border border-slate-700 bg-slate-950 px-3 text-slate-200"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void submitJudgment()}
                      disabled={busy !== null || !winner}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded bg-amber-300 px-4 text-sm font-semibold text-slate-950 disabled:opacity-40"
                    >
                      {busy === "judge" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <LockKeyhole className="h-4 w-4" />
                      )}
                      Commit
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {evidence && (
            <section className="border-t border-slate-800 pt-5">
              <h2 className="font-display text-lg text-slate-100">
                Dimension delta
              </h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {DIMENSIONS.map(([dimension, label]) => {
                  const delta = evidence.dimensionDelta[dimension];
                  return (
                    <div
                      key={dimension}
                      className="rounded border border-slate-800 bg-slate-950 px-3 py-2"
                    >
                      <p className="text-xs text-slate-500">{label}</p>
                      <p
                        className={
                          "mt-1 text-lg font-semibold " +
                          (delta >= 0 ? "text-emerald-300" : "text-red-300")
                        }
                      >
                        {delta > 0 ? "+" : ""}
                        {delta.toFixed(2)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <section className="grid gap-5 border-b border-slate-800 pb-6 lg:grid-cols-2">
            <div>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg text-slate-100">
                  Internal blind pair
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setLegacyReveal(null);
                    setLegacyNote("");
                    void loadCalibration();
                  }}
                  title="Load another pair"
                  className="inline-flex h-9 w-9 items-center justify-center rounded border border-slate-700 text-slate-300"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
              {legacyPair ? (
                <>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {(["a", "b"] as const).map(side => (
                      <article
                        key={side}
                        className="rounded border border-slate-700 p-3"
                      >
                        <div className="flex items-center justify-between">
                          <strong>Side {side.toUpperCase()}</strong>
                          {legacyReveal && (
                            <span className="text-xs text-slate-400">
                              {legacyReveal[side]}
                            </span>
                          )}
                        </div>
                        <audio
                          controls
                          src={legacyPair[side].url}
                          className="mt-2 w-full"
                        />
                        {!legacyReveal && (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void pickLegacy(side)}
                            className="mt-2 h-9 w-full rounded border border-amber-300/50 text-sm text-amber-200"
                          >
                            Pick {side.toUpperCase()}
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                  {!legacyReveal && (
                    <input
                      value={legacyNote}
                      onChange={event => setLegacyNote(event.target.value)}
                      maxLength={500}
                      className="mt-3 h-10 w-full rounded border border-slate-700 bg-slate-950 px-3"
                    />
                  )}
                </>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  Two playable songs are required.
                </p>
              )}
            </div>
            <div>
              <h2 className="font-display text-lg text-slate-100">
                Lane calibration
              </h2>
              <div className="mt-3 overflow-hidden rounded border border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-950 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Genre</th>
                      <th className="px-3 py-2">N</th>
                      <th className="px-3 py-2">Ear</th>
                      <th className="px-3 py-2">Lane</th>
                      <th className="px-3 py-2">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map(row => (
                      <tr key={row.genre} className="border-t border-slate-800">
                        <td className="px-3 py-2 capitalize">
                          {row.genre.replace(/_/g, " ")}
                        </td>
                        <td className="px-3 py-2 text-slate-400">
                          {row.ratings}
                        </td>
                        <td className="px-3 py-2">{row.avgHuman.toFixed(2)}</td>
                        <td className="px-3 py-2">{row.avgLaneScore ?? "-"}</td>
                        <td
                          className={
                            "px-3 py-2 " +
                            ((row.earVsLaneGap ?? 0) < -15
                              ? "text-red-300"
                              : "text-emerald-300")
                          }
                        >
                          {row.earVsLaneGap ?? "-"}
                        </td>
                      </tr>
                    ))}
                    {summary.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-3 py-5 text-center text-slate-500"
                        >
                          No ratings.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
          <section>
            <h2 className="font-display text-lg text-slate-100">
              Recent renders
            </h2>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {queue.map((item, index) => (
                <article
                  key={item.songId ?? index}
                  className="rounded border border-slate-800 p-3"
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="capitalize text-slate-300">
                      {item.genre.replace(/_/g, " ")}
                    </span>
                    <span className="text-slate-500">
                      {item.engine ?? "unknown"}
                      {item.laneScore == null
                        ? ""
                        : ` / lane ${item.laneScore}`}
                    </span>
                  </div>
                  <audio controls src={item.url} className="mt-2 w-full" />
                  <div className="mt-2 flex h-9 overflow-hidden rounded border border-slate-700">
                    {[1, 2, 3, 4, 5].map(rating => (
                      <button
                        key={rating}
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void rate(item, rating)}
                        className="flex-1 border-r border-slate-700 text-sm text-slate-300 last:border-r-0 hover:bg-cyan-400 hover:text-slate-950"
                      >
                        {rating}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
              {queue.length === 0 && (
                <p className="text-sm text-slate-500">No unrated renders.</p>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

// TENANT SURFACE ISOLATION (Wave 8a): operator-only page. The gate is a
// polite presentation wrapper for deep links; the API routes behind this page
// are independently requireAdmin-gated server-side.
export default function BenchmarkPage() {
  return (
    <OperatorGate>
      <BenchmarkPageInner />
    </OperatorGate>
  );
}
