import { openSecret, prisma } from '@afrohit/db';
import { analyzeAudio } from '@afrohit/ai';
import { createHash } from 'node:crypto';
import { analysisCoverage, unknownAnalysis, type MeasuredAnalysis } from '@afrohit/shared';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { measureAudio, dspAvailable } from '../lib/dsp';
import { enqueueJob } from '../lib/enqueue';
import { ffmpegAvailable, extractClip, measureAudioQuality } from '../lib/ffmpeg';
import { downloadToBuffer, resolveAssetForProvider, uploadBytes } from '../lib/storage';

interface AnalyzePayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  url: string;  /** Training session: delete the uploaded audio after learning from it. */
  source?: string;
  rightsBasis?: 'user-attested' | 'facts-only';
  purgeAfter?: boolean;
  /** FACTS-ONLY reference (a record the artist owns but didn't make): measure the
   *  uncopyrightable NUMBERS (tempo/key/groove/log-drum/arrangement) into the lane
   *  profile — NO transcription, NO prose recipe, NO stored audio. Expression is
   *  never learned from someone else's record; facts are not expression. */
  factsOnly?: boolean;
}

/**
 * Listen to a reference track and understand it. Uses the workspace's music key
 * (in-app) or the worker's Replicate token. Result (the vibe profile) lands in
 * the job's outputJson for the client to read + create from.
 */
export async function processAnalyze(p: AnalyzePayload) {
  await markRunning(p.jobId);
  let temporaryAnalyzeUrl: string | null = null;
  let sourcePurgeDelegated = false;
  try {
    if (!p.factsOnly && p.rightsBasis !== 'user-attested') {
      throw new Error('full reference learning requires an explicit user-attested rights basis');
    }
    const ws = await prisma.workspace.findUnique({
      where: { id: p.workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    const replicateApiKey = ws?.musicProvider === 'replicate' ? openSecret(ws.musicApiKey) : undefined;
    // Genre the uploader says this is — anchors the analysis (their own song).
    const project = await prisma.project.findUnique({ where: { id: p.projectId }, select: { artistId: true, genre: true } });

    // FACTS-ONLY: measure the numbers, learn no expression, keep no audio.
    if (p.factsOnly) {
      let metrics: Awaited<ReturnType<typeof measureAudioQuality>> | null = null;
      try { metrics = await measureAudioQuality(p.url); } catch { metrics = null; }
      let measured = unknownAnalysis('engine-unavailable');
      try { if (await dspAvailable()) measured = await measureAudio(p.url); } catch (err) {
        console.warn('[analyze] facts-only DSP measure failed:', (err as Error)?.message);
      }
      const sourceUrl = `facts:${p.url}`;
      const existing = await prisma.soundReference.findFirst({
        where: { workspaceId: p.workspaceId, sourceUrl },
        select: { id: true, analysisState: true, recipe: true },
      });
      const prior = (existing?.recipe ?? {}) as { measured?: MeasuredAnalysis; metrics?: unknown };
      const preserveMeasured = existing?.analysisState === 'measured' && prior.measured?.engineOk === true && !measured.engineOk;
      const effectiveMeasured = preserveMeasured ? prior.measured! : measured;
      const effectiveMetrics = preserveMeasured ? (prior.metrics ?? metrics) : metrics;
      const coverage = analysisCoverage(effectiveMeasured);
      const referenceId = existing?.id ?? `facts_${createHash('sha256').update(`${p.workspaceId}|${p.url}`).digest('hex').slice(0, 24)}`;
      const reference = await prisma.soundReference.upsert({
        where: { id: referenceId },
        create: {
          id: referenceId,
          workspaceId: p.workspaceId,
          artistId: project?.artistId ?? null,
          genre: project?.genre ?? null, // no LLM detection in facts mode — the teach-genre picker is the label
          sourceUrl,
          title: `reference facts · ${project?.genre ?? 'unknown'}`,
          recipe: { source: 'facts', factsOnly: true, measured: effectiveMeasured, metrics: effectiveMetrics } as never,
          summary: null, // NOTHING for the prose briefs to quote — numbers only, by design
          analysisState: effectiveMeasured.engineOk ? 'measured' : 'failed',
          rightsBasis: 'facts-only',
          active: true,
        },
        update: {
          artistId: project?.artistId ?? null,
          genre: project?.genre ?? null,
          recipe: { source: 'facts', factsOnly: true, measured: effectiveMeasured, metrics: effectiveMetrics } as never,
          summary: null,
          analysisState: effectiveMeasured.engineOk ? 'measured' : 'failed',
          rightsBasis: 'facts-only',
          active: true,
        },
      }).catch((err: unknown) => { console.warn('[analyze] facts reference write failed:', (err as Error)?.message); return null; });
      // Deep pass (stems-grade log-drum) then PURGE the audio — the lake keeps
      // numbers, never a copy of a record the artist didn't make.
      if (reference?.id && measured.engineOk && process.env.DSP_STEMS !== '0') {
        try {
          await enqueueJob('lake', 'deep-measure', { referenceId: reference.id, url: p.url, workspaceId: p.workspaceId, purgeAfter: true });
          sourcePurgeDelegated = true;
        } catch {
          const { deleteObjectByUrl } = await import('../lib/storage');
          await deleteObjectByUrl(p.url).catch(() => {});
        }
      } else {
        const { deleteObjectByUrl } = await import('../lib/storage');
        await deleteObjectByUrl(p.url).catch(() => {});
      }
      await markSucceeded(p.jobId, { factsOnly: true, referenceId: reference?.id ?? null, measured: effectiveMeasured, coverage, profile: null });
      return;
    }

    // Trim to a ~60s representative clip (past the intro) before analysis — keeps
    // the transcription fast/cheap and the optional audio model light. Falls back
    // to the full URL if trimming isn't possible.
    let analyzeUrl = p.url;
    let sourceContentHash: string | null = null;
    try {
      const full = await downloadToBuffer(p.url);
      sourceContentHash = createHash('sha256').update(full).digest('hex');
      if (await ffmpegAvailable()) {
        const clip = await extractClip(full, 12, 60);
        if (clip.length > 2000) {
          analyzeUrl = await uploadBytes({ workspaceId: p.workspaceId, kind: 'reference', bytes: clip, contentType: 'audio/mpeg', ext: 'mp3' });
          temporaryAnalyzeUrl = analyzeUrl;
        }
      }
    } catch {
      analyzeUrl = p.url; // any trim failure → analyze the original
    }

    // Objective ffmpeg metrics (loudness/dynamics/duration) — a free, always-there
    // signal so the analysis works even when the audio model is unavailable. Measure
    // the ORIGINAL full-quality stereo file (not the mono 22k preview clip) so the
    // loudness/LRA/crest handed to the analyzer describe the real record.
    let metrics: Awaited<ReturnType<typeof measureAudioQuality>> | null = null;
    try {
      metrics = await measureAudioQuality(p.url);
    } catch {
      metrics = null;
    }

    const profile = await analyzeAudio(await resolveAssetForProvider(analyzeUrl), replicateApiKey, {
      genreHint: project?.genre ?? null,
      metrics,
    });

    // THE EAR (Phase 0): measure real musical facts — tempo/key/groove/spectral —
    // to sit ALONGSIDE the LLM's inferred recipe, each carrying provenance so a
    // later Lane score only ever trusts what was truly measured. Failure-tolerant:
    // if the DSP engine isn't in this image yet it returns an honest all-'unknown'
    // analysis (engineOk:false) and never blocks the learn. Measures the full
    // original (not the mono preview clip) so the groove facts describe the record.
    let measured = unknownAnalysis('engine-unavailable');
    try {
      if (await dspAvailable()) {
        // Stems let log-drum/shaker/kick/clap run at full confidence (kick->drums,
        // log-drum->bass — the only clean disambiguation). Default-ON per the FINAL
        // INSTRUCTION (off only when DSP_STEMS=0); best-effort, full-mix on any failure.
        // SPEED FIX: the interactive Listen flow measures FULL-MIX only (seconds).
        // Demucs stem separation (minutes of CPU) moved to the queued deep-measure
        // job enqueued below — same stem-grade log-drum facts land on the reference
        // a few minutes later; nobody stares at a stepper.
        measured = await measureAudio(p.url);
      }
    } catch (err) {
      console.warn('[analyze] DSP measure failed:', (err as Error)?.message);
    }
    const coverage = analysisCoverage(measured);
    console.log(`[analyze] ear: engineOk=${measured.engineOk} measured=${coverage.measured}/${coverage.total} tempo=${JSON.stringify(measured.tempoBpm?.value)}`);

    // Normalize the model's free-text genre ("Afro Fusion") to our enum key
    // ("afro_fusion") so the learn library aggregates cleanly per genre instead
    // of splitting counts across label variants. Unknown genres fall back to the
    // project's stated genre.
    const normalizeGenre = (g: string | null | undefined): string | null => {
      if (!g) return null;
      const k = g.toLowerCase().trim().replace(/[\s/-]+/g, '_').replace(/[^a-z_]/g, '');
      const KNOWN = new Set([
        'afrobeats', 'afro_fusion', 'amapiano', 'afro_dancehall', 'street_pop', 'afro_rnb', 'gospel', 'afro_pop',
        'hip_hop', 'highlife', 'reggae', 'pop', 'rnb', 'dancehall', 'drill', 'trap', 'house', 'edm', 'reggaeton',
        'latin_pop', 'country', 'rock', 'soul',
      ]);
      if (KNOWN.has(k)) return k;
      if (k.includes('amapiano') || k.includes('piano')) return 'amapiano';
      if (k.includes('afrobeat')) return 'afrobeats';
      if (k.includes('fusion')) return 'afro_fusion';
      if (k.includes('hiphop') || k.includes('rap')) return 'hip_hop';
      if (k.includes('rnb') || k.includes('r_b')) return 'rnb';
      return null;
    };
    const learnedGenre = normalizeGenre(profile.genre) ?? project?.genre ?? null;

    // LEARN: store the deep production recipe as a reusable reference so future
    // songs in this genre/workspace can be built from what it heard. This is the
    // compounding "listen & learn" library — it grows with every reference.
    const referenceData = {
      artistId: project?.artistId ?? null,
      genre: learnedGenre,
      sourceUrl: p.url,
      title: profile.vibe?.slice(0, 120) ?? null,
      // Store the measured DSP facts alongside the inferred recipe (additive key)
      // so the lake / later Lane phases can read what was actually heard.
      recipe: { ...(profile as unknown as Record<string, unknown>), source: p.source ?? 'owned-upload', measured } as never,
      summary: profile.learnedRecipe || profile.suggestedVibePrompt || null,
      analysisState: measured.engineOk ? 'measured' : 'inferred',
      rightsBasis: 'user-attested',
    };
    const reference = await (sourceContentHash
      ? prisma.soundReference.upsert({
          where: { workspaceId_contentHash: { workspaceId: p.workspaceId, contentHash: sourceContentHash } },
          create: { workspaceId: p.workspaceId, contentHash: sourceContentHash, ...referenceData },
          update: { ...referenceData, active: true },
        })
      : prisma.soundReference.create({ data: { workspaceId: p.workspaceId, ...referenceData } }))
      // A failed write here silently loses a LEARNED reference — log it.
      .catch((err: unknown) => {
        console.warn('[analyze] SoundReference write failed:', (err as Error)?.message);
        return null;
      });

    // Deep pass (stems + refined DSP) runs in the BACKGROUND — the reference
    // upgrades itself in place a few minutes after the artist already has results.
    if (reference?.id && process.env.DSP_STEMS !== '0' && measured.engineOk) {
      try {
        await enqueueJob('lake', 'deep-measure', {
          referenceId: reference.id,
          url: p.url,
          workspaceId: p.workspaceId,
          purgeAfter: p.purgeAfter === true,
        });
        sourcePurgeDelegated = p.purgeAfter === true;
      } catch (e) {
        console.warn('[analyze] deep-measure enqueue failed:', (e as Error)?.message);
      }
    }

    // Taste graph — what the artist chose to listen to / build from. Compounds.
    await prisma.analyticsEvent
      .create({
        data: {
          workspaceId: p.workspaceId,
          name: 'taste.reference_listen',
          properties: { bpm: profile.bpm, genre: profile.genre, mood: profile.mood, energy: profile.energy } as never,
        },
      })
      .catch((err: unknown) => console.warn('[analyze] taste event write failed:', (err as Error)?.message));
    // referenceId lets the UI PIN this exact reference for the remake — the song
    // made next must rebuild THIS record's sound, not a lucky-recent one.
    await markSucceeded(p.jobId, { profile, referenceId: reference?.id ?? null, measured, coverage });
  } catch (err) {
    await markFailed(p.jobId, err);
  } finally {
    // Training captures are always purged. A successfully queued deep pass owns
    // deletion so it can still read the source; otherwise this worker deletes it.
    if (p.purgeAfter && !sourcePurgeDelegated) {
      const { deleteObjectByUrl } = await import('../lib/storage');
      await deleteObjectByUrl(p.url).catch(() => {});
    }
    if (temporaryAnalyzeUrl) {
      const { deleteObjectByUrl } = await import('../lib/storage');
      await deleteObjectByUrl(temporaryAnalyzeUrl).catch(() => {});
    }
  }
}
