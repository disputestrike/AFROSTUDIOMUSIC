/**
 * AI-AUTOMATIC MATERIAL BEAT — "let AI run this part."
 *
 * Benjamin's point: the artist should not have to manually Forge a kit and then
 * Assemble. The AI should look at the song, forge whatever the genre's kit is
 * missing, and assemble the exact beat — in the backend, in one action. This is
 * that orchestrator: check the shelf → forge the missing roles (staggered for the
 * Replicate throttle) → detached, wait for the loops to land → arrange + assemble.
 * Shared by the REST /materials/auto route and the make_material_beat chat tool.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '@afrohit/db';
import { getSoundDNA } from '@afrohit/ai';
import { enqueue } from './queue';
import { kitRolesFor, homeKeyFor, pickMaterial, claudeArrangement, type MaterialRow, type MaterialPick } from './material-plan';
import { loadLaneProfileForGenre } from './lane-context';
import { laneMaterialNeeds } from '@afrohit/shared';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadShelf(workspaceId: string, genre: string): Promise<MaterialRow[]> {
  return prisma.materialAsset.findMany({
    where: { workspaceId, genre },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, url: true, role: true, bpm: true, keySignature: true, source: true },
  });
}

async function assembleFrom(
  app: FastifyInstance,
  workspaceId: string,
  projectId: string,
  genre: string,
  bpm: number,
  keySignature: string,
  vibe: string | undefined,
  songId: string | undefined,
  picks: MaterialPick[]
): Promise<string> {
  const sections = await claudeArrangement(genre, bpm, picks.map((p) => p.role), vibe);
  const job = await prisma.providerJob.create({
    data: { workspaceId, projectId, kind: 'music', provider: 'material', status: 'QUEUED', inputJson: { assemble: true, genre, bpm, keySignature, vibe, songId, picks: picks.map((p) => p.role), sections } as never },
  });
  await enqueue({ queue: app.queues.music, name: 'assemble-beat', payload: { jobId: job.id, workspaceId, projectId, songId, bpm, genre, picks, sections } });
  return job.id;
}

export interface AutoMaterialOpts {
  projectId: string;
  genre: string;
  bpm?: number;
  keySignature?: string;
  vibe?: string;
  songId?: string;
}

/**
 * Forge the genre's missing kit roles near this bpm, then assemble the exact beat.
 * Returns immediately: 'assembling' if the shelf was already stocked, or 'forging'
 * (with a detached waiter that assembles once the loops land). Never throws to the
 * caller — the detached half logs and gives up cleanly.
 */
export async function autoMaterialBeat(app: FastifyInstance, workspaceId: string, opts: AutoMaterialOpts) {
  const bpm = opts.bpm ?? getSoundDNA(opts.genre)?.typicalBpm ?? 108;
  const keySignature = opts.keySignature ?? homeKeyFor(opts.genre);

  // §6 — roles come from the MEASURED lane profile when it exists (derives log_drum /
  // shaker / etc. from what the lane actually is), and fall back to the hardcoded kit
  // ONLY when the lane is underprofiled — and we SAY SO (materialSource).
  const profile = await loadLaneProfileForGenre(workspaceId, opts.genre);
  const wanted = profile ? laneMaterialNeeds(profile).roles.map((r) => r.role) : kitRolesFor(opts.genre);
  const materialSource = profile
    ? `profile-driven (${Object.keys(profile.features).length} measured features)`
    : `fallback-hardcoded (lane underprofiled: < 3 measured refs)`;

  const shelf = await loadShelf(workspaceId, opts.genre);
  const picks = pickMaterial(shelf, opts.genre, bpm, keySignature);
  const have = new Set(picks.map((p) => p.role));
  const missing = wanted.filter((r) => !have.has(r));

  // Shelf already stocked → assemble now.
  if (!missing.length && picks.length >= 2) {
    const jobId = await assembleFrom(app, workspaceId, opts.projectId, opts.genre, bpm, keySignature, opts.vibe, opts.songId, picks);
    return { status: 'assembling' as const, jobId, roles: picks.map((p) => p.role), bpm, keySignature, materialSource };
  }

  // Forge the missing roles, staggered for the Replicate prediction-creation limit.
  const forging: Array<{ role: string; jobId: string }> = [];
  for (let i = 0; i < missing.length; i++) {
    const role = missing[i]!;
    const charge = await app.chargeCredits({ workspaceId, key: 'beat_idea_short_30s' });
    if (!charge.ok) break; // out of budget → assemble with what we have (if enough)
    const job = await prisma.providerJob.create({
      data: { workspaceId, kind: 'material', provider: 'replicate', status: 'QUEUED', inputJson: { genre: opts.genre, role, bpm, keySignature } as never },
    });
    await enqueue({ queue: app.queues.music, name: 'forge-material', payload: { jobId: job.id, workspaceId, genre: opts.genre, role, bpm, keySignature }, delayMs: i * 30_000 });
    forging.push({ role, jobId: job.id });
  }

  // Detached: wait for the loops, then assemble automatically.
  void (async () => {
    try {
      for (const f of forging) {
        for (let t = 0; t < 40; t++) {
          await sleep(10_000);
          const j = await prisma.providerJob.findUnique({ where: { id: f.jobId }, select: { status: true } });
          if (!j || j.status === 'FAILED' || j.status === 'SUCCEEDED') break;
        }
      }
      const shelf2 = await loadShelf(workspaceId, opts.genre);
      const picks2 = pickMaterial(shelf2, opts.genre, bpm, keySignature);
      if (picks2.length >= 2) {
        await assembleFrom(app, workspaceId, opts.projectId, opts.genre, bpm, keySignature, opts.vibe, opts.songId, picks2);
      }
    } catch (err) {
      app.log?.warn?.({ err, genre: opts.genre }, 'autoMaterialBeat: auto-assemble after forge failed');
    }
  })();

  return {
    status: 'forging' as const,
    forging,
    bpm,
    keySignature,
    materialSource,
    note: `AI is forging the ${opts.genre} kit (${forging.map((f) => f.role).join(', ') || 'none needed'}) and will assemble the exact beat automatically when the loops land — no need to run each step.`,
  };
}
