/**
 * §9 + §10 — the PRODUCER BRAIN, surfaced.
 *
 * Everything here is READ + PURE-TS SCORING against data the worker already
 * measured (BeatAsset.meta.measured / .compliance / .bestOf / .laneRepair). No
 * DSP runs in the API process, no spend happens in this file — the Adjust plan
 * is shown BEFORE any money moves (§10 step 5), and every number states its
 * provenance (§9: never a blank, never a guess).
 */
import { prisma } from '@afrohit/db';
import {
  GENRES,
  buildLaneProfile,
  scoreLaneCompliance,
  planRepairs,
  describeCompliance,
  describeRepairPlan,
  engineAdequacy,
  recommendEngine,
  engineClass,
  referenceOrigin,
  laneReleaseGate,
  type MeasuredAnalysis,
  type LaneComplianceScore,
  type RepairPlan,
} from '@afrohit/shared';
import { musicRouteCapabilities } from './music-capabilities';

// ---------- lane reference fetch (same contract as routes/lanes.ts) ----------
const norm = (g?: string | null) => (g ?? '').toLowerCase().trim().replace(/[\s/-]+/g, '_');
const genreMatches = (a?: string | null, b?: string | null) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

/** Same fetch, but keep PROVENANCE: recipe.source==='generated' marks the machine's
 *  own output. Self refs may steer/repair; only AUTHENTIC refs certify (anti-mirror). */
async function fetchGenreMeasuredDetailed(workspaceId: string, genre: string): Promise<Array<{ analysis: MeasuredAnalysis; authentic: boolean }>> {
  const rows = await prisma.soundReference.findMany({
    where: {
      workspaceId,
      active: true,
      analysisState: 'measured',
      rightsBasis: { not: 'unknown' },
      NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }],
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { genre: true, sourceUrl: true, recipe: true, rightsBasis: true },
  });
  const out: Array<{ analysis: MeasuredAnalysis; authentic: boolean }> = [];
  for (const r of rows) {
    if (!genreMatches(r.genre, genre)) continue;
    const rec = (r.recipe ?? {}) as { measured?: MeasuredAnalysis; source?: string };
    if (!rec.measured?.engineOk) continue;
    const origin = referenceOrigin(r.sourceUrl, rec, r.rightsBasis);
    if (origin === 'unknown') continue;
    out.push({ analysis: rec.measured, authentic: origin === 'owned-upload' || origin === 'facts-only' });
  }
  return out;
}

export async function authenticRefCount(workspaceId: string, genre?: string | null): Promise<number> {
  if (!genre) return 0;
  return (await fetchGenreMeasuredDetailed(workspaceId, genre)).filter((m) => m.authentic).length;
}

export async function loadProfileFor(workspaceId: string, genre: string) {
  const detailed = await fetchGenreMeasuredDetailed(workspaceId, genre);
  const authenticRefs = detailed.filter((m) => m.authentic).length;
  // ADDENDUM C-2 — grounding rule: a lane profile exists only when grounded in
  // ≥3 NON-SELF refs; self measurements join only then (never bootstrap a lane
  // from the machine's own output).
  if (authenticRefs < 3) return { profile: null, refs: detailed.length, authenticRefs };
  const measured = [...detailed.filter((m) => m.authentic), ...detailed.filter((m) => !m.authentic)].map((m) => m.analysis);
  const profile = buildLaneProfile(genre, 'genre', measured, { minRefs: 3 });
  return Object.keys(profile.features).length
    ? { profile, refs: measured.length, authenticRefs }
    : { profile: null, refs: measured.length, authenticRefs };
}

// ---------- §10 step 3: classify against ALL profiled lanes ----------
export interface LaneDistributionEntry { lane: string; overall: number; coverage: number; pct: number }

/** Score one MeasuredAnalysis against every lane that has a real profile and
 *  report the DISTRIBUTION (the doc's "52% amapiano · 31% afrobeats · 17% house"),
 *  never just the target. Lanes without ≥3 measured refs are honestly listed as
 *  unprofiled — the ear cannot judge a lane it has never heard. */
export async function classifyAllLanes(workspaceId: string, analysis: MeasuredAnalysis): Promise<{ distribution: LaneDistributionEntry[]; unprofiled: string[] }> {
  const scoredLanes: Array<{ lane: string; score: LaneComplianceScore }> = [];
  const unprofiled: string[] = [];
  for (const g of GENRES) {
    const { profile } = await loadProfileFor(workspaceId, g);
    if (!profile) { unprofiled.push(g); continue; }
    try { scoredLanes.push({ lane: g, score: scoreLaneCompliance(analysis, profile) }); }
    catch { unprofiled.push(g); }
  }
  const sum = scoredLanes.reduce((s, l) => s + Math.max(0, l.score.overall), 0) || 1;
  const distribution = scoredLanes
    .map((l) => ({ lane: l.lane, overall: l.score.overall, coverage: l.score.coverage, pct: Math.round((Math.max(0, l.score.overall) / sum) * 100) }))
    .sort((a, b) => b.overall - a.overall);
  return { distribution, unprofiled };
}

// ---------- §11 — lane lexicon readiness ----------
/** Languages each lane PRESCRIBES (from the Sound-DNA prose, made structural here).
 *  Unknown lanes prescribe nothing — no false blocks. */
const LANE_LANGUAGES: Record<string, string[]> = {
  amapiano: ['zu', 'xh', 'st', 'tn', 'tsotsitaal'],
  afrobeats: ['yo', 'pcm', 'en'],
  afro_fusion: ['yo', 'pcm', 'en'],
  street_pop: ['yo', 'pcm'],
  afro_gospel: ['yo', 'ig', 'en'],
  gospel: ['en', 'yo', 'ig'],
  highlife: ['ig', 'en'],
  afro_rnb: ['en', 'pcm'],
};
const THIN_LEXICON = 20; // matches the boot assertion in lib/lexicon.ts

export async function unseededForLane(genre?: string | null): Promise<string[]> {
  const langs = LANE_LANGUAGES[norm(genre)] ?? [];
  if (!langs.length) return [];
  try {
    const byLang = await prisma.lexiconEntry.groupBy({ by: ['language'], where: { workspaceId: null }, _count: true });
    const counts = new Map<string, number>(
      byLang.map((l: { language: string; _count: unknown }): [string, number] => [l.language, l._count as unknown as number])
    );
    return langs.filter((l) => (counts.get(l) ?? 0) < THIN_LEXICON);
  } catch { return []; } // lexicon table absent on first boot — never block on infra
}

// ---------- §9 — the report block ----------
type Prov = { p?: string; reason?: string | null };
function unknownReasons(a: MeasuredAnalysis): Array<{ field: string; reason: string }> {
  const out: Array<{ field: string; reason: string }> = [];
  for (const [k, v] of Object.entries(a as unknown as Record<string, Prov | unknown>)) {
    const pv = v as Prov;
    if (pv && typeof pv === 'object' && pv.p === 'unknown') out.push({ field: k, reason: pv.reason ?? 'not measured' });
  }
  return out;
}

export interface LaneReport {
  available: boolean;
  reason?: string;
  song?: { id: string; title: string };
  targetLane?: string;
  distribution?: LaneDistributionEntry[];
  unprofiledLanes?: string[];
  laneScore?: number | null;
  coverage?: string; // "8 measured / 2 unknown"
  rankedBy?: string | null;
  blueprintMatch?: number | null;
  profileTier?: 'authentic' | 'self-trained' | 'unprofiled';
  authenticRefs?: number;
  engine?: { name: string; adequate: boolean; note?: string; recommended?: string };
  strongest?: Array<{ key: string; match: number }>;
  weakest?: Array<{ key: string; match: number; critical: boolean }>;
  keep?: string[];
  replace?: string[];
  repair?: RepairPlan | null;
  repairSummary?: string;
  complianceSummary?: string;
  unknowns?: Array<{ field: string; reason: string }>;
  releaseGate?: { creative: ReturnType<typeof laneReleaseGate>; hitmaker: ReturnType<typeof laneReleaseGate> };
  lexiconUnseeded?: string[];
}

export async function buildLaneReport(workspaceId: string, songId: string): Promise<LaneReport> {
  const song = await prisma.song.findFirst({
    where: { id: songId, workspaceId },
    select: { id: true, title: true, project: { select: { genre: true } } },
  });
  if (!song) return { available: false, reason: 'song not found' };
  // NB: BeatAsset carries no workspaceId column — ownership is enforced by the
  // song query above (Song.workspaceId); the beat is scoped through its song.
  const beat = await prisma.beatAsset.findFirst({
    where: { songId },
    orderBy: { createdAt: 'desc' },
    select: { provider: true, meta: true },
  });
  const meta = (beat?.meta ?? {}) as {
    measured?: MeasuredAnalysis;
    bestOf?: { rankedBy?: string; laneScore?: number | null; engineNote?: string; blueprintMatch?: number | null };
    qc?: { verdict?: string; flags?: string[] };
    assessedGenre?: string;
  };
  const targetLane = meta.assessedGenre ?? song.project.genre ?? 'afrobeats';
  const lexiconUnseeded = await unseededForLane(targetLane);

  if (!beat || !meta.measured) {
    // Honest §9: the ear has not heard this song — say exactly why, never guess.
    return {
      available: false,
      reason: !beat ? 'no rendered take yet' : 'this take was rendered before the ear went live — regenerate (or re-master) to measure it',
      song: { id: song.id, title: song.title },
      targetLane,
      lexiconUnseeded,
      releaseGate: {
        creative: laneReleaseGate({ compliance: null, qc: (meta.qc ?? null) as never, mode: 'creative', lexicon: { unseeded: lexiconUnseeded } }),
        hitmaker: laneReleaseGate({ compliance: null, qc: (meta.qc ?? null) as never, mode: 'hitmaker', lexicon: { unseeded: lexiconUnseeded } }),
      },
    };
  }

  const { profile, refs, authenticRefs } = await loadProfileFor(workspaceId, targetLane);
  const capabilities = await musicRouteCapabilities(workspaceId);
  const recommendation = recommendEngine(targetLane, {
    firstParty: capabilities.firstParty,
    sunoAvailable: capabilities.flagship,
    elevenAvailable: capabilities.advanced,
    replicateAvailable: capabilities.standard,
  });
  const [{ distribution, unprofiled }, freshScore] = await Promise.all([
    classifyAllLanes(workspaceId, meta.measured),
    Promise.resolve(profile ? scoreLaneCompliance(meta.measured, profile) : null),
  ]);
  const repair = freshScore ? planRepairs(freshScore) : null;
  const dims = freshScore?.dimensions ?? [];
  const strongest = [...dims].sort((a, b) => b.match - a.match).slice(0, 2).map((d) => ({ key: d.key, match: Math.round(d.match * 100) }));
  const weakest = [...dims].sort((a, b) => a.match - b.match).slice(0, 3).map((d) => ({ key: d.key, match: Math.round(d.match * 100), critical: d.identity }));
  const keep = dims.filter((d) => d.match >= 0.7).map((d) => d.key);
  const replace = (repair?.repairs ?? []).map((r) => r.key);
  const adequacy = beat.provider === 'afrohit-own' || beat.provider === 'material'
    ? { adequate: true, note: 'owned composition engine (afrohit-own-v1) — built from our material, not prompted from a black box' }
    : engineAdequacy(beat.provider, targetLane);
  // WO-6(a): certify the MASTERED artifact when one exists — its measured QC
  // outranks the pre-master take's (what ships is what gets certified).
  const latestMaster = await prisma.master.findFirst({ where: { songId }, orderBy: { createdAt: 'desc' }, select: { meta: true } });
  const masterQc = ((latestMaster?.meta ?? {}) as { qc?: unknown }).qc ?? null;
  const gateInput = {
    compliance: freshScore ? { overall: freshScore.overall, coverage: freshScore.coverage, drift: freshScore.drift, failedCritical: freshScore.failedCritical } : null,
    qc: (masterQc ?? meta.qc ?? null) as never,
    lexicon: { unseeded: lexiconUnseeded },
    profile: { authenticRefs, required: 3 },
  };

  return {
    available: true,
    song: { id: song.id, title: song.title },
    targetLane,
    distribution,
    unprofiledLanes: unprofiled,
    profileTier: !profile ? 'unprofiled' : authenticRefs >= 3 ? 'authentic' : 'self-trained',
    authenticRefs,
    laneScore: freshScore?.overall ?? meta.bestOf?.laneScore ?? null,
    coverage: freshScore ? `${freshScore.scored} measured / ${freshScore.skipped.length} unknown` : profile ? 'scored 0' : `lane unprofiled (${refs}/3 measured refs)`,
    rankedBy: meta.bestOf?.rankedBy ?? null,
    blueprintMatch: meta.bestOf?.blueprintMatch ?? null,
    // §1.11 THE WALL: the lane report is a USER surface — it names the engine
    // CLASS, never the vendor. Real names live behind /admin only.
    engine: {
      name: engineClass(beat.provider ?? 'stub'),
      adequate: adequacy.adequate,
      note: adequacy.note ?? meta.bestOf?.engineNote,
      recommended: engineClass(recommendation.engine),
    },
    strongest,
    weakest,
    keep,
    replace,
    repair,
    repairSummary: repair ? describeRepairPlan(repair) : undefined,
    complianceSummary: freshScore ? describeCompliance(freshScore) : undefined,
    unknowns: unknownReasons(meta.measured),
    releaseGate: {
      creative: laneReleaseGate({ ...gateInput, mode: 'creative' }),
      hitmaker: laneReleaseGate({ ...gateInput, mode: 'hitmaker' }),
    },
    lexiconUnseeded,
  };
}

// ---------- §10 — the repair-route table (the doc's table, executable) ----------
export interface AdjustRoute {
  route: 'rebuild_beat_material' | 'rerender_steered' | 'remix_only' | 'rewrite_hook';
  reason: string;
  preserves: string[];
  endpoint: string; // the EXISTING endpoint execute() dispatches to — disclosed, never hidden
}

export function planAdjustRoutes(report: LaneReport): AdjustRoute[] {
  const routes: AdjustRoute[] = [];
  const failed = report.repair?.repairs ?? [];
  const drift = report.repair?.driftSeverity === 'major';
  const beatKeys = ['logDrum', 'log_drum', 'bass', 'fourOnFloor', 'swing', 'shaker', 'drums', 'syncopation', 'bpm'];
  const beatFail = failed.some((r) => beatKeys.some((k) => r.key.toLowerCase().includes(k.toLowerCase())));
  if (drift || (beatFail && failed.some((r) => r.severity === 'critical'))) {
    routes.push({
      route: 'rebuild_beat_material',
      reason: drift ? 'wrong lane / major drift — rebuild the beat from real material' : `critical rhythm element failed (${report.replace?.join(', ')})`,
      preserves: ['hook', 'lyrics', 'vocal'],
      endpoint: 'POST /api/v1/materials/auto',
    });
  }
  if (failed.length && !drift) {
    routes.push({
      route: 'rerender_steered',
      reason: 'in-lane but off-target — re-render with the measured repair steering injected',
      preserves: ['lyrics', 'hook (re-sung)'],
      endpoint: 'POST /api/v1/songs/:id/regenerate-beat',
    });
  }
  if (report.releaseGate?.creative.checks.some((c) => c.name === 'audio quality' && c.status !== 'pass')) {
    routes.push({ route: 'remix_only', reason: 'mix/master weakness — audio chain only, nothing regenerated', preserves: ['everything musical'], endpoint: 'POST /api/v1/songs/:id/master' });
  }
  if ((report.weakest ?? []).some((w) => w.key.toLowerCase().includes('hook'))) {
    routes.push({ route: 'rewrite_hook', reason: 'weak hook — rewrite the hook only', preserves: ['beat', 'arrangement'], endpoint: 'POST /api/v1/projects/:projectId/hooks' });
  }
  if (!routes.length) {
    routes.push({ route: 'rerender_steered', reason: 'no diagnosed failure — a steered re-take is the only sensible spend', preserves: ['lyrics'], endpoint: 'POST /api/v1/songs/:id/regenerate-beat' });
  }
  return routes;
}
