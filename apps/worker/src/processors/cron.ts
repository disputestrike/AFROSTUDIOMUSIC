/**
 * Scheduled automation:
 *
 *  Morning Drop (daily 05:00 UTC) — for every artist with morningDrop=true:
 *    generate 20 hooks against their DNA + taste memory, score them,
 *    persist, and email the workspace owner the top 10.
 *
 *  Release Radar (weekly Mon 07:00 UTC) — for every workspace with share
 *    events in the past 7 days: aggregate country counts, email a digest.
 *
 * Both are best-effort per workspace — one failing artist never blocks the rest.
 */
import { prisma, isAutonomyEnabled } from '@afrohit/db';
import { GENRES, rankMemoryCandidates } from '@afrohit/shared';
import { prompts, generateJson, runWithBrainContext, scoreItems, researchTrends, extractSongCraft, parseTrendSong, embed } from '@afrohit/ai';
import { debitCredits } from '../lib/credits';
import { jobDoneEmail, morningDropEmail, releaseRadarEmail, sendEmail } from '../lib/email';

// Owner law (2026-07-12): 3 deep hooks, not 20 shallow drafts — same
// concentration doctrine as the interactive paths.
const MORNING_DROP_COUNT = 3;

async function ownerEmail(workspaceId: string): Promise<string | null> {
  const owner = await prisma.workspaceMember.findFirst({
    where: { workspaceId, role: 'OWNER' },
    include: { user: { select: { email: true } } },
  });
  return owner?.user.email ?? null;
}

export async function processMorningDrop() {
  // NIGHT LAW (owner): overnight work never burns taste rates — the WHOLE run
  // is bulk-brained (Cerebras-first on every call; the ladder stays as safety).
  return runWithBrainContext({ forceTier: 'bulk', runId: 'morning-drop' }, morningDropRun);
}
async function morningDropRun() {
  if (!(await isAutonomyEnabled('morning_drop'))) { console.log('[morning-drop] disabled by operator (autonomy off) — skipped'); return; }
  const artists = await prisma.artist.findMany({
    where: { morningDrop: true, workspace: { suspendedAt: null, deletedAt: null } },
    include: { workspace: { select: { id: true } } },
  });
  console.log(`[morning-drop] ${artists.length} artist(s) enrolled`);

  for (const artist of artists) {
    try {
      // Most recent project for this artist gets the drop. No project → skip.
      const project = await prisma.project.findFirst({
        where: { artistId: artist.id },
        orderBy: { updatedAt: 'desc' },
        include: { briefs: { take: 1, orderBy: { createdAt: 'desc' } } },
      });
      if (!project) continue;

      const charge = await debitCredits({
        workspaceId: artist.workspaceId,
        key: 'hooks_batch_20',
        reasonSuffix: 'morning_drop',
        idempotencyKey: `morning-drop:${new Date().toISOString().slice(0, 10)}:${artist.id}`,
      });
      if (!charge.ok) {
        console.log(`[morning-drop] skip ${artist.stageName} — insufficient credits`);
        continue;
      }

      // Taste memory — same feedback loop as interactive generation.
      const memoryQuery = JSON.stringify({
        genre: project.genre,
        languages: artist.languages,
        brief: project.briefs[0],
      });
      const [approved, rejected] = await Promise.all([
        prisma.artistMemoryChunk.findMany({
          where: {
            workspaceId: artist.workspaceId,
            artistId: artist.id,
            kind: 'approved',
          },
          orderBy: { createdAt: 'desc' },
          take: 90,
          select: { content: true, embedding: true, createdAt: true },
        }),
        prisma.artistMemoryChunk.findMany({
          where: {
            workspaceId: artist.workspaceId,
            artistId: artist.id,
            kind: 'rejected',
          },
          orderBy: { createdAt: 'desc' },
          take: 90,
          select: { content: true, embedding: true, createdAt: true },
        }),
      ]);
      const memoryRows = [...approved, ...rejected];
      const queryEmbedding = memoryRows.some((row) => Array.isArray(row.embedding))
        ? await embed(memoryQuery.slice(0, 4_000)).catch(() => null)
        : null;
      const selectMemory = (rows: typeof approved) =>
        rankMemoryCandidates({
          candidates: rows,
          query: memoryQuery,
          queryEmbedding,
          limit: 15,
        }).map((row) => row.content);
      const tasteMemory = {
        approvedExamples: selectMemory(approved),
        rejectedExamples: selectMemory(rejected),
      };
      await prisma.analyticsEvent.create({
        data: {
          workspaceId: artist.workspaceId,
          name: 'artist_memory.recall',
          properties: {
            artistId: artist.id,
            source: 'morning_drop',
            mode: queryEmbedding ? 'hybrid_semantic' : 'lexical_recency',
            candidateCount: memoryRows.length,
            approvedReturned: tasteMemory.approvedExamples.length,
            rejectedReturned: tasteMemory.rejectedExamples.length,
          } as never,
        },
      }).catch(() => undefined);

      // NIGHT LAW: overnight hook drafts ride the bulk brain (the run wrapper
      // forces it anyway — this call also declares it for the economics log).
      const result = await generateJson<{
        hooks: Array<{ text: string; language?: string[]; bpm?: number }>;
      }>({
        tier: 'bulk',
        task: 'morning-drop-hooks',
        system: prompts.HOOK_SYSTEM,
        user: prompts.hookUserPrompt({
          artist: artist as never,
          brief: project.briefs[0] as never,
          count: MORNING_DROP_COUNT,
          tasteMemory,
        }),
        temperature: 0.95,
        maxTokens: 4_000,
      });

      const created = await prisma.$transaction(
        (result.hooks ?? []).map((h) =>
          prisma.hookCandidate.create({
            data: {
              projectId: project.id,
              text: h.text,
              language: (h.language ?? []) as never,
              bpm: h.bpm,
              meta: { source: 'morning_drop' } as never,
            },
          })
        )
      );

      const scores = await scoreItems({
        artist: artist as never,
        items: created.map((h: { id: string; text: string }) => ({ id: h.id, text: h.text, kind: 'hook' as const })),
      });
      await Promise.all(
        scores.map((s) =>
          prisma.hookCandidate.update({ where: { id: s.id }, data: { score: s.overall } })
        )
      );

      const top = created
        .map((h: { id: string; text: string }) => ({ text: h.text, score: scores.find((s) => s.id === h.id)?.overall ?? null }))
        .sort((a: { score: number | null }, b: { score: number | null }) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 10);

      const to = await ownerEmail(artist.workspaceId);
      let emailStatus = 'no_recipient';
      if (to) {
        const tpl = morningDropEmail(artist.stageName, top);
        const delivery = await sendEmail({ to, ...tpl });
        emailStatus = delivery.ok
          ? 'sent'
          : delivery.skipped
            ? 'not_configured'
            : 'failed';
      }
      console.log(`[morning-drop] ${artist.stageName}: ${created.length} hooks, email=${emailStatus}`);
    } catch (err) {
      console.error(`[morning-drop] failed for artist ${artist.id}:`, err);
    }
  }
}

export async function processReleaseRadar() {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = await prisma.shareEvent.groupBy({
    by: ['workspaceId', 'country'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  const byWorkspace = new Map<string, Array<{ country: string | null; events: number }>>();
  for (const r of rows) {
    const list = byWorkspace.get(r.workspaceId) ?? [];
    list.push({ country: r.country, events: r._count._all });
    byWorkspace.set(r.workspaceId, list);
  }
  console.log(`[release-radar] ${byWorkspace.size} workspace(s) with activity`);

  for (const [workspaceId, countries] of byWorkspace) {
    try {
      const to = await ownerEmail(workspaceId);
      if (!to) continue;
      const sorted = countries.sort((a, b) => b.events - a.events);
      const tpl = releaseRadarEmail(sorted);
      const delivery = await sendEmail({ to, ...tpl });
      if (!delivery.ok) {
        console.warn(`[release-radar] email not sent for workspace ${workspaceId}: ${delivery.error}`);
      }
    } catch (err) {
      console.error(`[release-radar] failed for workspace ${workspaceId}:`, err);
    }
  }
}

/**
 * ZAP RADAR (daily, off-peak) — Zap runs on its own: pull the CURRENT charts
 * (keyless via Apple most-played — no AudD key needed for this; that's only for
 * fingerprinting audio you play at it), and for each NEW trending song learn its
 * uncopyrightable CRAFT into the lake. So training keeps compounding 24/7 even
 * when nobody's looking. Doctrine-clean: charts are METADATA (titles/artists),
 * the learn is craft/facts (artist as LANE, never a copy), no recording touched.
 * Tightly capped so it never runs up the budget or interferes with anything.
 */
const RADAR_GENRES = ['afrobeats', 'amapiano', 'afro_fusion', 'afro_pop', 'street_pop'];
// With ZAP_RUNS_PER_DAY runs/day, rotate 5-genre slices of the FULL genre map so
// every lane in the world/continent gets radar coverage daily, cost still bounded.
function radarSlice(): string[] {
  const runs = Math.max(1, Math.min(12, parseInt(process.env.ZAP_RUNS_PER_DAY ?? '4', 10) || 4));
  const pool = [...GENRES] as string[];
  const chunk = 5;
  const slot = Math.floor(new Date().getUTCHours() / Math.max(1, Math.floor(24 / runs)));
  const idx = slot % Math.ceil(pool.length / chunk);
  const slice = pool.slice(idx * chunk, idx * chunk + chunk);
  return slice.length ? slice : RADAR_GENRES;
}
const RADAR_MAX_PER_RUN = Number(process.env.ZAP_RADAR_MAX ?? 10);

export async function processZapRadar() {
  // NIGHT LAW: radar craft/lessons are bulk-brained end to end.
  return runWithBrainContext({ forceTier: 'bulk', runId: 'zap-radar' }, zapRadarRun);
}
async function zapRadarRun() {
  if (!(await isAutonomyEnabled('zap_radar'))) { console.log('[zap-radar] disabled by operator (autonomy off) — skipped'); return; }
  const { backgroundLlmBudgetOk } = await import('./compound');
  if (!(await backgroundLlmBudgetOk('zap-radar'))) return;
  const workspaces = await prisma.workspace.findMany({
    where: { suspendedAt: null, deletedAt: null },
    select: { id: true },
    take: 50,
  });
  for (const ws of workspaces) {
    let learned = 0;
    try {
      for (const genre of radarSlice()) {
        if (learned >= RADAR_MAX_PER_RUN) break;
        const trends = await researchTrends({ genre }).catch(() => null);
        // ONLY learn from real SONG charts (Apple most-played / YouTube). When those
        // have no chart for a genre, researchTrends falls back to web/news — those
        // are ARTICLE HEADLINES, not songs, and would poison the lake. Skip them.
        if (!trends || (trends.source !== 'apple_charts' && trends.source !== 'youtube')) continue;
        const songs = (trends.sources ?? [])
          .map((s) => parseTrendSong(s.title))
          // A real chart entry has an artist ("Title — Artist"); headlines don't.
          .filter((x): x is { title: string; artist: string } => !!x?.artist);
        for (const song of songs) {
          if (learned >= RADAR_MAX_PER_RUN) break;
          const marker = `zap:${`${song.artist ?? ''}-${song.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80)}`;
          const exists = await prisma.soundReference.findFirst({ where: { workspaceId: ws.id, sourceUrl: marker }, select: { id: true } });
          if (exists) continue; // already zapped — free, no re-learn
          // Budget guard — a cheap debit; if the daily cap is hit, stop this run.
          const charge = await debitCredits({
            workspaceId: ws.id,
            key: 'brief_polish',
            reasonSuffix: 'zap_radar',
            idempotencyKey: `zap-radar:${marker}`,
          });
          if (!charge.ok) { learned = RADAR_MAX_PER_RUN; break; }
          const craft = await extractSongCraft({ title: song.title, artist: song.artist, genre });
          if (!craft?.craft?.length) continue;
          await prisma.soundReference
            .create({
              data: {
                workspaceId: ws.id,
                genre,
                sourceUrl: marker,
                title: `Zap radar · ${genre} lane — "${song.title}" (${song.artist ?? '—'})`,
                recipe: { source: 'zap', radar: true, title: song.title, artist: song.artist, genre, craft: craft.craft, vibe: craft.vibe } as never,
                summary: (craft.whatToLearn || craft.vibe || '').slice(0, 400),
              },
            })
            .catch(() => {});
          learned++;
        }
      }
      console.log(`[zap-radar] ws ${ws.id}: learned ${learned} new trending song(s) into the lake`);
    } catch (err) {
      console.error(`[zap-radar] failed for ws ${ws.id}:`, err);
    }
  }
}

/**
 * Job-completion notification — called from the worker's completed path for
 * user-visible render kinds. Best-effort.
 */
export async function notifyJobDone(jobId: string) {
  try {
    const job = await prisma.providerJob.findUnique({
      where: { id: jobId },
      include: { project: { select: { title: true } } },
    });
    if (!job || job.status !== 'SUCCEEDED') return;
    if (!['music', 'voice', 'video', 'export'].includes(job.kind)) return;
    const to = await ownerEmail(job.workspaceId);
    if (!to) return;
    const out = job.outputJson as Record<string, unknown> | null;
    const url =
      (out?.url as string | undefined) ??
      ((out?.bundle as Record<string, unknown> | undefined)?.mp3 as string | undefined) ??
      null;
    const tpl = jobDoneEmail(job.kind, job.project?.title ?? null, url);
    const delivery = await sendEmail({ to, ...tpl });
    if (!delivery.ok) {
      console.warn(`[notify] email not sent for job ${jobId}: ${delivery.error}`);
    }
  } catch (err) {
    console.error(`[notify] failed for job ${jobId}:`, err);
  }
}
