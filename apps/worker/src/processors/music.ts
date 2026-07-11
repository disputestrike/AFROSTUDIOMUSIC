import { prisma, Prisma } from '@afrohit/db';
import { musicAdapter, sunoKey, defaultInstrumentalEngine } from '@afrohit/ai';
import type { MusicGenerationInput } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { ingestRemoteFile, downloadToBuffer, uploadBytes } from '../lib/storage';
import { probeDurationS, measureAudioQuality, ffmpegAvailable, master as ffmpegMaster, MASTER_TARGETS, type AudioQuality } from '../lib/ffmpeg';
import { assessLaneCompliance, loadLaneProfile, laneGrounding } from '../lib/lane-assess';
import { overlayFills } from '../lib/fills';
import { measureAudio, dspAvailable } from '../lib/dsp';
import { genreSignature, planFills, scoreLaneCompliance, engineAdequacy, structureMatch, blueprintFromMeasured, isFirstPartyWorkspace, resolveEngineForWorkspace, promotionEligible, type LaneComplianceScore, type MeasuredAnalysis, type SongBlueprint } from '@afrohit/shared';

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
function takeScore(x: { qc: AudioQuality | null; lane: LaneComplianceScore | null; bp?: number | null }): number {
  const mix = qcScore(x.qc);
  const usable = x.lane != null && x.lane.coverage >= MIN_COVERAGE_FOR_RANKING;
  if (!usable) return mix; // unmeasured: mix only (as before)
  const crit = x.lane!.failedCritical.length > 0 ? 1 : 0;
  const bpBucket = x.bp != null ? Math.round(x.bp / 0.07) : 0; // 0.07 deadband → bucket
  const laneBucket = Math.round(x.lane!.overall / 2); // 2pt deadband → bucket
  // A critical-failed take sinks below everything (even unmeasured); otherwise
  // blueprint dominates, then lane, then mix as the tiebreak.
  return (crit ? -1e9 : 0) + bpBucket * 1e6 + laneBucket * 1e3 + mix;
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
    // AUDIT FIX: a sung song requested with NO lyrics used to be SILENTLY demoted
    // to an instrumental (which could be the stub) and stored as an approved
    // "song" — a confusing "it didn't work". If vocals were asked for but the
    // writer produced nothing, fail with the real reason instead of faking a beat.
    if (p.input.withVocals && !p.input.lyrics) {
      console.warn('[music] vocal song requested but lyrics are empty — writer/brain likely failed upstream');
      await markFailed(p.jobId, 'music_generation_failed: the lyrics were not written (the writer may be unavailable) — try again.');
      return;
    }
    // FULL-SONG ENGINE: prefer Suno V5 (the strongest full-production model) when a
    // Engine ladder for SUNG songs: Suno (best, needs SUNO_API_KEY) → MiniMax
    // (strong, on the workspace Replicate key) → ACE-Step (last resort). MiniMax
    // is the default fallback because ACE-Step's vocals were the "whack singing"
    // — MiniMax music-2.6 is markedly better for Afrobeats vocals.
    // W-2 THE WALL: the bridge is not a customer render path — a non-first-party
    // workspace requesting 'suno' is hard-substituted to the best resellable
    // engine, in CODE, so misconfiguration cannot leak bridge output.
    const firstParty = isFirstPartyWorkspace(p.workspaceId);
    const resolved = resolveEngineForWorkspace(p.input.songEngine ?? (sunoKey() && firstParty ? 'suno' : 'minimax'), { firstParty, sunoAvailable: !!sunoKey() });
    if (resolved.wallSubstituted) console.log(`[wall] bridge blocked for customer workspace ${p.workspaceId} — rendering on ${resolved.engine}`);
    let engine = resolved.engine as 'suno' | 'minimax' | 'ace_step';
    if (engine === 'suno' && !sunoKey()) engine = 'minimax';
    // Suno uses its OWN key (SUNO_API_KEY), never the workspace's Replicate key.
    const engineKey = engine === 'suno' ? undefined : ws?.musicApiKey ?? undefined;
    let adapter = wantsVocals
      ? musicAdapter(engine, engineKey)
      // INSTRUMENTAL: route to a REAL engine on the key that exists. A
      // Replicate-only operator (no Suno) got the stub here because the
      // instrumental path ignored their Replicate key — now it falls to
      // Replicate MusicGen instead of a dead stub.
      : musicAdapter(ws?.musicProvider ?? defaultInstrumentalEngine(), ws?.musicApiKey ?? undefined);
    // A3-2 — REFERENCE-AUDIO ADJUST: when the job carries the song's own audio,
    // condition the render on it (audio in, repaired audio out) instead of
    // re-rolling from tags. The reference id is logged so every Adjust run is
    // traceable to its source sound (internal log — wall-safe).
    if (p.input.referenceAudioUrl && wantsVocals) {
      adapter = musicAdapter('minimax_ref', engineKey);
      // HONESTY: no conditioning engine is configured (fal removed by owner
      // directive) — the render is UNCONDITIONED; the reference steers only
      // through the brief/lane repair. Never claim conditioning that didn't run.
      console.log(`[adjust] steered re-render (unconditioned — no conditioning engine) — reference-input=${String(p.input.referenceAudioUrl).slice(0, 80)}`);
    }
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
    const ok = settled.filter((r) => r.status === 'succeeded' && r.output);

    // STUB GUARD (audit CRITICAL). The stub adapter SUCCEEDS with a SoundHelix
    // placeholder mp3, so the all-fail guard below never caught it — it was
    // stored as an APPROVED, genre-labelled "song" (this is the "embarrassing,
    // non-Afro audio"). voice.ts/image.ts already guard this; the music path did
    // not. Detect the stub by adapter name AND by the placeholder host in the
    // winning URL, and FAIL LOUDLY in production (unless a dev opts in) instead
    // of shipping a rock sample as an Afro beat.
    const placeholder =
      adapter.name === 'stub' ||
      ok.some((r) => /soundhelix\.com/i.test((r.status === 'succeeded' && r.output?.mainAudioUrl) || ''));
    const fallbackReason: string | undefined = undefined;
    if (placeholder && process.env.ALLOW_STUB_AUDIO !== '1') {
      console.warn(`[music] stub/placeholder audio blocked (adapter=${adapter.name}) — no real music engine configured`);
      await markFailed(p.jobId, 'music_generation_failed: no music engine configured — set a real engine (MUSIC_PROVIDER / SUNO_API_KEY / a workspace engine in Settings), then retry.');
      return;
    }
    if (!ok.length) {
      const reason = settled.find((r) => r.error)?.error ?? 'provider_failed';
      // §1.11 THE WALL: errorJson reaches the user's screen — vendor/route names
      // are INTERNAL. Log the real reason here; ship the class-level one.
      console.warn(`[music] all candidates failed — internal reason: ${reason}`);
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
        const bp = srcBlueprint && measured ? structureMatch(blueprintFromMeasured(measured), srcBlueprint) : null;
        return { r, qc, lane, measured, bp };
      })
    );
    scored.sort((a, b) => takeScore(b) - takeScore(a));
    const winner = scored[0]!;
    const result = winner.r;
    const out = result.output!;
    let quality: AudioQuality | null = winner.qc;
    const winnerLane = winner.lane;
    const rankedBy = winner.bp != null
      ? `blueprint-structure (${Math.round(winner.bp * 100)}% skeleton match)`
      : winnerLane && winnerLane.coverage >= MIN_COVERAGE_FOR_RANKING ? 'lane-compliance' : 'mix-quality (ear blind or coverage thin)';
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
    // FILLS ARE DECORATION: any failure here degrades to a fill-less take with a
    // logged reason — it must NEVER fail the song (first prod run of this path
    // happened when the kit-forge stocked fills; Benjamin's failed render).
    try {
      if (process.env.FILL_OVERLAY !== '0' && !placeholder && beatBpm > 0 && durationS > 12) {
        try {
          const fillMat = await prisma.materialAsset.findFirst({
            where: { workspaceId: p.workspaceId, role: 'fill', OR: [{ genre: p.input.genre ?? undefined }, { genre: null }] },
            orderBy: { createdAt: 'desc' },
          });
          const placements = fillMat ? planFills(beatBpm, durationS, null, genreSignature(p.input.genre).fillBars) : [];
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
    } catch (fillErr) {
      console.warn('[fills] overlay skipped (render continues):', (fillErr as Error)?.message);
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
            blueprintMatch: winner.bp ?? null,
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
        .catch((err: unknown) => console.warn('[music] self-training reference write failed:', (err as Error)?.message));
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
          // LOUDNESS LAW v2: the old HEADROOM LAW parked every default master at
          // -16.5/-14 LUFS while commercial Afrobeats ships at -8.5..-11 — THAT
          // gap is the "masters sound weak" complaint, and the old one-pass
          // loudnorm undershot its target 1-3 LU on top of it. Default is now
          // commercial Afro loudness (-9 LUFS / -1.0 dBTP) via the two-pass drive
          // chain for BOTH finished and raw engines ('finished' still routes
          // light-touch conform vs full EQ/glue chain inside master()).
          // 'breathe_-16.5' remains the honest dynamics-first OPT-IN, not the default.
          const preset = 'afro_stream_-9';
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
          // Certify what actually SHIPPED (same rule as the re-master worker):
          // measure the mastered artifact and store the MEASURED loudness — the
          // target is only the fallback, never the claim.
          const masterQc = await measureAudioQuality(wavUrl).catch(() => null);
          const measuredLufs = masterQc?.integratedLufs ?? null;
          if (measuredLufs !== null && measuredLufs < target.lufs - 1.5) {
            console.warn(`[music] auto-master undershot target: measured ${measuredLufs.toFixed(1)} LUFS vs ${target.lufs} (${preset}) — the two-pass trim should not do this, check the chain`);
          }
          await prisma.master.create({
            data: { projectId: p.projectId, songId: p.songId, mixId: mixRow.id, preset, url: wavUrl, loudness: measuredLufs ?? target.lufs, approved: true },
          });
          // A fresh render just became the current audio (re-sing lands here) —
          // clear any instrumental/acapella split from the PREVIOUS take.
          await prisma.song.update({ where: { id: p.songId }, data: { status: 'MASTERED', instrumentalUrl: null, acapellaUrl: null, instrumentalMeta: Prisma.DbNull } });
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
      await assessLaneCompliance({ workspaceId: p.workspaceId, genre: p.input.genre, beatId: beat.id, audioUrl: masteredUrl ?? ingestedMain, songId: p.songId ?? null });
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
