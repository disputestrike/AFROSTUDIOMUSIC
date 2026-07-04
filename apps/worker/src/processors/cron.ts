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
import { prisma } from '@afrohit/db';
import { prompts, responsesJson, scoreItems } from '@afrohit/ai';
import { debitCredits } from '../lib/credits';
import { jobDoneEmail, morningDropEmail, releaseRadarEmail, sendEmail } from '../lib/email';

const MORNING_DROP_COUNT = 20;

async function ownerEmail(workspaceId: string): Promise<string | null> {
  const owner = await prisma.workspaceMember.findFirst({
    where: { workspaceId, role: 'OWNER' },
    include: { user: { select: { email: true } } },
  });
  return owner?.user.email ?? null;
}

export async function processMorningDrop() {
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
      });
      if (!charge.ok) {
        console.log(`[morning-drop] skip ${artist.stageName} — insufficient credits`);
        continue;
      }

      // Taste memory — same feedback loop as interactive generation.
      const [approved, rejected] = await Promise.all([
        prisma.artistMemoryChunk.findMany({
          where: { artistId: artist.id, kind: 'approved' },
          orderBy: { createdAt: 'desc' }, take: 15, select: { content: true },
        }),
        prisma.artistMemoryChunk.findMany({
          where: { artistId: artist.id, kind: 'rejected' },
          orderBy: { createdAt: 'desc' }, take: 15, select: { content: true },
        }),
      ]);

      const result = await responsesJson<{
        hooks: Array<{ text: string; language?: string[]; bpm?: number }>;
      }>({
        system: prompts.HOOK_SYSTEM,
        user: prompts.hookUserPrompt({
          artist: artist as never,
          brief: project.briefs[0] as never,
          count: MORNING_DROP_COUNT,
          tasteMemory: {
            approvedExamples: approved.map((c) => c.content),
            rejectedExamples: rejected.map((c) => c.content),
          },
        }),
        temperature: 0.95,
        maxOutputTokens: 4_000,
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
        items: created.map((h) => ({ id: h.id, text: h.text, kind: 'hook' as const })),
      });
      await Promise.all(
        scores.map((s) =>
          prisma.hookCandidate.update({ where: { id: s.id }, data: { score: s.overall } })
        )
      );

      const top = created
        .map((h) => ({ text: h.text, score: scores.find((s) => s.id === h.id)?.overall ?? null }))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 10);

      const to = await ownerEmail(artist.workspaceId);
      if (to) {
        const tpl = morningDropEmail(artist.stageName, top);
        await sendEmail({ to, ...tpl });
      }
      console.log(`[morning-drop] ${artist.stageName}: ${created.length} hooks, emailed=${!!to}`);
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
      await sendEmail({ to, ...tpl });
    } catch (err) {
      console.error(`[release-radar] failed for workspace ${workspaceId}:`, err);
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
    await sendEmail({ to, ...tpl });
  } catch (err) {
    console.error(`[notify] failed for job ${jobId}:`, err);
  }
}
