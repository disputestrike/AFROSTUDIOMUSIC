import { prisma } from '@afrohit/db';
import { analyzeAudio, separateStems } from '@afrohit/ai';
import { analysisCoverage, unknownAnalysis } from '@afrohit/shared';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { measureAudio, dspAvailable, type StemInputs } from '../lib/dsp';
import { ffmpegAvailable, extractClip, measureAudioQuality } from '../lib/ffmpeg';
import { downloadToBuffer, uploadBytes } from '../lib/storage';

interface AnalyzePayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  url: string;  /** Training session: delete the uploaded audio after learning from it. */
  purgeAfter?: boolean;
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
    // Genre the uploader says this is — anchors the analysis (their own song).
    const project = await prisma.project.findUnique({ where: { id: p.projectId }, select: { artistId: true, genre: true } });

    // Trim to a ~60s representative clip (past the intro) before analysis — keeps
    // the transcription fast/cheap and the optional audio model light. Falls back
    // to the full URL if trimming isn't possible.
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

    const profile = await analyzeAudio(analyzeUrl, ws?.musicApiKey ?? undefined, {
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
        let stems: StemInputs | undefined;
        if (process.env.DSP_STEMS !== '0') {
          try {
            const sep = await separateStems({ audioUrl: p.url, mode: 'full', apiKey: ws?.musicApiKey ?? undefined });
            const byRole = (r: string) => sep.stems.find((s) => s.role === r)?.url;
            stems = { bass: byRole('bass'), drums: byRole('drums'), other: byRole('other'), vocals: byRole('vocals') };
          } catch (e) {
            console.warn('[analyze] stem separation failed, full-mix DSP:', (e as Error)?.message);
          }
        }
        measured = await measureAudio(p.url, stems);
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
    const reference = await prisma.soundReference
      .create({
        data: {
          workspaceId: p.workspaceId,
          artistId: project?.artistId ?? null,
          genre: learnedGenre,
          sourceUrl: p.url,
          title: profile.vibe?.slice(0, 120) ?? null,
          // Store the measured DSP facts alongside the inferred recipe (additive key)
          // so the lake / later Lane phases can read what was actually heard.
          recipe: { ...(profile as unknown as Record<string, unknown>), measured } as never,
          summary: profile.learnedRecipe || profile.suggestedVibePrompt || null,
        },
      })
      // A failed write here silently loses a LEARNED reference — log it.
      .catch((err) => {
        console.warn('[analyze] SoundReference write failed:', (err as Error)?.message);
        return null;
      });

    // Taste graph — what the artist chose to listen to / build from. Compounds.
    await prisma.analyticsEvent
      .create({
        data: {
          workspaceId: p.workspaceId,
          name: 'taste.reference_listen',
          properties: { bpm: profile.bpm, genre: profile.genre, mood: profile.mood, energy: profile.energy } as never,
        },
      })
      .catch((err) => console.warn('[analyze] taste event write failed:', (err as Error)?.message));
    // referenceId lets the UI PIN this exact reference for the remake — the song
    // made next must rebuild THIS record's sound, not a lucky-recent one.
    await markSucceeded(p.jobId, { profile, referenceId: reference?.id ?? null, measured, coverage });
    // TRAINING-SESSION PURGE: the lake keeps the learned recipe, never the
    // recording itself (doctrine: no stored copies of anyone's audio).
    if (p.purgeAfter) {
      const { deleteObjectByUrl } = await import('../lib/storage');
      await deleteObjectByUrl(p.url).catch(() => {});
    }
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}
