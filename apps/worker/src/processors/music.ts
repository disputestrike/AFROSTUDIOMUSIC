import { prisma } from '@afrohit/db';
import { musicAdapter, sunoKey } from '@afrohit/ai';
import type { MusicGenerationInput } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { ingestRemoteFile, downloadToBuffer, uploadBytes } from '../lib/storage';
import { probeDurationS, measureAudioQuality, ffmpegAvailable, master as ffmpegMaster, MASTER_TARGETS, type AudioQuality } from '../lib/ffmpeg';
import { assessLaneCompliance, loadLaneProfile } from '../lib/lane-assess';
import { overlayFills } from '../lib/fills';
import { measureAudio, dspAvailable } from '../lib/dsp';
import { planFills, scoreLaneCompliance, type LaneComplianceScore, type MeasuredAnalysis } from '@afrohit/shared';

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
function rankTakes(a: { qc: AudioQuality | null; lane: LaneComplianceScore | null }, b: { qc: AudioQuality | null; lane: LaneComplianceScore | null }): number {
  const usable = (x: { lane: LaneComplianceScore | null }) => x.lane != null && x.lane.coverage >= MIN_COVERAGE_FOR_RANKING;
  if (usable(a) && usable(b)) {
    const critA = a.lane!.failedCritical.length > 0 ? 1 : 0;
    const critB = b.lane!.failedCritical.length > 0 ? 1 : 0;
    if (critA !== critB) return critA - critB; // no-critical-failure wins outright
    const laneDelta = b.lane!.overall - a.lane!.overall;
    if (Math.abs(laneDelta) > 2) return laneDelta; // lane compliance decides
  }
  return qcScore(b.qc) - qcScore(a.qc);
}

interface MusicPayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId?: string;
  input: MusicGenerationInput;
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
    // FULL-SONG ENGINE: prefer Suno V5 (the strongest full-production model) when a
    // Engine ladder for SUNG songs: Suno (best, needs SUNO_API_KEY) → MiniMax
    // (strong, on the workspace Replicate key) → ACE-Step (last resort). MiniMax
    // is the default fallback because ACE-Step's vocals were the "whack singing"
    // — MiniMax music-2.6 is markedly better for Afrobeats vocals.
    let engine = p.input.songEngine ?? (sunoKey() ? 'suno' : 'minimax');
    if (engine === 'suno' && !sunoKey()) engine = 'minimax';
    // Suno uses its OWN key (SUNO_API_KEY), never the workspace's Replicate key.
    const engineKey = engine === 'suno' ? undefined : ws?.musicApiKey ?? undefined;
    let adapter = wantsVocals
      ? musicAdapter(engine, engineKey)
      : musicAdapter(ws?.musicProvider ?? undefined, ws?.musicApiKey ?? undefined);
    type GenResult = Awaited<ReturnType<typeof adapter.generate>>;

    // minimax/suno DELIVER a finished, loudness-maximised master (they ship hot on
    // purpose); ace_step/replicate/musicgen are rawer. The auto-master conforms a
    // finished engine light-touch (loudness + true-peak only) instead of running
    // the full EQ/glue-comp chain on top, and the self-training gate treats their
    // always-hot ("clipping") raw QC differently from a genuinely broken take.
    const finished = adapter.name === 'minimax' || adapter.name === 'suno';

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
    // BEST_OF_N default 3 (serious) per the FINAL INSTRUCTION — one take is not
    // hit-making, and PATCH 1 now ranks the N takes on LANE, which is the only reason
    // raising N is worth it. Staggered starts + 429-retry (below) tame the Replicate
    // burst limit. Set BEST_OF_N=1 for a fast draft, up to 5 for premium/high-stakes.
    const N = Math.max(1, Math.min(Number(p.input.candidates ?? process.env.BEST_OF_N ?? 3), 5));
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
    const ok = settled.filter((r) => r.status === 'succeeded' && r.output);

    // NO FAKE AUDIO. If every candidate failed on a real provider, fail the job
    // with the real reason — never substitute a placeholder and call it the song.
    const placeholder = false;
    const fallbackReason: string | undefined = undefined;
    if (!ok.length) {
      const reason = settled.find((r) => r.error)?.error ?? 'provider_failed';
      await markFailed(p.jobId, `music_generation_failed: ${reason} — no placeholder emitted; retry or switch engine in Settings.`);
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
    const scored = await Promise.all(
      ok.map(async (r) => {
        const url = r.output?.mainAudioUrl;
        const qc = url ? await measureAudioQuality(url).catch(() => null) : null;
        let measured: MeasuredAnalysis | null = null;
        let lane: LaneComplianceScore | null = null;
        if (dspUp && url) {
          const m = await measureAudio(url).catch(() => null);
          if (m?.engineOk) { measured = m; if (laneProfile) lane = scoreLaneCompliance(m, laneProfile); }
        }
        return { r, qc, lane, measured };
      })
    );
    scored.sort(rankTakes);
    const winner = scored[0]!;
    const result = winner.r;
    const out = result.output!;
    let quality: AudioQuality | null = winner.qc;
    const winnerLane = winner.lane;
    const rankedBy = winnerLane && winnerLane.coverage >= MIN_COVERAGE_FOR_RANKING ? 'lane-compliance' : 'mix-quality (ear blind or coverage thin)';
    console.log(`[music] best-of-${ok.length} ranked by ${rankedBy}${winnerLane ? ` — lane ${winnerLane.overall}/100 cov ${(winnerLane.coverage * 100) | 0}% failedCritical=[${winnerLane.failedCritical.join(',')}]` : ''}`);

    // Re-host ONLY the winning take (survives provider URL expiry; stable CDN path).
    let ingestedMain = await ingestRemoteFile({
      workspaceId: p.workspaceId,
      url: out.mainAudioUrl,
      kind: 'beats',
      ext: out.format,
      contentType: out.format === 'mp3' ? 'audio/mpeg' : out.format === 'flac' ? 'audio/flac' : 'audio/wav',
    });

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

    // PHASE 5 — insert drum fills into the section transitions (the fills Benjamin
    // keeps missing). Gated FILL_OVERLAY=1 (quality-sensitive) and only when a fill
    // material for the genre exists. Best-effort: any failure keeps the clean render.
    const beatBpm = out.bpm ?? p.input.bpm ?? 0;
    if (process.env.FILL_OVERLAY !== '0' && !placeholder && beatBpm > 0 && durationS > 12) {
      try {
        const fillMat = await prisma.materialAsset.findFirst({
          where: { workspaceId: p.workspaceId, role: 'fill', OR: [{ genre: p.input.genre ?? undefined }, { genre: null }] },
          orderBy: { createdAt: 'desc' },
        });
        const placements = fillMat ? planFills(beatBpm, durationS, null) : [];
        if (fillMat && placements.length) {
          const [songBytes, fillBytes] = await Promise.all([downloadToBuffer(ingestedMain), downloadToBuffer(fillMat.url)]);
          const mixed = await overlayFills(songBytes, fillBytes, placements.map((f) => f.atS));
          ingestedMain = await uploadBytes({ workspaceId: p.workspaceId, kind: 'beats', bytes: mixed, contentType: 'audio/wav', ext: 'wav' });
          console.log(`[fills] overlaid ${placements.length} fills @ ${placements.map((f) => Math.round(f.atS) + 's').join(',')}`);
        }
      } catch (err) {
        console.warn('[fills] overlay failed (clean render kept):', (err as Error)?.message);
      }
    }

    const beat = await prisma.beatAsset.create({
      data: {
        projectId: p.projectId,
        songId: p.songId,
        url: ingestedMain,
        format: out.format,
        bpm: out.bpm ?? p.input.bpm,
        keySignature: out.keySignature ?? p.input.keySignature,
        duration: durationS,
        provider: adapter.name,
        // Generated by an explicit user action → usable immediately (mix/master/
        // export/reuse all gate on approved). Placeholder fallbacks are excluded.
        approved: !placeholder,
        meta: {
          externalId: result.externalId,
          placeholder,
          fallbackReason,
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
          },
          qc: quality
            ? { ...quality, durationS: durationS || quality.durationS }
            : { durationS: durationS || null, verdict: durationS >= 12 ? 'pass' : 'fail', ok: durationS >= 12, flags: [] },
        } as never,
      },
    });

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
    if (wantsVocals && (quality?.verdict === 'pass' || clipOnlyFinished)) {
      // Dedupe: at most ONE self-training row per workspace+genre per day —
      // otherwise generated rows flood the library and bury the artist's real
      // uploads at retrieval.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentGenerated = await prisma.soundReference.count({
        where: { workspaceId: p.workspaceId, genre: p.input.genre ?? undefined, createdAt: { gte: since }, title: { startsWith: 'generated' } },
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
          },
        })
        .catch((err) => console.warn('[music] self-training reference write failed:', (err as Error)?.message));
      }
    }

    if (out.stems?.length) {
      // Ingest each stem to our bucket first (parallel I/O), THEN build the
      // Prisma transaction. $transaction needs PrismaPromise[], not resolved values.
      const ingested = await Promise.all(
        out.stems.map(async (s) => ({
          role: s.role,
          url: await ingestRemoteFile({
            workspaceId: p.workspaceId,
            url: s.url,
            kind: 'stems',
            ext: 'wav',
            contentType: 'audio/wav',
          }),
        }))
      );
      await prisma.$transaction(
        ingested.map((s) =>
          prisma.stem.create({
            data: { beatId: beat.id, role: s.role, url: s.url, format: 'wav' },
          })
        )
      );
    }

    // AUTO-MASTER — a record is NOT done until it can compete sonically (the
    // A&R read itself was flagging "not mastered"). Master inline right here
    // (same host, same ffmpeg): wrap the render as the source Mix, run the
    // streaming chain, shelve an approved Master. The catalog serves the
    // MASTERED file from now on. Best-effort: a master hiccup never kills the
    // render — the raw take stays playable and Re-master still exists.
    let masteredUrl: string | null = null;
    if (wantsVocals && !placeholder && p.songId) {
      try {
        if (await ffmpegAvailable()) {
          // Finished engines (minimax/suno) already deliver a competitive, loud
          // master — conform it to ~-9 LUFS (commercial Afro loudness) light-touch,
          // don't master it DOWN to -14 with a full EQ/comp chain (that made the
          // catalog ~5 dB quieter and duller than the raw beat the Create page
          // plays — the "sounds weak" complaint). Raw engines keep the -14 chain.
          const preset = finished ? 'afro_stream_-9' : 'streaming_lufs_-14';
          const mixRow = await prisma.mix.create({
            data: { projectId: p.projectId, songId: p.songId, preset: 'source', url: ingestedMain, notes: 'Master source (auto, from render)', approved: true },
          });
          const srcBytes = await downloadToBuffer(ingestedMain);
          const { wav, mp3 } = await ffmpegMaster({ mix: srcBytes, preset, finished });
          const [wavUrl, mp3Url] = await Promise.all([
            uploadBytes({ workspaceId: p.workspaceId, kind: 'masters', bytes: wav, contentType: 'audio/wav', ext: 'wav' }),
            uploadBytes({ workspaceId: p.workspaceId, kind: 'masters', bytes: mp3, contentType: 'audio/mpeg', ext: 'mp3' }),
          ]);
          const target = MASTER_TARGETS[preset]!;
          await prisma.master.create({
            data: { projectId: p.projectId, songId: p.songId, mixId: mixRow.id, preset, url: wavUrl, loudness: target.lufs, approved: true },
          });
          await prisma.song.update({ where: { id: p.songId }, data: { status: 'MASTERED' } });
          masteredUrl = mp3Url;
        }
      } catch (err) {
        console.warn('[music] auto-master failed (render still usable):', (err as Error)?.message);
      }
    }

    // PHASE 4 — close the lane loop: measure this take, score it against its lane,
    // and store the repair steering on the beat so the next regen is pushed back
    // in-lane. Gated (LANE_ASSESS=1 + ear available); a no-op otherwise, never fatal.
    if (!placeholder) {
      await assessLaneCompliance({ workspaceId: p.workspaceId, genre: p.input.genre, beatId: beat.id, audioUrl: masteredUrl ?? ingestedMain });
    }

    await markSucceeded(
      p.jobId,
      { beatId: beat.id, stems: out.stems?.length ?? 0, placeholder, fallbackReason, autoMastered: !!masteredUrl, masterUrl: masteredUrl, bestOf: { tried: N, rendered: ok.length, laneScore: winnerLane?.overall ?? null, rankedBy } },
      result.estimatedCostUsd
    );
  } catch (err) {
    await markFailed(p.jobId, err);
  }
}
