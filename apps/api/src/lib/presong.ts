/**
 * PRE-SONG INTELLIGENCE (ported pattern: CrucibAI's brain_build_dna recall —
 * the one learning loop there that provably worked: record outcome, recall
 * priors on the next similar job).
 *
 * Before a new song renders, recall what the studio's OWN past winners and
 * losers in this lane/mood teach, and hand the writers a compact briefing.
 * LAWS: best-effort and non-blocking (a recall failure never delays a render —
 * cost optimization, not a truth gate); built ONLY from stored measurements
 * (laneScore/hitScore — never invented); injected via fuseSoundDna's `extra`
 * slot so it can never crowd out the identity briefs; and its use is PROVABLE
 * (an AnalyticsEvent 'presong.recall' row per injection — the moat-is-a-
 * docstring test: a learning feature exists only when a write in session A
 * measurably shapes session B).
 */
import { prisma } from '@afrohit/db';

const norm = (g?: string | null) => (g ?? '').toLowerCase().trim().replace(/[\s/-]+/g, '_');

// Written by the nightly report card (worker compound.ts REPORT_CARD_GAPS_KEY).
const REPORT_CARD_GAPS_KEY = 'reportcard:gaps:v1';

// Turn the nightly report card's measured lane gaps into a generation steer.
// This is the studio-wide half of the learn->feed loop: presongIntelligence
// only speaks when a WORKSPACE has >=3 of its own scored songs, so a brand-new
// account learns nothing from its own (empty) catalog. The house report card
// closes that — the identity dimensions the ear keeps scoring weak across the
// whole studio in this lane become an explicit "prioritize fixing these"
// instruction on the very first take. Best-effort; never blocks a render.
export async function houseGapBrief(genre?: string | null): Promise<string> {
  try {
    if (!genre) return '';
    const row = await prisma.systemSetting.findUnique({ where: { key: REPORT_CARD_GAPS_KEY } });
    if (!row?.value) return '';
    const map = JSON.parse(String(row.value)) as Record<
      string,
      { avg?: number; takes?: number; gaps?: string[]; at?: string }
    >;
    // Report card keys by raw project.genre; match by normalized genre so
    // "Afrobeats"/"afrobeats"/"afro-beats" all resolve to the same lane.
    const want = norm(genre);
    const hit = Object.entries(map).find(([k]) => norm(k) === want)?.[1];
    const gaps = (hit?.gaps ?? []).filter(Boolean).slice(0, 3);
    if (!gaps.length) return '';
    const readable = gaps.map((g) => g.replace(/_/g, ' ')).join(', ');
    return `STUDIO REPORT CARD — recent ${genre.replace(/_/g, ' ')} takes across the house keep scoring weak on: ${readable}. Make these unmistakably right in this record.`;
  } catch {
    return '';
  }
}

// Shape of the `select` on prisma.song.findMany below (shim types @afrohit/db as any).
type ScoredSong = {
  title: string;
  laneScore: number | null;
  hitScore: number | null;
  laneGaps: unknown;
  lyric: { title: string | null } | null;
  project: { genre: string | null; bpm: number | null } | null;
};

export async function presongIntelligence(workspaceId: string, genre?: string | null, mood?: string | null): Promise<string> {
  try {
    if (!genre) return '';
    const songs = await prisma.song.findMany({
      where: { workspaceId, OR: [{ laneScore: { not: null } }, { hitScore: { not: null } }] },
      orderBy: { createdAt: 'desc' },
      take: 120,
      select: {
        title: true, laneScore: true, hitScore: true, laneGaps: true,
        lyric: { select: { title: true } },
        project: { select: { genre: true, bpm: true } },
      },
    });
    // Studio-wide report-card steer — delivered even to a brand-new workspace
    // that has no scored catalog of its own to learn from yet.
    const houseLine = await houseGapBrief(genre);
    const lane = songs.filter((s: ScoredSong) => norm(s.project?.genre) === norm(genre));
    if (lane.length < 3) return houseLine; // too little OWN history — fall back to the house's learned gaps
    const winners = lane.filter((s: ScoredSong) => (s.laneScore ?? 0) >= 80 || (s.hitScore ?? 0) >= 70).slice(0, 5);
    const losers = lane.filter((s: ScoredSong) => s.laneScore != null && s.laneScore < 40).slice(0, 4);
    if (!winners.length && !losers.length) return houseLine;

    const parts: string[] = [`PRESONG INTELLIGENCE — measured lessons from YOUR own ${genre.replace(/_/g, ' ')} catalog (${lane.length} scored songs), not theory:`];
    if (winners.length) {
      const bpms = winners.map((w: ScoredSong) => w.project?.bpm).filter((b: number | null | undefined): b is number => !!b);
      const bpmLine = bpms.length ? ` Tempos that worked: ${Math.min(...bpms)}–${Math.max(...bpms)} bpm.` : '';
      const hooks = winners.map((w: ScoredSong) => `“${(w.lyric?.title || w.title).slice(0, 42)}” (lane ${w.laneScore ?? '—'}${w.hitScore ? `, A&R ${w.hitScore}` : ''})`).slice(0, 3);
      parts.push(`WINNERS:${bpmLine} Titles/hooks that scored: ${hooks.join('; ')}. Channel what made these land — do NOT copy their words.`);
    }
    if (losers.length) {
      const gapKeys = new Map<string, number>();
      for (const l of losers) {
        const gaps = ((l.laneGaps ?? {}) as { failedCritical?: string[] }).failedCritical ?? [];
        for (const g of gaps) gapKeys.set(g, (gapKeys.get(g) ?? 0) + 1);
      }
      const common = [...gapKeys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} (${n}×)`);
      if (common.length) parts.push(`AVOID (what sank past takes here): ${common.join(', ')}.`);
    }
    if (houseLine) parts.push(houseLine);
    const brief = parts.join('\n').slice(0, 900);
    // The receipt — recall is real only if it's recorded and inspectable.
    await prisma.analyticsEvent.create({
      data: { workspaceId, name: 'presong.recall', properties: { genre, mood, winners: winners.length, losers: losers.length, chars: brief.length } as never },
    }).catch(() => undefined);
    return brief;
  } catch {
    return ''; // never blocks a render
  }
}
