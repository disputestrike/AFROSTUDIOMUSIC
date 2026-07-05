import { prisma } from '@afrohit/db';
import { analyzeAudio } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { ffmpegAvailable, extractClip } from '../lib/ffmpeg';
import { downloadToBuffer, uploadBytes } from '../lib/storage';

interface AnalyzePayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  url: string;
}

/**
 * Listen to a reference track and understand it. Uses the workspace's music key
 * (in-app) or the worker's Replicate token. Result (the vibe profile) lands in
 * the job's outputJson for the client to read + create from.
 */
export async function processAnalyze(p: AnalyzePayload) {
  await markRunning(p.jobId);
  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: p.workspaceId },
      select: { musicApiKey: true },
    });
    // Trim to a ~60s representative clip (past the intro) before analysis — a 7B
    // audio model OOMs on a full 3-min track. Less GPU, faster, still enough to
    // read the production. Falls back to the full URL if trimming isn't possible.
    let analyzeUrl = p.url;
    try {
      if (await ffmpegAvailable()) {
        const full = await downloadToBuffer(p.url);
        const clip = await extractClip(full, 12, 60);
        if (clip.length > 2000) {
          analyzeUrl = await uploadBytes({ workspaceId: p.workspaceId, kind: 'reference', bytes: clip, contentType: 'audio/mpeg', ext: 'mp3' });
        }
      }
    } catch {
      analyzeUrl = p.url; // any trim failure → analyze the original
    }
    const profile = await analyzeAudio(analyzeUrl, ws?.musicApiKey ?? undefined);

    // LEARN: store the deep production recipe as a reusable reference so future
    // songs in this genre/workspace can be built from what it heard. This is the
    // compounding "listen & learn" library — it grows with every reference.
    const project = await prisma.project.findUnique({ where: { id: p.projectId }, select: { artistId: true } });
    await prisma.soundReference
      .create({
        data: {
          workspaceId: p.workspaceId,
          artistId: project?.artistId ?? null,
          genre: profile.genre ?? null,
          sourceUrl: p.url,
          title: profile.vibe?.slice(0, 120) ?? null,
          recipe: profile as never,
          summary: profile.learnedRecipe || profile.suggestedVibePrompt || null,
        },
      })
      .catch(() => {});

    // Taste graph — what the artist chose to listen to / build from. Compounds.
    await prisma.analyticsEvent
      .create({
        data: {
          workspaceId: p.workspaceId,
          name: 'taste.reference_listen',
          properties: { bpm: profile.bpm, genre: profile.genre, mood: profile.mood, energy: profile.energy } as never,
        },
      })
      .catch(() => {});
    await markSucceeded(p.jobId, { profile });
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}
