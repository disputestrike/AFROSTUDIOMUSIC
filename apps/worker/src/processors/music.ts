import { createHash } from 'node:crypto';
import { openSecret, prisma, Prisma } from '@afrohit/db';
import { musicAdapter, defaultInstrumentalEngine, transcribeAudio } from '@afrohit/ai';
import type { MusicGenerationInput } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { deleteObjectByUrl, ingestRemoteFile, downloadToBuffer, resolveAssetForProvider, uploadBytes } from '../lib/storage';
import { probeDurationS, measureAudioQuality, encodeMp3320, ffmpegAvailable, master as ffmpegMaster, MASTER_TARGETS, transformAudio, type AudioQuality } from '../lib/ffmpeg';
import { assessLaneCompliance, loadLaneProfile, laneGrounding } from '../lib/lane-assess';
import { overlayFills } from '../lib/fills';
import { measureAudio, dspAvailable } from '../lib/dsp';
import { credentialForEngine, elevenMusicRouteApproved, resolveMusicCredentials, workspaceProviderEngine } from '../lib/music-routing';
import {
  enforceMusicStemPersistence,
  materializeStemAudio,
  resolveMusicStemSources,
} from '../lib/demucs-local';
import { genreSignature, planFills, scoreLaneCompliance, scoreLyricAudioAlignment, engineAdequacy, structureMatch, blueprintFromMeasured, isFirstPartyWorkspace, resolveEngineForWorkspace, promotionEligible, selectMaterialRows, materialGenreMatches, normalizeMaterialGenre, type LaneComplianceScore, type LyricAudioAlignmentScore, type MeasuredAnalysis, type SongBlueprint } from '@afrohit/shared';
import { enqueueJob } from '../lib/enqueue';

/** Minimum measured coverage before a lane score is allowed to influence ranking. */
const MIN_COVERAGE_FOR_RANKING = 0.5;

/**
 * PATCH 1 — composite best-of-N rank (highest wins). The ear gets a vote:
 *   1. No failed CRITICAL lane element (a take missing the log drum is not the record,
 *      however punchy).
 *   2. Higher lane compliance (only when coverage >= MIN_COVERAGE_FOR_RANKING, 2pt
 *      deadband so we don't churn on measurement noise).
 *   3. Higher qcScore — mix quality, the old behaviour, now a tiebreak AND the sole
 *      criterion whenever the ear is blind (no profile / dsp down / thin coverage).
 * Fail-open by construction: null/thin lane collapses to pure qcScore.
 */
/**
 * SCALAR take score (higher = better). Replaces the old pairwise comparator whose
 * deadbands (0.07 blueprint, 2pt lane) combined with the "both usable" branch made
 * it INTRANSITIVE — Array.sort could crown a non-best winner for N>=3. A scalar is
 * a valid total order by construction. Priority is preserved by weight bands:
 * no-critical-failure ≫ blueprint match ≫ lane compliance ≫ mix quality. The
 * deadbands survive as BUCKETS (quantize before weighting) so noise still can't
 * flip near-ties, but the ordering is now consistent.
 */
function takeScore(x: { qc: AudioQuality | null; lane: LaneComplianceScore | null; bp?: number | null; alignment?: LyricAlignmentEvidence | null }): number {
  const mix = qcScore(x.qc);
  // A measured matching lyric outranks an unmeasured take, which outranks a
  // measured wrong song. This band is deliberately above every production-
  // quality term: a beautiful performance of the wrong words is still wrong.
  const alignmentBand = x.alignment ? (x.alignment.pass ? 2 : 0) : 1;
  const usable = x.lane != null && x.lane.coverage >= MIN_COVERAGE_FOR_RANKING;
  if (!usable) return alignmentBand * 1e12 + mix;
  const crit = x.lane!.failedCritical.length > 0 ? 1 : 0;
  const bpBucket = x.bp != null ? Math.round(x.bp / 0.07) : 0; // 0.07 deadband → bucket
  const laneBucket = Math.round(x.lane!.overall / 2); // 2pt deadband → bucket
  // A critical-failed take sinks below everything (even unmeasured); otherwise
  // blueprint dominates, then lane, then mix as the tiebreak.
  return alignmentBand * 1e12 + (crit ? -1e9 : 0) + bpBucket * 1e6 + laneBucket * 1e3 + mix;
}

interface LyricAlignmentEvidence extends LyricAudioAlignmentScore {
  state: 'passed' | 'failed';
  provider: 'openai' | 'replicate';
  model: string;
  language: string | null;
  expectedHash: string;
  transcriptHash: string;
  measuredAt: string;
}

async function measureLyricAlignment(opts: {
  audioUrl: string;
  format: string;
  expectedLyric: string;
  replicateApiKey?: string;
}): Promise<LyricAlignmentEvidence | null> {
  try {
    const providerUrl = await resolveAssetForProvider(opts.audioUrl).catch(() => opts.audioUrl);
    let bytes = process.env.OPENAI_API_KEY
      ? await downloadToBuffer(opts.audioUrl, { maxBytes: 256 * 1024 * 1024 })
      : undefined;
    let filename = `render.${opts.format || 'mp3'}`;
    if (bytes && bytes.byteLength > 20 * 1024 * 1024 && await ffmpegAvailable()) {
      bytes = await encodeMp3320(bytes);
      filename = 'render.mp3';
    }
    const transcription = await transcribeAudio({
      url: providerUrl,
      bytes,
      filename,
      replicateApiKey: opts.replicateApiKey,
    });
    if (!transcription?.text) return null;
    const score = scoreLyricAudioAlignment(opts.expectedLyric, transcription.text);
    return {
      ...score,
      state: score.pass ? 'passed' : 'failed',
      provider: transcription.provider,
      model: transcription.model,
      language: transcription.language,
      expectedHash: createHash('sha256').update(opts.expectedLyric.normalize('NFC')).digest('hex'),
      transcriptHash: createHash('sha256').update(transcription.text.normalize('NFC')).digest('hex'),
      measuredAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

interface MusicPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId?: string;
  input: MusicGenerationInput;
}

interface TrainingReferenceRow {
  id: string;
  title: string | null;
  analysisState: string;
  rightsBasis: string;
}

/**
 * Rank a rendered candidate by measured quality — higher = more "alive". Prefers
 * a passing verdict, rewards dynamic movement (loudness range) and punch (crest),
 * penalises clipping / too-quiet / flat / squashed. This is how best-of-N picks
 * the take with the most life instead of shipping the first (often flat) one.
 */
function qcScore(q: AudioQuality | null): number {
  if (!q) return -1; // couldn't measure → lowest, but still usable if it's all we have
  const verdictRank = q.verdict === 'pass' ? 2 : q.verdict === 'weak' ? 1 : 0;
  let s = verdictRank * 100;
  if (q.loudnessRangeLra != null) s += Math.min(Math.max(q.loudnessRangeLra, 0), 12) * 3; // dynamics = anti-"flat"
  if (q.crestFactorDb != null) s += Math.min(Math.max(q.crestFactorDb, 0), 20); // punch
  const f = q.flags ?? [];
  if (f.includes('clipping')) s -= 40;
  if (f.includes('too_quiet')) s -= 30;
  if (f.includes('flat')) s -= 25;
  if (f.includes('squashed')) s -= 15;
  return s;
}

export async function processMusic(p: MusicPayload) {
  await markRunning(p.jobId);
  const temporaryCandidateUrls: string[] = [];
  let uncommittedBeatUrl: string | null = null;
  let uncommittedStemUrls: string[] = [];
  const transientStemSourceUrls: string[] = [];
  let supersededBeatUrl: string | null = null;
  // POST-RENDER SALVAGE LAW (live incident 2026-07-16: a paid, ranked render
  // was destroyed by a bare 'fetch failed' in post-processing, and every retry
  // RE-RENDERED — billing the provider again). Once a winner exists, its
  // context lives here so the outer catch can SALVAGE the take (it is already
  // durable in owned storage from candidate materialization) as a playable,
  // honestly-marked unprocessed asset instead of failing the job. Render money
  // is never spent twice over post-processing weather.
  let salvageCandidate: {
    url: string; format: string; provider: string; externalId?: string;
    assetKind: string; bpm: number | null; keySignature: string | null;
    durationS: number; alignment: unknown; step: string;
    projectId: string; songId: string | null;
  } | null = null;
  let committedBeatId: string | null = null;
  try {
    // Provider + key are set IN-APP (Settings → Music engine), stored per
    // workspace. Falls back to env (MUSIC_PROVIDER / *_API_KEY) then stub.
    const ws = await prisma.workspace.findUnique({
      where: { id: p.workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    // Full song WITH AI vocals → vocals-capable model (ACE-Step on the same
    // Replicate key). Otherwise the configured instrumental beat engine.
    const wantsVocals = !!(p.input.withVocals && p.input.lyrics);
    // AUDIT FIX: a sung song requested with NO lyrics used to be SILENTLY demoted
    // to an instrumental (which could be the stub) and stored as an approved
    // "song" — a confusing "it didn't work". If vocals were asked for but the
    // writer produced nothing, fail with the real reason instead of faking a beat.
    if (p.input.withVocals && !p.input.lyrics) {
      console.warn('[music] vocal song requested but lyrics are empty — writer/brain likely failed upstream');
      await markFailed(p.jobId, 'music_generation_failed: the lyrics were not written (the writer may be unavailable) — try again.');
      return;
    }
    // Resolve the sung-song route from the explicit request, workspace provider,
    // legal route wall and connected credentials. Quality rankings belong to the
    // measured bake-off rather than hardcoded vendor claims.
    // W-2 THE WALL: the bridge is not a customer render path — a non-first-party
    // workspace requesting 'suno' is hard-substituted to an approved customer
    // engine, in CODE, so misconfiguration cannot leak bridge output.
    const firstParty = isFirstPartyWorkspace(p.workspaceId);
    const workspaceApiKey = openSecret(ws?.musicApiKey);
    const credentials = resolveMusicCredentials(ws?.musicProvider, workspaceApiKey);
    const elevenRouteApproved = elevenMusicRouteApproved(firstParty);
    const workspaceDefault = workspaceProviderEngine(ws?.musicProvider);
    const songOverride = process.env.SONG_ENGINE?.toLowerCase();
    const requestedEngine = p.input.songEngine
      ?? workspaceDefault
      ?? (wantsVocals
        ? (songOverride === 'replicate' ? 'minimax' : songOverride)
        : defaultInstrumentalEngine());
    // PLAN-LOCK MEMORY: ElevenLabs' Music API is pay-walled on THEIR side — a
    // free-tier key 402s with 'paid_plan_required' at render time, which is
    // undetectable at resolution time. When a render proves the route locked
    // (flag written in the failure branch below), Auto routes around it for
    // 24h instead of dead-ending every take on the same locked door (live
    // incident, 2026-07-16: all candidates failed on eleven 402 while minimax
    // sat ready on the same workspace). An upgrade self-heals via expiry.
    const elevenLockFlag = await prisma.systemSetting.findUnique({
      where: { key: 'engine.eleven.planLocked.v1' },
      select: { value: true },
    });
    const elevenPlanLocked = !!elevenLockFlag
      && Date.now() - new Date(elevenLockFlag.value).getTime() < 24 * 60 * 60 * 1000
      && p.input.songEngine !== 'eleven'; // an EXPLICIT eleven request still tries — it may be newly upgraded
    if (elevenPlanLocked) {
      console.log('[music] advanced route plan-locked (remembered) — auto routes to the standard engine');
    }
    const resolved = resolveEngineForWorkspace(requestedEngine, {
      firstParty,
      sunoAvailable: !!credentials.suno,
      elevenAvailable: !!credentials.eleven && elevenRouteApproved && !elevenPlanLocked,
      replicateAvailable: !!credentials.replicate,
    });
    if (resolved.wallSubstituted) {
      console.log(`[wall] flagship route blocked for customer workspace ${p.workspaceId}; rendering on ${resolved.engine}`);
    }
    const engine = resolved.engine;
    const engineKey = credentialForEngine(engine, credentials);
    const adapter = musicAdapter(engine, engineKey);
    await prisma.providerJob.updateMany({
      where: { id: p.jobId, workspaceId: p.workspaceId },
      data: { provider: adapter.name },
    });
    if (resolved.unavailableReason) {
      console.warn(`[music] engine unavailable: ${resolved.unavailableReason}`);
    }

    // Reference audio currently steers the measured brief and repair prompt. Keep
    // the selected engine intact until a verified audio-conditioned route exists.
    if (p.input.referenceAudioUrl && wantsVocals) {
      console.log(`[adjust] steered re-render (unconditioned) - reference-input=${String(p.input.referenceAudioUrl).slice(0, 80)}`);
    }
    type GenResult = Awaited<ReturnType<typeof adapter.generate>>;

    // minimax/suno DELIVER a finished, loudness-maximised master (they ship hot on
    // purpose); ace_step/replicate/musicgen are rawer. The auto-master conforms a
    // finished engine light-touch (loudness + true-peak only) instead of running
    // the full EQ/glue-comp chain on top, and the self-training gate treats their
    // always-hot ("clipping") raw QC differently from a genuinely broken take.
    const finished = adapter.name === 'minimax' || adapter.name === 'suno' || adapter.name === 'eleven';

    // Run generate + poll-to-terminal for ONE candidate. Cap polling by ELAPSED
    // TIME, not a fixed attempt count: at minimax's 5s poll interval a "25 attempts"
    // cap gave only ~125s, but minimax music-2.6 renders take 60-180s, so a slow
    // render could be dropped mid-flight. Poll up to 10 min (< the 12-min withTimeout
    // race below, which still covers a socket that never resolves or rejects).
    // (Note: the observed best-of-1 was the burst-limit 429 handled below, not this.)
    const generateOne = async (): Promise<GenResult> => {
      const pollDeadline = Date.now() + 10 * 60 * 1000;
      let r = await adapter.generate(p.input);
      // Replicate's prediction-CREATION endpoint is burst-limited on this account
      // (≈6/min, BURST 1). Best-of-N fires N creates near-simultaneously, so the
      // loser of the burst comes back failed with a 429/throttle and the candidate
      // is silently dropped (best-of-2 → best-of-1 — proven live, not the poll cap).
      // Retry the CREATE a few times with backoff; the staggered starts below plus
      // this retry give every candidate its own creation slot.
      let createTries = 0;
      while (
        r.status === 'failed' &&
        createTries < 4 &&
        /429|throttl|rate.?limit|too many/i.test(r.error ?? '')
      ) {
        await new Promise((res) => setTimeout(res, (createTries + 1) * 15_000));
        createTries++;
        r = await adapter.generate(p.input);
      }
      while (r.status === 'queued' || r.status === 'running') {
        if (!adapter.poll || !r.externalId) break;
        if (Date.now() >= pollDeadline) break;
        await new Promise((res) => setTimeout(res, r.pollAfterMs ?? 8_000));
        r = await adapter.poll(r.externalId);
      }
      return r;
    };

    // BEST-OF-N: render N candidates IN PARALLEL (≈ same wall-clock as one), QC
    // each, and keep the take with the most life — the model-independent quality
    // lever that stops the studio shipping the first (often flat) take. Default 2.
    // Each candidate is raced against a hard 12-min ceiling so a hung provider
    // HTTP call can never wedge the job forever (poll caps alone don't cover a
    // fetch that neither resolves nor rejects).
    const HARD_TIMEOUT_MS = 12 * 60 * 1000;
    const withTimeout = (run: Promise<GenResult>): Promise<GenResult> =>
      Promise.race([
        run,
        new Promise<GenResult>((resolve) =>
          setTimeout(() => resolve({ status: 'failed', error: 'render timed out after 12 minutes' } as GenResult), HARD_TIMEOUT_MS)
        ),
      ]);
    // WO-5 PROGRESSIVE BEST-OF-N (supersedes the blanket 3): DRAFT default N=1 —
    // cheapest possible first listen; the ear measures it either way (WO-4).
    // Escalation is DEMAND-DRIVEN: "make it bigger"/retry renders exactly ONE new
    // take (its measurement is compared against what's already stored — never a
    // re-run of the set). Premium/Hit-Maker flows request candidates:2 upfront,
    // escalating to 3 only when both fail the lane. Never render 3 blind.
    const N = Math.max(1, Math.min(Number(p.input.candidates ?? process.env.BEST_OF_N ?? 1), 5));
    // STAGGER the candidate STARTS by ~15s (Replicate's prediction-creation slot
    // refills at ≈6/min): the renders still overlap so wall-clock ≈ one render +
    // (N-1)·15s, but no two creates collide on the BURST-1 limit. This is what
    // actually restores best-of-2 — the earlier "rendered: 1 of 2" was the 2nd
    // create being 429'd, not the poll cap. Env STAGGER override for other accounts.
    const STAGGER_MS = Math.max(0, Number(process.env.RENDER_STAGGER_MS ?? 15_000));
    const settled = await Promise.all(
      Array.from({ length: N }, (_v, i) =>
        (async () => {
          if (i > 0 && STAGGER_MS) await new Promise((res) => setTimeout(res, i * STAGGER_MS));
          return withTimeout(generateOne()).catch(
            (e) => ({ status: 'failed', error: String((e as Error)?.message ?? e) }) as GenResult
          );
        })()
      )
    );
    const expandedSettled: GenResult[] = settled.flatMap((result) => {
      if (result.status !== 'succeeded' || !result.output?.alternates?.length) return [result];
      const { alternates, ...primary } = result.output;
      return [
        { ...result, output: primary },
        ...alternates.map((alternate) => ({ ...result, output: alternate } as GenResult)),
      ];
    });
    const materialized = await Promise.all(
      expandedSettled.map(async (r): Promise<GenResult> => {
        if (r.status !== 'succeeded' || !r.output?.audioBytes) return r;
        try {
          const mainAudioUrl = await uploadBytes({
            workspaceId: p.workspaceId,
            kind: 'provider-candidates',
            bytes: r.output.audioBytes,
            contentType: r.output.format === 'mp3' ? 'audio/mpeg' : r.output.format === 'flac' ? 'audio/flac' : 'audio/wav',
            ext: r.output.format,
          });
          temporaryCandidateUrls.push(mainAudioUrl);
          return { ...r, output: { ...r.output, mainAudioUrl, audioBytes: undefined } };
        } catch (error) {
          return { status: 'failed', error: `candidate storage failed: ${(error as Error).message}` } as GenResult;
        }
      })
    );
    const ok = materialized.filter((r) => r.status === 'succeeded' && r.output?.mainAudioUrl);

    // Defense in depth: a provider response may never smuggle the historical
    // placeholder host into a successful song, even in local development.
    const placeholder = ok.some((r) => /soundhelix\.com/i.test((r.status === 'succeeded' && r.output?.mainAudioUrl) || ''));
    const fallbackReason: string | undefined = undefined;
    if (placeholder) {
      console.warn(`[music] placeholder audio blocked (adapter=${adapter.name})`);
      await markFailed(p.jobId, 'music_generation_failed: the engine returned disallowed placeholder audio; retry or switch engine in Settings.');
      return;
    }
    if (!ok.length) {
      const reason = materialized.find((r) => r.error)?.error ?? 'provider_failed';
      // §1.11 THE WALL: errorJson reaches the user's screen — vendor/route names
      // are INTERNAL. Log the real reason here; ship the class-level one.
      console.warn(`[music] all candidates failed — internal reason: ${reason}`);
      // PLAN-LOCK LEARNING: a 'paid_plan_required' 402 from the advanced route
      // means the connected account cannot use that engine at all — remember it
      // (24h, see resolution above) so the very next create auto-routes to the
      // standard engine instead of failing every take on the same locked door.
      if (engine === 'eleven' && /paid_plan_required|not available for free users/i.test(reason)) {
        await prisma.systemSetting.upsert({
          where: { key: 'engine.eleven.planLocked.v1' },
          create: { key: 'engine.eleven.planLocked.v1', value: new Date().toISOString(), updatedAt: new Date() },
          update: { value: new Date().toISOString(), updatedAt: new Date() },
        }).catch(() => undefined);
        await markFailed(p.jobId, 'music_generation_failed: the advanced engine is plan-locked on the connected account — create again and the studio will render on the standard engine (or upgrade the advanced account to unlock it).');
        return;
      }
      const publicReason = reason
        .replace(/\bfal\b/gi, 'engine route')
        .replace(/suno|minimax|ace[-_ ]?step|replicate|eleven(labs)?|stable[_ ]?audio|musicgen/gi, 'engine');
      await markFailed(p.jobId, `music_generation_failed: ${publicReason} — no placeholder emitted; retry or switch engine in Settings.`);
      return;
    }

    // Rank every candidate on LANE first, mix quality second (PATCH 1). Measure the
    // lane of EVERY take, not just the post-hoc winner — that is the change that lets
    // "make it 20x better" mean "more in-lane", not just "louder". Fail-open: no
    // profile / dsp down / thin coverage collapses ranking to the old qcScore order.
    const laneProfile = await loadLaneProfile(p.workspaceId, p.input.genre).catch(() => null);
    // Measure every candidate when the ear is up — even with NO profile yet, so the raw
    // MeasuredAnalysis can seed the self-training library (anti-pattern #9: a library
    // that grows without storing DSP teaches buildLaneProfile nothing). Lane RANKING
    // only engages once a profile exists.
    const dspUp = process.env.LANE_ASSESS !== '0' && (await dspAvailable());
    const srcBlueprint = ((p.input as { blueprint?: SongBlueprint }).blueprint) ?? null;
    const alignmentRequired = wantsVocals && (
      process.env.VOCAL_ALIGNMENT_REQUIRED ?? (process.env.NODE_ENV === 'production' ? '1' : '0')
    ) !== '0';
    const scored = await Promise.all(
      ok.map(async (r) => {
        const url = r.output?.mainAudioUrl;
        const [qc, alignment] = await Promise.all([
          url ? measureAudioQuality(url).catch(() => null) : Promise.resolve(null),
          wantsVocals && url && p.input.lyrics
            ? measureLyricAlignment({
                audioUrl: url,
                format: r.output?.format ?? 'mp3',
                expectedLyric: p.input.lyrics,
                replicateApiKey: credentials.replicate,
              })
            : Promise.resolve(null),
        ]);
        let measured: MeasuredAnalysis | null = null;
        let lane: LaneComplianceScore | null = null;
        if (dspUp && url) {
          const m = await measureAudio(url).catch(() => null);
          if (m?.engineOk) { measured = m; if (laneProfile) lane = scoreLaneCompliance(m, laneProfile); }
        }
        const bp = srcBlueprint && measured ? structureMatch(blueprintFromMeasured(measured), srcBlueprint) : null;
        return { r, qc, lane, measured, bp, alignment };
      })
    );
    scored.sort((a, b) => takeScore(b) - takeScore(a));
    const winner = scored[0]!;
    const result = winner.r;
    const out = result.output!;
    if (!out.mainAudioUrl) throw new Error('provider succeeded without playable audio');
    if (wantsVocals && winner.alignment && !winner.alignment.pass) {
      await markFailed(
        p.jobId,
        `music_generation_failed: rendered vocals did not match the approved lyrics (${winner.alignment.failures.join(', ')})`,
      );
      return;
    }
    if (alignmentRequired && !winner.alignment) {
      // VERIFIER-DOWN IS NOT VERIFICATION-FAILED. When the checker itself is
      // unavailable (transcription outage — live incident 2026-07-16: a good,
      // already-paid render was destroyed and refunded because the verifier
      // couldn't be reached), the take ships HONESTLY UNVERIFIED: approval is
      // withheld (vocalIdentityAccepted stays false), meta.vocalAlignment
      // records state 'unmeasured' with required:true, and the release gates
      // still demand verification before anything ships publicly. A mismatch
      // the verifier actually MEASURED (the gate above) remains a hard fail —
      // that is a broken song; this is merely an unchecked one.
      console.warn('[music] lyric verification unavailable — shipping the take UNVERIFIED (approval withheld; release gates still enforce)');
    }
    let quality: AudioQuality | null = winner.qc;
    const winnerLane = winner.lane;
    const productionRank = winner.bp != null
      ? `blueprint-structure (${Math.round(winner.bp * 100)}% skeleton match)`
      : winnerLane && winnerLane.coverage >= MIN_COVERAGE_FOR_RANKING ? 'lane-compliance' : 'mix-quality (ear blind or coverage thin)';
    const rankedBy = winner.alignment
      ? `lyric-alignment (${Math.round(winner.alignment.overall * 100)}%) + ${productionRank}`
      : productionRank;
    console.log(`[music] best-of-${ok.length} ranked by ${rankedBy}${winnerLane ? ` — lane ${winnerLane.overall}/100 cov ${(winnerLane.coverage * 100) | 0}% failedCritical=[${winnerLane.failedCritical.join(',')}]` : ''}`);

    // POST-RENDER SALVAGE LAW (live incident 2026-07-16: a paid, ranked,
    // verified-enough render was destroyed by a bare 'fetch failed' in
    // post-processing — and every retry RE-RENDERED, billing the provider
    // again). From here to the asset commit, any failure names its step and
    // network cause, and the take — already durable in owned storage from
    // candidate materialization — is SALVAGED as a playable, honestly-marked
    // unprocessed asset instead of being thrown away. Render money is never
    // spent twice for a post-processing hiccup.
    salvageCandidate = {
      url: out.mainAudioUrl!,
      format: out.format,
      provider: adapter.name,
      externalId: result.externalId,
      assetKind: wantsVocals ? 'full_mix' : 'instrumental',
      bpm: out.bpm ?? p.input.bpm ?? null,
      keySignature: out.keySignature ?? p.input.keySignature ?? null,
      durationS: out.durationS ?? 0,
      alignment: wantsVocals
        ? winner.alignment ?? { state: 'unmeasured', required: alignmentRequired }
        : { state: 'not_applicable' },
      step: 'ingest-winner',
      projectId: p.projectId,
      songId: p.songId ?? null,
    };
    // Re-host ONLY the winning take (survives provider URL expiry; stable CDN path).
    let ingestedMain = await ingestRemoteFile({
      workspaceId: p.workspaceId,
      url: out.mainAudioUrl,
      kind: 'beats',
      ext: out.format,
      contentType: out.format === 'mp3' ? 'audio/mpeg' : out.format === 'flac' ? 'audio/flac' : 'audio/wav',
    });
    uncommittedBeatUrl = ingestedMain;
    if (salvageCandidate) salvageCandidate.step = 'qc-and-fills';

    // Winner QC measured the provider URL (same bytes). Re-probe duration if unknown;
    // if QC didn't run at all, measure the ingested file now. Never fatal.
    let durationS = quality?.durationS && quality.durationS > 0 ? quality.durationS : out.durationS ?? 0;
    if (!quality) {
      quality = await measureAudioQuality(ingestedMain).catch(() => null);
      if (quality?.durationS && quality.durationS > 0) durationS = quality.durationS;
    }
    if (durationS < 12) {
      const probed = await probeDurationS(ingestedMain);
      if (probed > 0) durationS = probed;
    }
    const rawClipOnlyFinished =
      wantsVocals &&
      finished &&
      quality?.verdict === 'fail' &&
      quality.flags.length === 1 &&
      quality.flags[0] === 'clipping';
    if (!quality) {
      throw new Error('music_generation_failed: rendered audio could not be measured; no unverified audio was approved');
    }
    if (quality.verdict !== 'pass' && !rawClipOnlyFinished) {
      throw new Error(`music_generation_failed: rendered audio failed quality control (${quality.flags.join(', ') || quality.verdict})`);
    }

    // PHASE 5 — insert drum fills into the section transitions (the fills Benjamin
    // keeps missing). Gated FILL_OVERLAY=1 (quality-sensitive) and only when a fill
    // material for the genre exists. Best-effort: any failure keeps the clean render.
    const beatBpm = out.bpm ?? p.input.bpm ?? 0;
    let appliedFill: {
      materialId: string;
      sourceBpm: number;
      targetBpm: number;
      stretchRatio: number;
      placementsS: number[];
    } | null = null;
    // FILLS ARE DECORATION: any failure here degrades to a fill-less take with a
    // logged reason — it must NEVER fail the song (first prod run of this path
    // happened when the kit-forge stocked fills; Benjamin's failed render).
    try {
      if (process.env.FILL_OVERLAY !== '0' && !placeholder && beatBpm > 0 && durationS > 12) {
        try {
          // Same hard shelf rules as every other selector (song-edit.ts add_fill):
          // this query used to filter on workspace+role+genre only, so a
          // rejected/failed/rights-unclassified fill could be overlaid on a
          // PASSING render. Genre matching moves to JS (materialGenreMatches)
          // because Prisma exact-equality hid an 'Afrobeats'-tagged fill from an
          // 'afrobeats' lane; genre-null fills stay workspace-wide, and the
          // fetch window widens to 40 so other-genre rows can't crowd it out.
          const fillShelf = await prisma.materialAsset.findMany({
            where: {
              workspaceId: p.workspaceId,
              role: 'fill',
              readiness: 'ready',
              qualityState: 'passed',
              rightsBasis: { not: 'unknown' },
            },
            orderBy: { createdAt: 'desc' },
            take: 40,
          });
          const fillRows = fillShelf.filter(
            (row) => row.genre == null || !p.input.genre || materialGenreMatches(row.genre, p.input.genre)
          );
          const fillMat = selectMaterialRows(fillRows, ['fill'], beatBpm)[0];
          const placements = fillMat ? planFills(beatBpm, durationS, null, genreSignature(p.input.genre).fillBars) : [];
          if (fillMat && placements.length) {
            const [songBytes, rawFillBytes] = await Promise.all([downloadToBuffer(ingestedMain), downloadToBuffer(fillMat.url)]);
            const stretchRatio = beatBpm / (fillMat.sourceBpm || beatBpm);
            const fillBytes = Math.abs(stretchRatio - 1) > 0.001
              ? await transformAudio(rawFillBytes, { tempo: stretchRatio })
              : rawFillBytes;
            // bpm rides along so the fill is trimmed to exactly ONE bar inside
            // the filtergraph (fills.ts ONE-BAR LAW) — an 8-bar forged fill no
            // longer smears 7 bars past every section boundary.
            const mixed = await overlayFills(songBytes, fillBytes, placements.map((f) => f.atS), { bpm: beatBpm });
            const mixedUrl = await uploadBytes({ workspaceId: p.workspaceId, kind: 'beats', bytes: mixed, contentType: 'audio/wav', ext: 'wav' });
            const mixedQc = await measureAudioQuality(mixedUrl).catch(() => null);
            if (!mixedQc || mixedQc.verdict !== 'pass') {
              await deleteObjectByUrl(mixedUrl).catch(() => {});
              console.warn(`[fills] mixed take rejected by QC (${(mixedQc?.flags ?? []).join(', ') || 'unmeasured'})`);
            } else {
              const cleanUrl = ingestedMain;
              ingestedMain = mixedUrl;
              quality = mixedQc;
              appliedFill = {
                materialId: fillMat.id,
                sourceBpm: fillMat.sourceBpm,
                targetBpm: beatBpm,
                stretchRatio: +stretchRatio.toFixed(4),
                placementsS: placements.map((placement) => placement.atS),
              };
              supersededBeatUrl = cleanUrl;
              uncommittedBeatUrl = mixedUrl;
              console.log(`[fills] overlaid ${placements.length} fills @ ${placements.map((f) => Math.round(f.atS) + 's').join(',')}`);
            }
          }
        } catch (err) {
          console.warn('[fills] overlay failed (clean render kept):', (err as Error)?.message);
        }
      }
    } catch (fillErr) {
      console.warn('[fills] overlay skipped (render continues):', (fillErr as Error)?.message);
    }

    // Certify the exact bytes persisted after any fill overlay. This hash is the
    // identity shared by the BeatAsset, source Mix, master receipt and export.
    if (salvageCandidate) salvageCandidate.step = 'certify-download';
    const sourceBytes = await downloadToBuffer(ingestedMain, { maxBytes: 640 * 1024 * 1024 });
    const sourceContentHash = createHash('sha256').update(sourceBytes).digest('hex');
    const vocalIdentityAccepted = !wantsVocals || !!winner.alignment?.pass || !alignmentRequired;

    // A provider may return a finished master without stems. When stems were
    // promised, split the exact re-hosted and certified source that will back the
    // BeatAsset. Keep the job RUNNING until those rows are committed below.
    if (salvageCandidate) salvageCandidate.step = 'stems';
    const stemResolution = await resolveMusicStemSources({
      withStems: p.input.withStems,
      providerStems: out.stems,
      canonicalSourceUrl: ingestedMain,
      apiKey: credentials.replicate,
      workspaceId: p.workspaceId,
    });
    if (stemResolution.source === 'canonical-separation') {
      transientStemSourceUrls.push(...stemResolution.stems.map((stem) => stem.url));
    }
    const preparedStems: Awaited<ReturnType<typeof materializeStemAudio>>[] = [];
    for (const stem of stemResolution.stems) {
      const materialized = await materializeStemAudio({ workspaceId: p.workspaceId, stem });
      preparedStems.push(materialized);
      uncommittedStemUrls.push(materialized.url);
    }

    const trainingUsage = (p.input as {
      trainingUsage?: {
        referenceIds?: string[];
        pinnedReferenceId?: string | null;
        genre?: string;
        measured?: number;
        inferredOnly?: number;
      };
    }).trainingUsage;
    if (salvageCandidate) salvageCandidate.step = 'commit-asset';
    const beat = await prisma.$transaction(async (tx) => {
      const created = await tx.beatAsset.create({
        data: {
        projectId: p.projectId,
        songId: p.songId,
        url: ingestedMain,
        format: appliedFill ? 'wav' : out.format,
        bpm: out.bpm ?? p.input.bpm,
        keySignature: out.keySignature ?? p.input.keySignature,
        duration: durationS,
        provider: adapter.name,
        assetKind: wantsVocals ? 'full_mix' : 'instrumental',
        qualityState: quality.verdict === 'pass' ? 'passed' : quality.verdict,
        contentHash: sourceContentHash,
        verifiedAt: new Date(),
        // Generated by an explicit user action → usable immediately (mix/master/
        // export/reuse all gate on approved). Placeholder fallbacks are excluded.
        approved: !placeholder && vocalIdentityAccepted && !wantsVocals && quality.verdict === 'pass',
        meta: {
          externalId: result.externalId,
          placeholder,
          fallbackReason,
          contentHash: sourceContentHash,
          vocalAlignment: wantsVocals
            ? winner.alignment ?? { state: 'unmeasured', required: alignmentRequired }
            : { state: 'not_applicable' },
          // Best-of-N provenance + measured QC of the WINNING take.
          // §2.3 — persist WHY it won, in lane terms. rankedBy tells the user whether
          // the machine chose with its ears or its ears were shut (non-negotiable).
          bestOf: {
            tried: N,
            rendered: ok.length,
            pickedScore: Math.round(qcScore(quality)),
            laneScore: winnerLane?.overall ?? null,
            laneCoverage: winnerLane?.coverage ?? null,
            failedCritical: winnerLane?.failedCritical ?? [],
            rankedBy,
            blueprintMatch: winner.bp ?? null,
            lyricAlignment: winner.alignment
              ? { state: winner.alignment.state, overall: winner.alignment.overall }
              : { state: wantsVocals ? 'unmeasured' : 'not_applicable' },
            // §11 — if a DRAFT engine produced a low-lane take, name the ENGINE as the
            // limit so the user never thinks they wrote a bad brief.
            engineNote: (!engineAdequacy(adapter.name, p.input.genre ?? '').adequate && (winnerLane?.overall ?? 100) < 60)
              ? engineAdequacy(adapter.name, p.input.genre ?? '').note
              : undefined,
          },
          blueprint: srcBlueprint ?? undefined,
          // TRACEABILITY: which of the artist's trained references shaped this beat
          // (proves "my beats were used" — and measured/total flags backfill need).
          trainingUsage: (p.input as { trainingUsage?: unknown }).trainingUsage ?? undefined,
          fillOverlay: appliedFill ?? undefined,
          qc: quality
            ? { ...quality, durationS: durationS || quality.durationS }
            : { durationS: durationS || null, verdict: durationS >= 12 ? 'pass' : 'fail', ok: durationS >= 12, flags: [] },
        } as never,
        },
      });
      await Promise.all(
        preparedStems.map((stem) =>
          tx.stem.create({
            data: {
              beatId: created.id,
              role: stem.role,
              url: stem.url,
              format: stem.format,
            },
          }),
        ),
      );
      const referenceIds = [...new Set((trainingUsage?.referenceIds ?? []).filter(Boolean))];
      if (referenceIds.length) {
        const references: TrainingReferenceRow[] = await tx.soundReference.findMany({
          where: {
            workspaceId: p.workspaceId,
            id: { in: referenceIds },
            active: true,
            analysisState: { not: 'failed' },
            rightsBasis: { not: 'unknown' },
          },
          select: { id: true, title: true, analysisState: true, rightsBasis: true },
        });
        const byId = new Map(references.map((reference) => [reference.id, reference]));
        await tx.referenceUsage.createMany({
          data: referenceIds.flatMap((referenceId, position) => {
            const reference = byId.get(referenceId);
            if (!reference) return [];
            return [{
              workspaceId: p.workspaceId,
              referenceId,
              providerJobId: p.jobId,
              beatId: created.id,
              songId: p.songId ?? null,
              genre: trainingUsage?.genre || p.input.genre || 'unknown',
              position,
              pinned: trainingUsage?.pinnedReferenceId === referenceId,
              influence: {
                path: 'production-brief+style-tags+measured-tags',
                title: reference.title,
                analysisState: reference.analysisState,
                rightsBasis: reference.rightsBasis,
              } as never,
            }];
          }),
          skipDuplicates: true,
        });
      }
      if (appliedFill) {
        await tx.materialUsage.create({
          data: {
            workspaceId: p.workspaceId,
            materialId: appliedFill.materialId,
            providerJobId: p.jobId,
            beatId: created.id,
            songId: p.songId ?? null,
            role: 'fill',
            sourceBpm: appliedFill.sourceBpm,
            targetBpm: appliedFill.targetBpm,
            stretchRatio: appliedFill.stretchRatio,
            gain: 0.5,
            pan: 0,
            sections: { placementsS: appliedFill.placementsS } as never,
          },
        });
      }
      return created;
    });
    uncommittedBeatUrl = null;
    uncommittedStemUrls = [];
    // Asset committed: post-commit failures complete the job (the song exists);
    // the salvage-create path is no longer needed.
    committedBeatId = beat.id;
    salvageCandidate = null;
    const persistedStemCount = await prisma.stem.count({ where: { beatId: beat.id } });
    enforceMusicStemPersistence(p.input.withStems, persistedStemCount);
    if (supersededBeatUrl) {
      await deleteObjectByUrl(supersededBeatUrl).catch(() => {});
      supersededBeatUrl = null;
    }

    // SELF-TRAINING (legal — our own output, zero third-party material): every
    // full sung song whose measured QC PASSES becomes a SoundReference, so the
    // library compounds from every good record the studio makes. The recipe is
    // the actual production directives that produced it + the measured result.
    // Uploads still outrank these at retrieval (they're the artist's true sound);
    // failures and weak takes never enter the library.
    // MiniMax/Suno raw renders ALWAYS trip 'clipping' (they ship hot) → verdict
    // 'fail', so a pass-only gate would never learn from the default engine. A
    // clip-ONLY finished-engine take is genuinely good — the auto-master tames that
    // peak — so it should feed the library; anything else wrong (too_quiet /
    // squashed / flat / short) still stays out.
    const clipOnlyFinished =
      finished &&
      quality?.verdict === 'fail' &&
      (quality.flags ?? []).length === 1 &&
      quality.flags?.[0] === 'clipping';
    // WO-4(f) PROMOTION RULE — measure everything, promote selectively. Every
    // take enters the GAP MAP (Song.laneScore, above); only takes that PASS
    // promotion enter the REFERENCE LAKE that feeds buildLaneProfile. Averaging
    // our own misses into the lane target would teach the studio to repeat them.
    // Pass = lane score ≥ LANE_PROMOTE_MIN (70) with coverage ≥ 0.8 when the ear
    // ranked this render; ear-blind renders fall back to the QC-pass rule (the
    // profile builder itself only reads rows that carry measured facts).
    // ADDENDUM C-2 — an EXPERT-PRIOR lane may not bootstrap from its own output:
    // self-promotion is LOCKED until the lane is grounded in ≥3 non-self refs
    // (owned uploads or facts-only records). Scoring ourselves against a guess
    // and promoting the matches is a feedback loop, not learning.
    const grounding = await laneGrounding(p.workspaceId, p.input.genre).catch(() => ({ external: 0, factsOnly: 0, self: 0, grounded: false }));
    if (!grounding.grounded && wantsVocals) {
      console.log(`[lane] ${p.input.genre}: self-promotion locked (${grounding.external + grounding.factsOnly} external refs — expert-prior lane)`);
    }
    const promoteMin = Number(process.env.LANE_PROMOTE_MIN ?? 70);
    // ONE promotion law (shared promotionEligible) for render-time and the
    // nightly retro pass; ear-blind renders may still add prose-only rows when
    // the lane is grounded (they carry no measured field → can't touch profiles).
    const lanePromotable =
      grounding.grounded && (winnerLane == null || promotionEligible({ laneScore: winnerLane.overall, coverage: winnerLane.coverage, grounded: grounding.grounded, min: promoteMin }));
    if (wantsVocals && lanePromotable && (quality?.verdict === 'pass' || clipOnlyFinished)) {
      // Dedupe: at most ONE self-training row per workspace+genre per day —
      // otherwise generated rows flood the library and bury the artist's real
      // uploads at retrieval.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentGenerated = await prisma.soundReference.count({
        where: {
          workspaceId: p.workspaceId,
          genre: p.input.genre ?? undefined,
          active: true,
          createdAt: { gte: since },
          title: { startsWith: 'generated' },
        },
      });
      if (recentGenerated > 0) {
        // Already learned from today's renders in this genre — skip quietly.
      } else {
      await prisma.soundReference
        .create({
          data: {
            workspaceId: p.workspaceId,
            genre: p.input.genre ?? null,
            sourceUrl: ingestedMain,
            title: `generated · ${p.input.genre ?? 'song'} · ${adapter.name}`,
            recipe: {
              source: 'generated',
              engine: adapter.name,
              genre: p.input.genre,
              bpm: out.bpm ?? p.input.bpm,
              dnaTags: p.input.dnaTags ?? [],
              vibePrompt: (p.input.vibePrompt ?? '').slice(0, 500),
              qc: quality,
              // Persist the winner's full MeasuredAnalysis so buildLaneProfile() LEARNS
              // from our own good records — the library compounds into real lane data,
              // not just tags. (anti-pattern #9.)
              measured: winner.measured ?? undefined,
            } as never,
            summary: `Generated ${p.input.genre ?? ''} record (${Math.round(quality?.loudnessRangeLra ?? 0)}LU range, crest ${quality?.crestFactorDb ?? '—'}dB) on ${adapter.name}: ${(p.input.dnaTags ?? []).slice(0, 6).join(', ')}`,
            analysisState: winner.measured?.engineOk ? 'measured' : 'inferred',
            rightsBasis: 'self-generated',
          },
        })
        .catch((err: unknown) => console.warn('[music] self-training reference write failed:', (err as Error)?.message));
      }
    }

    // AUTO-MASTER — a record is NOT done until it can compete sonically (the
    // A&R read itself was flagging "not mastered"). Master inline right here
    // (same host, same ffmpeg): wrap the render as the source Mix, run the
    // streaming chain, shelve an approved Master. The catalog serves the
    // MASTERED file from now on. A full-song job only succeeds after this exact
    // artifact passes QC; the raw source remains unapproved audit evidence.
    let masteredUrl: string | null = null;
    // WAV master URL kept for the self-feeding harvest below — Demucs separates
    // the lossless artifact, not the delivery mp3.
    let masteredWavUrl: string | null = null;
    if (wantsVocals && !placeholder && p.songId) {
      let uncommittedMasterUrls: string[] = [];
      try {
        if (!(await ffmpegAvailable())) throw new Error('master_qc_failed: ffmpeg is unavailable');
          // LOUDNESS LAW v2: the old HEADROOM LAW parked every default master at
          // -16.5/-14 LUFS while commercial Afrobeats ships at -8.5..-11 — THAT
          // gap is the "masters sound weak" complaint, and the old one-pass
          // loudnorm undershot its target 1-3 LU on top of it. Default is now
          // commercial Afro loudness (-9 LUFS / -1.0 dBTP) via the two-pass drive
          // chain for BOTH finished and raw engines ('finished' still routes
          // light-touch conform vs full EQ/glue chain inside master()).
          // 'breathe_-16.5' remains the honest dynamics-first OPT-IN, not the default.
          const preset = 'afro_stream_-9';
          // GENRE-CURVE WIRING (source-truth wave item 7): the per-genre tone
          // curves (amapiano low-mid control / afrobeats percussion presence)
          // existed in master() but no caller ever passed the genre — every
          // lane got the default curve. Canonicalized so 'Amapiano' still hits
          // its curve. The finished/conform path stays tone-neutral by
          // doctrine; genre is inert there.
          const { wav, mp3 } = await ffmpegMaster({
            mix: sourceBytes,
            preset,
            finished,
            genre: normalizeMaterialGenre(p.input.genre) || undefined,
          });
          const [wavUrl, mp3Url] = await Promise.all([
            uploadBytes({ workspaceId: p.workspaceId, kind: 'masters', bytes: wav, contentType: 'audio/wav', ext: 'wav' }),
            uploadBytes({ workspaceId: p.workspaceId, kind: 'masters', bytes: mp3, contentType: 'audio/mpeg', ext: 'mp3' }),
          ]);
          uncommittedMasterUrls = [wavUrl, mp3Url];
          const target = MASTER_TARGETS[preset]!;
          // Certify what actually SHIPPED (same rule as the re-master worker):
          // measure the mastered artifact and store the MEASURED loudness — the
          // target is only the fallback, never the claim.
          const masterQc = await measureAudioQuality(wavUrl).catch(() => null);
          if (!masterQc || masterQc.verdict !== 'pass') {
            throw new Error(`master_qc_failed: ${masterQc?.flags.join(', ') || masterQc?.verdict || 'unmeasured'}`);
          }
          const measuredLufs = masterQc?.integratedLufs ?? null;
          if (measuredLufs !== null && measuredLufs < target.lufs - 1.5) {
            console.warn(`[music] auto-master undershot target: measured ${measuredLufs.toFixed(1)} LUFS vs ${target.lufs} (${preset}) — the two-pass trim should not do this, check the chain`);
          }
          const masterVerifiedAt = new Date();
          const wavHash = createHash('sha256').update(wav).digest('hex');
          const mp3Hash = createHash('sha256').update(mp3).digest('hex');
          // Provider full-song bytes are playable after QC, but they are not release
          // lineage. Release stays closed through the explicit source-claim gate;
          // `approved` here means canonical playback, not distribution clearance.
          const releaseLineageCertified = false;
          await prisma.$transaction(async (tx) => {
            const mixRow = await tx.mix.create({
              data: {
                projectId: p.projectId,
                songId: p.songId,
                preset: 'source',
                url: ingestedMain,
                notes: 'Full-song source for automatic mastering',
                qualityState: quality?.verdict === 'pass' ? 'passed' : quality?.verdict ?? 'unmeasured',
                contentHash: sourceContentHash,
                verifiedAt: new Date(),
                meta: {
                  qc: quality,
                  assetKind: 'full_mix',
                  releaseLineageCertified,
                  vocalAlignment: winner.alignment ?? { state: 'unmeasured', required: alignmentRequired },
                } as never,
                approved: quality?.verdict === 'pass',
              },
            });
            await tx.master.create({
              data: {
                projectId: p.projectId,
                songId: p.songId,
                mixId: mixRow.id,
                preset,
                url: wavUrl,
                loudness: measuredLufs ?? target.lufs,
                qualityState: 'passed',
                contentHash: wavHash,
                verifiedAt: masterVerifiedAt,
                approved: true,
                meta: {
                  qc: masterQc,
                  releaseLineageCertified,
                  sourceMixId: mixRow.id,
                  verifiedAt: masterVerifiedAt.toISOString(),
                  contentHash: wavHash,
                  deliveryMp3: { url: mp3Url, contentHash: mp3Hash },
                  sourceContentHash,
                  vocalAlignment: winner.alignment ?? { state: 'unmeasured', required: alignmentRequired },
                } as never,
              },
            });
          // A fresh render just became the current audio (re-sing lands here) —
          // clear any instrumental/acapella split from the PREVIOUS take.
            await tx.song.update({ where: { id: p.songId }, data: { status: 'MASTERED', releaseReady: false, instrumentalUrl: null, acapellaUrl: null, instrumentalMeta: Prisma.DbNull } });
          });
          uncommittedMasterUrls = [];
          masteredUrl = mp3Url;
          masteredWavUrl = wavUrl;
      } catch (err) {
        await Promise.allSettled(uncommittedMasterUrls.map((url) => deleteObjectByUrl(url)));
        throw new Error(`music_generation_failed: ${(err as Error)?.message || 'automatic mastering failed'}`);
      }
    }

    // PHASE 4 — close the lane loop: measure this take, score it against its lane,
    // and store the repair steering on the beat so the next regen is pushed back
    // in-lane. Gated (LANE_ASSESS=1 + ear available); a no-op otherwise, never fatal.
    if (!placeholder) {
      await assessLaneCompliance({ workspaceId: p.workspaceId, genre: p.input.genre, beatId: beat.id, audioUrl: masteredUrl ?? ingestedMain, songId: p.songId ?? null });
    }

    // SELF-FEEDING LIBRARY (owner's law: "every song created becomes ours").
    // LEGAL BOUNDARY, non-negotiable: only songs CREATED in this studio enter
    // this path (the render above IS ours), it is workspace-scoped, and no
    // external audio can reach it. A render that PASSES the same promotion
    // gate that feeds the reference lake gets its winning MASTER stem-harvested
    // into workspace material (source 'self_stem', rightsBasis
    // 'self-generated') — passing songs' drums/bass/instrumental join the
    // shelf the own-engine assembles from.
    //
    // COST: one Demucs separation per promoted song (local CPU on the lake-
    // starved container, or the paid Replicate route) — hence the env gate.
    // Enqueued beat-LESS on purpose: the stems processor's beat-attached path
    // REPLACES the beat's user-facing Stem rows, and this harvest must only
    // grow the material shelf, never touch what the artist sees.
    //
    // Idempotency, three layers: the ProviderJob receipt below (one harvest
    // per beat), the BullMQ jobId dedupe, and MaterialAsset's unique
    // (workspaceId, contentHash) — stems.ts pre-checks the hash and skips
    // duplicates gracefully, so a re-harvest can never double-file a loop.
    const selfHarvestEligible =
      wantsVocals &&
      lanePromotable &&
      (quality?.verdict === 'pass' || clipOnlyFinished) &&
      masteredWavUrl != null &&
      !placeholder &&
      (process.env.SELF_HARVEST_ENABLED ?? '1') !== '0';
    if (selfHarvestEligible) {
      try {
        const already = await prisma.providerJob.findFirst({
          where: {
            workspaceId: p.workspaceId,
            kind: 'stems',
            inputJson: { path: ['selfHarvestBeatId'], equals: beat.id },
          },
          select: { id: true },
        });
        if (!already) {
          const harvestJob = await prisma.providerJob.create({
            data: {
              workspaceId: p.workspaceId,
              projectId: p.projectId,
              kind: 'stems',
              provider: 'replicate',
              status: 'QUEUED',
              inputJson: {
                mode: 'stems',
                selfHarvest: true,
                selfHarvestBeatId: beat.id,
                songId: p.songId ?? null,
                sourceUrl: masteredWavUrl,
              } as never,
            },
          });
          await enqueueJob(
            'music',
            'stems',
            {
              jobId: harvestJob.id,
              workspaceId: p.workspaceId,
              projectId: p.projectId,
              mode: 'stems',
              sourceUrl: masteredWavUrl,
              selfHarvest: true,
            },
            { jobId: `self-harvest-${beat.id}` }
          );
          console.log(`[self-harvest] promoted render → stem harvest queued (beat ${beat.id})`);
        }
      } catch (err) {
        // The song is already shipped — a harvest hiccup must never fail it.
        console.warn('[self-harvest] enqueue failed (render unaffected):', (err as Error)?.message);
      }
    }

    await markSucceeded(
      p.jobId,
      {
        beatId: beat.id,
        stems: persistedStemCount,
        stemSource: stemResolution.source,
        placeholder,
        fallbackReason,
        autoMastered: !!masteredUrl,
        masterUrl: masteredUrl,
        contentHash: sourceContentHash,
        vocalAlignment: wantsVocals
          ? winner.alignment ?? { state: 'unmeasured', required: alignmentRequired }
          : { state: 'not_applicable' },
        bestOf: { tried: N, rendered: ok.length, laneScore: winnerLane?.overall ?? null, rankedBy },
      },
      result.estimatedCostUsd
    );
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
    const causeNote = cause?.code || cause?.message ? ` (cause: ${cause?.code ?? cause?.message})` : '';
    // SALVAGE LAW: a failure after the asset committed completes the job (the
    // song exists); a failure after a winner existed but before commit turns
    // the already-durable candidate into an honest unprocessed asset. Only a
    // failure with NO winner — nothing paid for, nothing to save — fails.
    if (committedBeatId) {
      console.warn(`[music] post-commit step failed (${(err as Error).message}${causeNote}) — asset ${committedBeatId} is committed; completing the job`);
      await markSucceeded(p.jobId, {
        beatId: committedBeatId,
        postProcessing: 'incomplete',
        note: `a post-commit step failed (${(err as Error).message.slice(0, 160)}${causeNote}); the song is saved — Re-master finishes what remained`,
      });
      return;
    }
    if (salvageCandidate) {
      const s = salvageCandidate;
      console.warn(`[music] post-render step '${s.step}' failed (${(err as Error).message}${causeNote}) — SALVAGING the paid take (never re-render on post-processing weather)`);
      try {
        const keep = temporaryCandidateUrls.indexOf(s.url);
        if (keep >= 0) temporaryCandidateUrls.splice(keep, 1);
        const salvaged = await prisma.beatAsset.create({
          data: {
            projectId: s.projectId,
            songId: s.songId,
            url: s.url,
            format: s.format,
            bpm: s.bpm,
            keySignature: s.keySignature,
            duration: s.durationS,
            provider: s.provider,
            assetKind: s.assetKind,
            qualityState: 'unmeasured',
            approved: false,
            meta: {
              externalId: s.externalId,
              salvage: { failedStep: s.step, error: `${(err as Error).message.slice(0, 240)}${causeNote}` },
              vocalAlignment: s.alignment,
            } as never,
          },
        });
        await markSucceeded(p.jobId, {
          beatId: salvaged.id,
          salvage: true,
          note: `post-processing step '${s.step}' failed — the paid render was saved unprocessed; Re-master finishes and verifies it`,
        });
        return;
      } catch (salvageErr) {
        console.warn(`[music] salvage itself failed (${(salvageErr as Error).message}) — falling through to failure`);
      }
    }
    if (uncommittedBeatUrl) await deleteObjectByUrl(uncommittedBeatUrl).catch(() => {});
    await Promise.allSettled(uncommittedStemUrls.map((url) => deleteObjectByUrl(url)));
    if (supersededBeatUrl) await deleteObjectByUrl(supersededBeatUrl).catch(() => {});
    await markFailed(p.jobId, `${(err as Error)?.message ?? err}${causeNote}`);
  } finally {
    const transientUrls = [...new Set([...temporaryCandidateUrls, ...transientStemSourceUrls])];
    await Promise.allSettled(transientUrls.map((url) => deleteObjectByUrl(url)));
  }
}
