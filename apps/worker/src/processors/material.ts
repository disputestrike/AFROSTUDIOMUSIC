import { createHash } from "node:crypto";
import { openSecret, prisma } from "@afrohit/db";
import { musicAdapter } from "@afrohit/ai";
import { markFailed, markRunning, markSucceeded } from "../lib/jobs";
import {
  deleteObjectByUrl,
  downloadToBuffer,
  uploadBytes,
} from "../lib/storage";
import {
  trimToLoop,
  assembleBeat,
  master,
  masterReferenceDelta,
  measureAudioQuality,
  probeAudioBufferDurationS,
  transformAudio,
  MASTER_TARGETS,
  type AssemblyLayer,
  type AssemblySection,
} from "../lib/ffmpeg";
import { overlayFills } from "../lib/fills";
import {
  genreSignature,
  planFills,
  isKeyedRole,
  isMaterialRole,
  jobOf,
  materialCanAutoAssemble,
  materialCoverage,
  materialGainFor,
  materialKeyScore,
  materialPanFor,
  normalizeMaterialGenre,
} from "@afrohit/shared";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * THE MATERIAL LAYER — forge real loops, then ARRANGE them into exact beats.
 *
 * forge:    generate an ISOLATED loop (solo log drum / solo drums / solo shaker
 *           bed / chord bed) with the instrumental model, QC it, trim it to a
 *           clean N-bar loop, and register it as owned MaterialAsset.
 * assemble: place real material — time-stretch each loop to the target BPM,
 *           layer per section (intro strips down, hook stacks up), concat.
 *           Deterministic: the exact beat, not a hallucination.
 */

// Role → forge prompt: the FULL taxonomy library (Executive-Summary spec).
// Every role — conga, shekere, cowbell, talking drum, highlife guitar, brass,
// flute, chants, risers — forges as its OWN isolated, characterful loop, melodic
// roles IN KEY so separately-forged loops fit together. Curated descriptors +
// family fallbacks live in lib/forge-prompts.ts (one source for forge + tests).
import { forgePromptFor } from "../lib/forge-prompts";
import {
  FORGE_TEMPO_TOLERANCE,
  foldedTempoDelta,
  forgeBarsWithinCap,
  inspectMaterialAudio,
  measureLoopCutPoint,
  normalizeLoopLoudness,
} from "../lib/material-inspection";
import { assessLaneCompliance } from "../lib/lane-assess";

interface ForgePayload {
  jobId: string;
  workspaceId: string;
  genre: string;
  role: string;
  bpm: number;
  keySignature?: string;
  bars?: number;
  /** VARIANT DEPTH: ≥2 = "forge a DIFFERENT take of this role" (prompt gets the
   *  variation direction; the loop lands with meta.variant so the shelf shows it). */
  variant?: number;
}

export async function processForgeMaterial(p: ForgePayload) {
  await markRunning(p.jobId);
  let uploadedUrl: string | null = null;
  try {
    const prompt = forgePromptFor(
      p.role,
      p.genre,
      p.bpm,
      p.keySignature,
      p.variant
    );
    if (!prompt) throw new Error(`unknown material role: ${p.role}`);
    const key = isKeyedRole(p.role) ? p.keySignature : undefined;
    // SLOW-BPM BARS CAP (item 6): the provider caps a render at ~30s but the
    // trim always cut 8 bars — below ~65bpm the render was SHORTER than the
    // trim window, so the row recorded fictional bars/duration. Halve the bars
    // (8→4→2) until bars + 3s trim headroom fit the cap; the row records the
    // ACTUAL bars below.
    const requestedBars = p.bars ?? 8;
    const bars = forgeBarsWithinCap(p.bpm, requestedBars);
    const loopDur = Math.ceil((60 / p.bpm) * 4 * bars) + 3; // headroom for trim
    const ws = await prisma.workspace.findUnique({
      where: { id: p.workspaceId },
      select: { musicProvider: true, musicApiKey: true },
    });
    const adapter = musicAdapter(
      ws?.musicProvider ?? undefined,
      openSecret(ws?.musicApiKey)
    );
    // Forging must start from a connected real engine; unavailable routes never
    // become registered material assets.
    if (adapter.name === "unavailable") {
      throw new Error(
        "forge blocked: no music engine is connected; set a workspace engine before forging owned material."
      );
    }

    // Generate with 429-aware retries — Replicate throttles prediction creation
    // (observed live: 6/min, burst 1), so a throttled forge WAITS and retries
    // instead of dying.
    let result: Awaited<ReturnType<typeof adapter.generate>> | null = null;
    for (let tryNo = 0; tryNo < 4; tryNo++) {
      if (tryNo > 0) await new Promise(r => setTimeout(r, 20_000 * tryNo));
      let r = await adapter.generate({
        genre: p.genre,
        bpm: p.bpm,
        durationS: Math.min(loopDur, 30),
        withStems: false,
        vibePrompt: prompt,
      });
      let attempts = 0;
      while (r.status === "queued" || r.status === "running") {
        if (!adapter.poll || !r.externalId) break;
        await new Promise(res => setTimeout(res, r.pollAfterMs ?? 8000));
        if (++attempts > 25) break;
        r = await adapter.poll(r.externalId);
      }
      if (r.status === "succeeded" && r.output) {
        result = r;
        break;
      }
      const err = String(r.error ?? "");
      if (!/429|throttl|rate limit|capacity/i.test(err))
        throw new Error(`forge render failed: ${err || "provider_failed"}`);
    }
    if (!result?.output)
      throw new Error(
        "forge render failed: rate-limited after retries — try again in a minute"
      );

    // Trim to an exact loop + QC it. A forged loop that fails QC is discarded —
    // only good material enters the library.
    const raw =
      result.output.audioBytes ??
      (result.output.mainAudioUrl
        ? await downloadToBuffer(result.output.mainAudioUrl)
        : (() => {
            throw new Error("forge provider returned no playable audio");
          })());
    // DOWNBEAT-TRUE CUT (item 2): measure where bar one actually lands in the
    // RAW render and cut THERE, instead of the blind legacy 0.5s that made
    // whatever transient sat at half a second become "beat one" (separately
    // forged loops then landed with different phase and never locked). This is
    // a second DSP pass per forge — seconds of CPU on a ≤30s render, against a
    // minutes-long provider render. Fails honest: no stable grid / DSP down →
    // the legacy default, and the receipt below SAYS so.
    const cutPoint = await measureLoopCutPoint(raw);
    // WINDOW GUARD: the cut start (measured downbeat OR the legacy 0.5s) plus
    // the full bar count must fit inside the render, or ffmpeg silently
    // returns FEWER bars than the row claims — the exact fiction this wave
    // exists to kill. Probe the real render length (integer seconds → keep a
    // 1s guard band) and clamp the start back rather than losing bars; the
    // receipt discloses the clamp.
    const rawDurS = await probeAudioBufferDurationS(raw).catch(() => 0);
    const barsDurS = (60 / p.bpm) * 4 * bars;
    const requestedStartS = cutPoint.startS ?? 0.5;
    const maxStartS =
      rawDurS > 0 ? Math.max(0, rawDurS - 1 - barsDurS) : requestedStartS;
    const trimStartS = Math.min(requestedStartS, maxStartS);
    const trimmed = await trimToLoop(raw, p.bpm, bars, { startS: trimStartS });
    // PER-LOOP LOUDNESS (item 3): providers render at coin-flip levels, which
    // made the fixed role-gain doctrine (drums 1.0, chords 0.7…) meaningless.
    // Normalize the trimmed loop to the shelf level (~-18 LUFS) so every brick
    // enters the assembly bus at a KNOWN loudness. Guards inside: unmeasurable
    // or near-silent loops ship unmodified so the QC rejection stays honest.
    const loudness = await normalizeLoopLoudness(trimmed);
    const loop = loudness.bytes;
    const url = await uploadBytes({
      workspaceId: p.workspaceId,
      kind: "material",
      bytes: loop,
      contentType: "audio/wav",
      ext: "wav",
    });
    uploadedUrl = url;
    const inspection = await inspectMaterialAudio({
      bytes: loop,
      url,
      role: p.role,
      roleEvidence: "provider-prompted",
      deep: true,
    });
    // Cut + loudness receipts — measured facts over prompts, always disclosed.
    const trimReceipt = {
      trimStartS,
      source: cutPoint.startS != null ? "measured-downbeat" : "legacy-default",
      method: cutPoint.method,
      ...(trimStartS !== requestedStartS
        ? { clamped: true, requestedStartS }
        : {}),
      ...(cutPoint.confidence != null ? { confidence: cutPoint.confidence } : {}),
    } as const;
    const loudnessReceipt = {
      preLufs: loudness.preLufs,
      postLufs: inspection.qc?.integratedLufs ?? null,
      targetLufs: -18,
      applied: loudness.applied,
      ...(loudness.reason ? { skipped: loudness.reason } : {}),
    };
    // The measured facts about this loop become the RECORD — genre stored in
    // canonical form (item 8a) so 'Afrobeats'/'afro-beats'/'afrobeats' are one
    // shelf, never three invisible ones.
    const genre = normalizeMaterialGenre(p.genre) || p.genre;

    // REJECTED-ROW FILING (house rule: never delete, demote): a forge whose
    // measurements CONTRADICT its own claim files a rejected row — a receipt
    // the shelf can show ("this render lied about its tempo/key/role") and a
    // contentHash tombstone so identical bytes can't re-enter under a new
    // label. The row owns the uploaded object; the job still fails honestly.
    const fileRejectedForge = async (
      reason: string,
      extra: Record<string, unknown>
    ) => {
      const dupe = await prisma.materialAsset.findFirst({
        where: {
          workspaceId: p.workspaceId,
          contentHash: inspection.contentHash,
        },
        select: { id: true },
      });
      if (dupe) {
        // the same audio already has a row (its receipt stands) — drop the copy
        await deleteObjectByUrl(url).catch(() => {});
        uploadedUrl = null;
        return;
      }
      await prisma.materialAsset.create({
        data: {
          workspaceId: p.workspaceId,
          kind: "loop",
          role: p.role,
          genre,
          bpm: p.bpm,
          keySignature: key ?? null,
          bars,
          durationS: inspection.qc?.durationS ?? null,
          url,
          source: "forged",
          readiness: "rejected",
          qualityState: "failed",
          roleEvidence: inspection.roleEvidence,
          rightsBasis: "provider-generated",
          contentHash: inspection.contentHash,
          verifiedAt: inspection.verifiedAt,
          meta: {
            reason,
            qc: inspection.qc,
            measured: inspection.measured,
            trim: trimReceipt,
            loudness: loudnessReceipt,
            prompt,
            engine: adapter.name,
            origin: "forged",
            rightsBasis: "provider-generated",
            ...(p.variant ? { variant: p.variant } : {}),
            ...extra,
          } as never,
        },
      });
      uploadedUrl = null; // the rejected row owns the object now
    };

    // ISOLATED-LOOP gate (not song thresholds): a solo dry chord bed or shaker
    // loop is SUPPOSED to be quiet-ish and steady — 'too_quiet'/'flat' would
    // wrongly discard good material. Only reject true junk: near-silence,
    // clipping, no meaningful duration — or measured ROLE BLEED (item 4): a
    // "shaker" hiding a kick+bass mix is refused WITH a filed receipt.
    if (inspection.readiness !== "ready") {
      if (inspection.reasons.includes("role-bleed")) {
        await fileRejectedForge("role-bleed", { purity: inspection.purity });
        throw new Error(
          `forged ${p.role} loop failed role purity (${inspection.purity?.reason ?? "foreign family measured inside the loop"})`
        );
      }
      throw new Error(
        `forged ${p.role} loop did not pass technical QC (${inspection.reasons.join(", ") || "unmeasured"})`
      );
    }
    if (
      !materialCanAutoAssemble({
        role: p.role,
        source: "forged",
        roleEvidence: inspection.roleEvidence,
      })
    ) {
      throw new Error(
        `forged ${p.role} loop did not confirm the requested musical role (${inspection.roleEvidence})`
      );
    }

    // MEASURED TEMPO IS THE RECORD (item 1): the row used to store the PROMPTED
    // bpm while the detector's number went to meta — the assembler then
    // time-stretched by a fiction. Detectors are octave-ambiguous, so the
    // comparison folds (×0.5/×1/×2) first; a >4% miss after folding means the
    // provider rendered a different groove than requested → rejected, never
    // relabeled.
    let rowBpm = p.bpm;
    let tempoVerification: Record<string, unknown> = {
      promptedBpm: p.bpm,
      detectedBpm: null,
      state: "undetected", // unknown is honorable — the prompt stays as declared intent
    };
    if (inspection.detectedBpm != null) {
      const { foldedBpm, delta } = foldedTempoDelta(
        p.bpm,
        inspection.detectedBpm
      );
      tempoVerification = {
        promptedBpm: p.bpm,
        detectedBpm: inspection.detectedBpm,
        foldedBpm: +foldedBpm.toFixed(1),
        deltaRatio: +delta.toFixed(4),
        state: delta > FORGE_TEMPO_TOLERANCE ? "contradicted" : "confirmed",
      };
      if (delta > FORGE_TEMPO_TOLERANCE) {
        await fileRejectedForge("tempo-mismatch", { tempoVerification });
        throw new Error(
          `forged ${p.role} loop measured ${inspection.detectedBpm}bpm (best octave ${foldedBpm.toFixed(1)}) vs requested ${p.bpm} — rejected, not relabeled`
        );
      }
      rowBpm = Math.round(foldedBpm);
    }

    // MEASURED KEY IS THE RECORD (item 1): a keyed role whose detected key HARD
    // contradicts the prompt (materialKeyScore 3 — enharmonic + relative-key
    // aware, same compatibility law the selector uses) is rejected; a detected
    // compatible key replaces the prompt on the row.
    let rowKey: string | null = key ?? null;
    let keyVerification: Record<string, unknown> | undefined;
    if (isKeyedRole(p.role) && inspection.detectedKey) {
      const compatibility = key
        ? materialKeyScore(p.role, inspection.detectedKey, key)
        : 0;
      keyVerification = {
        promptedKey: key ?? null,
        detectedKey: inspection.detectedKey,
        compatibility,
        state: compatibility === 3 ? "contradicted" : "confirmed",
      };
      if (compatibility === 3) {
        await fileRejectedForge("key-mismatch", { keyVerification });
        throw new Error(
          `forged ${p.role} loop measured in ${inspection.detectedKey} vs requested ${key} — rejected, not relabeled`
        );
      }
      rowKey = inspection.detectedKey;
    }
    const duplicate = await prisma.materialAsset.findFirst({
      where: {
        workspaceId: p.workspaceId,
        contentHash: inspection.contentHash,
      },
      select: { id: true, role: true, url: true, readiness: true },
    });
    if (duplicate) {
      await deleteObjectByUrl(url).catch(() => {});
      uploadedUrl = null;
      if (duplicate.role !== p.role || duplicate.readiness === "rejected") {
        throw new Error(
          `forged audio duplicates material ${duplicate.id} filed as ${duplicate.role}; refusing a second label`
        );
      }
      await markSucceeded(
        p.jobId,
        {
          materialId: duplicate.id,
          role: p.role,
          url: duplicate.url,
          qc: inspection.qualityState,
          deduped: true,
        },
        result.estimatedCostUsd
      );
      return;
    }

    const material = await prisma.materialAsset.create({
      data: {
        workspaceId: p.workspaceId,
        kind: "loop",
        role: p.role,
        genre,
        // Measured facts are the record: verified (octave-folded) tempo, the
        // detected key, the ACTUAL bars after the slow-bpm cap, and the QC'd
        // duration of the bytes that ship — never the prompt's fiction.
        bpm: rowBpm,
        keySignature: rowKey,
        bars,
        durationS: inspection.qc?.durationS ?? (60 / rowBpm) * 4 * bars,
        url,
        source: "forged",
        readiness: inspection.readiness,
        qualityState: inspection.qualityState,
        roleEvidence: inspection.roleEvidence,
        rightsBasis: "provider-generated",
        contentHash: inspection.contentHash,
        verifiedAt: inspection.verifiedAt,
        meta: {
          qc: inspection.qc,
          measured: inspection.measured,
          trim: trimReceipt,
          loudness: loudnessReceipt,
          tempoVerification,
          ...(keyVerification ? { keyVerification } : {}),
          ...(inspection.purity ? { purity: inspection.purity } : {}),
          ...(bars !== requestedBars ? { requestedBars } : {}),
          prompt,
          engine: adapter.name,
          origin: "forged",
          rightsBasis: "provider-generated",
          ...(p.variant ? { variant: p.variant } : {}),
        } as never,
      },
    });
    uploadedUrl = null;
    await markSucceeded(
      p.jobId,
      {
        materialId: material.id,
        role: p.role,
        url,
        qc: inspection.qualityState,
        roleEvidence: inspection.roleEvidence,
      },
      result.estimatedCostUsd
    );
  } catch (err) {
    if (uploadedUrl) await deleteObjectByUrl(uploadedUrl).catch(() => {});
    await markFailed(p.jobId, err);
  }
}

interface AssemblePayload {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId?: string;
  bpm: number;
  genre: string;
  /** materials picked API-side: [{id, url, sourceBpm, role, gain, pan}] */
  picks: Array<{
    id: string;
    url: string;
    sourceBpm: number;
    role: string;
    gain: number;
    pan?: number;
  }>;
  /** Claude-authored arrangement (API-side, validated); absent → classic template. */
  sections?: Array<{ name: string; bars: number; roles: string[] }> | null;
}

type AssemblyPick = AssemblePayload["picks"][number] & {
  rightsBasis?: string;
  roleEvidence?: string;
};

interface MaterialAssetRow {
  id: string;
  workspaceId: string;
  role: string;
  url: string;
  readiness: string;
  qualityState: string;
  roleEvidence: string;
  rightsBasis: string;
  contentHash: string | null;
  verifiedAt: Date | null;
  bpm: number | null;
  keySignature: string | null;
  durationS: number | null;
  source: string;
  meta: unknown;
}

async function canonicalAssemblyPicks(
  p: AssemblePayload
): Promise<AssemblyPick[]> {
  const ids = [...new Set(p.picks.map(pick => pick.id))];
  if (ids.length !== p.picks.length)
    throw new Error("duplicate material id in assembly request");
  const rows: MaterialAssetRow[] = await prisma.materialAsset.findMany({
    where: { workspaceId: p.workspaceId, id: { in: ids } },
  });
  if (rows.length !== ids.length)
    throw new Error("assembly material missing or outside workspace");
  const byId = new Map(rows.map(row => [row.id, row]));
  const output: AssemblyPick[] = [];

  for (const requested of p.picks) {
    let asset = byId.get(requested.id)!;
    if (asset.role !== requested.role)
      throw new Error(
        `material ${asset.id} role mismatch (${asset.role} != ${requested.role})`
      );
    if (
      asset.readiness === "rejected" ||
      asset.qualityState === "failed" ||
      asset.qualityState === "duplicate"
    ) {
      throw new Error(
        `material ${asset.id} is rejected (${asset.qualityState})`
      );
    }

    const meta = (asset.meta ?? {}) as Record<string, unknown> & {
      synth?: boolean;
    };
    const declaredEvidence =
      asset.roleEvidence !== "unknown"
        ? asset.roleEvidence
        : meta.synth
          ? "synth-code"
          : asset.source === "artist_stem" || asset.source === "provider_stem"
            ? "stem-separated"
            : "provider-prompted";
    const needsInspection =
      asset.readiness !== "ready" ||
      !asset.contentHash ||
      !asset.verifiedAt ||
      asset.bpm == null ||
      (isKeyedRole(asset.role) && asset.keySignature == null) ||
      !materialCanAutoAssemble({
        role: asset.role,
        source: asset.source,
        roleEvidence: declaredEvidence,
      });
    if (needsInspection) {
      const bytes = await downloadToBuffer(asset.url);
      const inspection = await inspectMaterialAudio({
        bytes,
        url: asset.url,
        role: asset.role,
        roleEvidence: declaredEvidence,
        deep:
          asset.bpm == null ||
          (isKeyedRole(asset.role) && asset.keySignature == null) ||
          declaredEvidence.startsWith("provider-prompted"),
      });
      if (inspection.readiness !== "ready") {
        await prisma.materialAsset.update({
          where: { id: asset.id },
          data: {
            readiness: inspection.readiness,
            qualityState: inspection.qualityState,
            roleEvidence: inspection.roleEvidence,
            verifiedAt: inspection.verifiedAt,
            meta: {
              ...meta,
              materialInspection: {
                reasons: inspection.reasons,
                qc: inspection.qc,
              },
            } as never,
          },
        });
        throw new Error(
          `material ${asset.id} failed verification (${inspection.reasons.join(", ") || "unmeasured"})`
        );
      }
      const duplicate = await prisma.materialAsset.findFirst({
        where: {
          workspaceId: p.workspaceId,
          contentHash: inspection.contentHash,
          id: { not: asset.id },
        },
      });
      if (duplicate) {
        await prisma.materialAsset.update({
          where: { id: asset.id },
          data: {
            readiness: "rejected",
            qualityState: "duplicate",
            roleEvidence: inspection.roleEvidence,
            meta: {
              ...meta,
              duplicateOf: duplicate.id,
              materialInspection: { qc: inspection.qc },
            } as never,
          },
        });
        if (duplicate.role !== asset.role || duplicate.readiness !== "ready") {
          throw new Error(
            `material ${asset.id} duplicates ${duplicate.id} with incompatible role/readiness`
          );
        }
        asset = duplicate;
      } else {
        asset = await prisma.materialAsset.update({
          where: { id: asset.id },
          data: {
            readiness: inspection.readiness,
            qualityState: inspection.qualityState,
            roleEvidence: inspection.roleEvidence,
            contentHash: inspection.contentHash,
            verifiedAt: inspection.verifiedAt,
            bpm:
              asset.bpm ??
              (inspection.detectedBpm
                ? Math.round(inspection.detectedBpm)
                : null),
            keySignature: asset.keySignature ?? inspection.detectedKey,
            durationS: asset.durationS ?? inspection.qc?.durationS ?? null,
            meta: {
              ...meta,
              materialInspection: {
                qc: inspection.qc,
                measured: inspection.measured,
                detectedBpm: inspection.detectedBpm,
                detectedKey: inspection.detectedKey,
              },
            } as never,
          },
        });
      }
    }
    if (asset.readiness !== "ready" || asset.qualityState !== "passed") {
      throw new Error(`material ${asset.id} is not technically verified`);
    }
    if (!asset.rightsBasis || asset.rightsBasis === "unknown") {
      throw new Error(`material ${asset.id} has no classified rights basis`);
    }
    if (!materialCanAutoAssemble(asset)) {
      throw new Error(
        `material ${asset.id} has unconfirmed role evidence (${asset.roleEvidence})`
      );
    }
    if (output.some(pick => pick.id === asset.id)) continue;
    output.push({
      id: asset.id,
      url: asset.url,
      sourceBpm: asset.bpm ?? requested.sourceBpm ?? p.bpm,
      role: asset.role,
      gain: materialGainFor(asset.role),
      pan: materialPanFor(asset.role),
      rightsBasis: asset.rightsBasis,
      roleEvidence: asset.roleEvidence,
    });
  }
  return output;
}

export async function processAssembleBeat(p: AssemblePayload) {
  await markRunning(p.jobId);
  const dir = await mkdtemp(join(tmpdir(), "mats-"));
  const attemptedUrls: string[] = [];
  let createdBeatId: string | null = null;
  try {
    if (!p.picks.length)
      throw new Error(
        "no material picked — forge some loops for this genre first"
      );
    const picks = await canonicalAssemblyPicks(p);
    // A 'fill' is a transition, not a bed — keep it OUT of the section layers (it's
    // overlaid at boundaries below), else it would play continuously under the hook.
    const bedPicks = picks.filter(x => x.role !== "fill");
    if (!bedPicks.length)
      throw new Error(
        "no bed material — forge drums/bass/chords for this genre first"
      );
    // UNIFIED GATE (2026-07-19): use the SAME materialCoverage() as the parent
    // own-engine gate so the two can NEVER disagree. This child previously
    // hardcoded `bedPicks.length < 5`, so a shelf that passed the parent was
    // rejected HERE -> "grid assembly failed (see child job)".
    // OWNER DOCTRINE (2026-07-19, live kill: "verified shelf is incomplete"
    // died the paid render): a thin shelf ASSEMBLES a thin-but-real bed — it
    // never dies. The parent already stamped the honest sparse-shelf note; the
    // only hard stop is zero bed material (guarded above).
    const cov = materialCoverage(picks);
    if (!cov.ready) {
      console.warn(
        `[assemble] sparse bed (beds=${cov.beds}, rhythm=${cov.rhythm}, low-end=${cov.lowEnd}, tonal=${cov.tonal}) — assembling from ${bedPicks.length} loop(s)`
      );
    }
    // Pull every picked loop local.
    const layers: AssemblyLayer[] = [];
    const roleIdx = new Map<string, number>();
    for (let i = 0; i < bedPicks.length; i++) {
      const pick = bedPicks[i]!;
      const buf = await downloadToBuffer(pick.url);
      const path = join(dir, `mat${i}.wav`);
      await writeFile(path, buf);
      layers.push({
        path,
        sourceBpm: pick.sourceBpm || p.bpm,
        gain: pick.gain,
        pan: pick.pan ?? 0,
        role: pick.role,
      });
      roleIdx.set(pick.role, i);
    }
    const idx = (roles: string[]) =>
      roles.map(r => roleIdx.get(r)).filter((i): i is number => i != null);
    const all = layers.map((_, i) => i);
    // FAMILY BUCKETS so the classic template arranges the RICH kit (conga/
    // shekere/talking_drum/highlife_guitar…), not just the 5 legacy names.
    // Producer arc: intro = texture (perc + harmony), verse = groove foundation,
    // hook = EVERYTHING, outro = strip back.
    const bucket = (job: string) =>
      bedPicks
        .map((x, i) => ({
          i,
          j: isMaterialRole(x.role)
            ? jobOf(x.role)
            : ((
                {
                  drums: "rhythm",
                  percussion: "rhythm",
                  talking_drum: "rhythm",
                  log_drum: "low_end",
                  bass: "low_end",
                  chords: "harmony",
                } as Record<string, string>
              )[x.role] ?? "melody"),
        }))
        .filter(x => x.j === job)
        .map(x => x.i);
    const rhythm = bucket("rhythm");
    const lowEnd = bucket("low_end");
    const harmony = bucket("harmony");
    const dedupe = (a: number[]) => [...new Set(a)];
    // The arrangement: Claude's plan when the API authored one (creative,
    // per-material), otherwise the family-aware producer template — strip in,
    // stack the hook, breathe, strip out.
    const planned: AssemblySection[] = (p.sections ?? [])
      .map(s => ({ name: s.name, bars: s.bars, layerIdx: idx(s.roles) }))
      .filter(s => s.layerIdx.length > 0 && s.bars >= 2);
    // OWNER LAW: when a bucket comes up empty the fallback is ALWAYS the full
    // stack (`all`) — a thin one-loop section is never acceptable.
    const sections: AssemblySection[] =
      planned.length >= 3
        ? planned
        : [
            {
              name: "intro",
              bars: 4,
              layerIdx: dedupe([...rhythm.slice(0, 2), ...harmony.slice(0, 1)])
                .length
                ? dedupe([...rhythm.slice(0, 2), ...harmony.slice(0, 1)])
                : all,
            },
            {
              name: "verse",
              bars: 8,
              layerIdx: dedupe([...rhythm, ...lowEnd]).length
                ? dedupe([...rhythm, ...lowEnd])
                : all,
            },
            { name: "hook", bars: 8, layerIdx: all },
            {
              name: "verse2",
              bars: 8,
              layerIdx: dedupe([...rhythm, ...lowEnd, ...harmony]).length
                ? dedupe([...rhythm, ...lowEnd, ...harmony])
                : all,
            },
            { name: "hook2", bars: 8, layerIdx: all },
            {
              name: "outro",
              bars: 4,
              layerIdx: dedupe([...rhythm.slice(0, 2), ...lowEnd.slice(0, 1)])
                .length
                ? dedupe([...rhythm.slice(0, 2), ...lowEnd.slice(0, 1)])
                : all,
            },
          ];
    // TACTICAL CORRECTION (owner law: a clipped take gets FIXED, not abandoned):
    // render → QC; if the ONLY failure is clipping, trim every layer's gain and
    // re-render — deterministic ffmpeg, no brain, no credit. Two attempts
    // (unity, then -4.4 dB); anything still broken after that fails honestly.
    let url = "";
    let qc: Awaited<ReturnType<typeof measureAudioQuality>> | null = null;
    let tacticalTrim: number | null = null;
    let fillApplied = false;
    for (const scale of [1, 0.6]) {
      let attemptFillApplied = false;
      const scaledLayers =
        scale === 1
          ? layers
          : layers.map(l => ({ ...l, gain: +(l.gain * scale).toFixed(2) }));
      const beatWav = await assembleBeat({
        layers: scaledLayers,
        sections,
        targetBpm: p.bpm,
      });

      // PHASE 5 — lay fills at the arrangement's KNOWN section boundaries (bar counts
      // give exact seconds). Gated FILL_OVERLAY=1; best-effort, clean assembly kept on
      // any failure. A 'fill' loop is excluded from the section LAYERS (it's a
      // transition, not a bed) and used only here.
      let beatBytes = beatWav;
      if (process.env.FILL_OVERLAY !== "0") {
        try {
          const fillMat = picks.find(x => x.role === "fill");
          if (fillMat) {
            const secPerBar = (60 / p.bpm) * 4;
            const boundaries: number[] = [];
            let cum = 0;
            for (const s of sections) {
              cum += s.bars;
              boundaries.push(cum * secPerBar);
            }
            boundaries.pop(); // no fill after the final section
            const placements = planFills(
              p.bpm,
              cum * secPerBar,
              boundaries,
              genreSignature(p.genre).fillBars
            );
            if (placements.length) {
              const rawFill = await downloadToBuffer(fillMat.url);
              const tempoRatio = p.bpm / (fillMat.sourceBpm || p.bpm);
              const fillBuf =
                Math.abs(tempoRatio - 1) > 0.001
                  ? await transformAudio(rawFill, { tempo: tempoRatio })
                  : rawFill;
              // bpm rides along so the fill is trimmed to exactly ONE bar
              // inside the filtergraph (fills.ts ONE-BAR LAW) — an 8-bar fill
              // no longer plays 7 bars past every boundary.
              beatBytes = await overlayFills(
                beatWav,
                fillBuf,
                placements.map(f => f.atS),
                { bpm: p.bpm }
              );
              attemptFillApplied = true;
              console.log(
                `[assemble] overlaid ${placements.length} fills at section boundaries`
              );
            }
          }
        } catch (err) {
          console.warn(
            "[assemble] fill overlay failed (clean assembly kept):",
            (err as Error)?.message
          );
        }
      }
      url = await uploadBytes({
        workspaceId: p.workspaceId,
        kind: "beats",
        bytes: beatBytes,
        contentType: "audio/wav",
        ext: "wav",
      });
      attemptedUrls.push(url);
      fillApplied = attemptFillApplied;
      qc = await measureAudioQuality(url).catch(() => null);
      const clippingOnly =
        qc?.verdict === "fail" && (qc.flags ?? []).includes("clipping");
      if (!clippingOnly) break;
      if (scale !== 1) break; // trimmed retry still clips → fall through to the honest fail
      tacticalTrim = 0.6;
      console.warn(
        "[assemble] take clipped — tactical correction: retrying with layer gains ×0.6"
      );
    }
    // WO-1 SAFETY RAIL: assembled output passes the SAME QC gate as provider
    // output — a broken render (near-silence/clipping) is rejected with the real
    // reason, never approved. 'weak' ships flagged; unmeasured ships disclosed.
    if (!qc) {
      throw new Error(
        "assembled take could not be technically measured — nothing shipped"
      );
    }
    if (qc.verdict !== "pass") {
      throw new Error(
        `assembled take failed QC (${(qc.flags ?? []).join(", ") || "broken audio"}) — nothing shipped`
      );
    }
    for (const staleUrl of attemptedUrls.filter(
      candidate => candidate !== url
    )) {
      await deleteObjectByUrl(staleUrl).catch(() => {});
    }
    attemptedUrls.length = 0;
    attemptedUrls.push(url);

    // MASTER THE ASSEMBLED BEAT (item 7 — the single biggest audible gap): the
    // bus sum deliberately keeps headroom "for the master downstream", but no
    // master ever ran — raw sums shipped quiet and unglued. Run the SAME
    // two-pass chain the song path uses, with the project's genre curve
    // (amapiano low-mid control / afrobeats percussion presence), and ship the
    // MASTERED wav as the BeatAsset. The raw sum stays uploaded as meta.audit
    // evidence — measured lineage, never deleted on success.
    const rawSumUrl = url;
    const rawSumQc = qc;
    const rawSumBytes = await downloadToBuffer(url);
    const masterPreset = "afro_stream_-9";
    const masterGenre = normalizeMaterialGenre(p.genre) || p.genre;
    const { wav: masteredWav } = await master({
      mix: rawSumBytes,
      preset: masterPreset,
      genre: masterGenre,
    });
    const masteredUrl = await uploadBytes({
      workspaceId: p.workspaceId,
      kind: "beats",
      bytes: masteredWav,
      contentType: "audio/wav",
      ext: "wav",
    });
    attemptedUrls.push(masteredUrl);
    // Certify what actually SHIPS: the mastered artifact passes the same QC
    // gate; a master that breaks a passing sum fails the job honestly.
    const masterQc = await measureAudioQuality(masteredUrl).catch(() => null);
    if (!masterQc || masterQc.verdict !== "pass") {
      throw new Error(
        `assembled master failed QC (${(masterQc?.flags ?? []).join(", ") || "unmeasured"}) — nothing shipped`
      );
    }
    const masterTarget = MASTER_TARGETS[masterPreset]!;
    if (
      masterQc.integratedLufs != null &&
      masterQc.integratedLufs < masterTarget.lufs - 1.5
    ) {
      console.warn(
        `[assemble] master undershot target: measured ${masterQc.integratedLufs.toFixed(1)} LUFS vs ${masterTarget.lufs} (${masterPreset})`
      );
    }
    const masterReport = {
      preset: masterPreset,
      genre: masterGenre,
      target: masterTarget,
      measured: masterQc,
      // measured delta vs the genre's rights-cleared reference numbers — a
      // report line, honorably null until the operator commits the manifest
      referenceDelta: masterReferenceDelta(masterGenre, masterQc),
    };
    url = masteredUrl;
    qc = masterQc;
    const assembledContentHash = createHash("sha256")
      .update(masteredWav)
      .digest("hex");

    const usedPicks = picks.filter(pick => pick.role !== "fill" || fillApplied);
    const assemblyLog = usedPicks.map(pick => ({
      materialId: pick.id,
      role: pick.role,
      sourceBpm: pick.sourceBpm,
      targetBpm: p.bpm,
      stretchRatio: +(p.bpm / (pick.sourceBpm || p.bpm)).toFixed(4),
      gain: pick.gain,
      pan: pick.pan ?? 0,
      rightsBasis: pick.rightsBasis ?? "unknown",
      roleEvidence: pick.roleEvidence ?? "unknown",
    }));
    const created = await prisma.$transaction(async tx => {
      const created = await tx.beatAsset.create({
        data: {
          projectId: p.projectId,
          songId: p.songId,
          url,
          format: "wav",
          bpm: p.bpm,
          duration: qc.durationS,
          provider: "material",
          assetKind: "instrumental",
          qualityState: "passed",
          contentHash: assembledContentHash,
          verifiedAt: new Date(),
          // Turns green only after the lane-listen receipt below is persisted.
          approved: false,
          meta: {
            assembled: true,
            mastered: true,
            arrangedBy: planned.length >= 3 ? "claude" : "template",
            ...(tacticalTrim ? { tacticalTrim } : {}),
            materialIds: usedPicks.map(pick => pick.id),
            roles: usedPicks.map(pick => pick.role),
            sections: sections.map(
              section => `${section.name}:${section.bars}`
            ),
            assemblyLog,
            // qc = the MASTERED artifact's measured QC (what actually ships);
            // the raw bus sum and its measurement stay as audit evidence.
            qc,
            masterReport,
            audit: { rawSumUrl, rawSumQc },
          } as never,
        },
      });
      await tx.materialUsage.createMany({
        data: usedPicks.map(pick => {
          const layerIndex = bedPicks.findIndex(bed => bed.id === pick.id);
          const usedIn =
            pick.role === "fill"
              ? ["section-boundaries"]
              : sections
                  .filter(section => section.layerIdx.includes(layerIndex))
                  .map(section => section.name);
          return {
            workspaceId: p.workspaceId,
            materialId: pick.id,
            providerJobId: p.jobId,
            beatId: created.id,
            songId: p.songId ?? null,
            role: pick.role,
            sourceBpm: pick.sourceBpm,
            targetBpm: p.bpm,
            stretchRatio: +(p.bpm / (pick.sourceBpm || p.bpm)).toFixed(4),
            gain: pick.gain,
            pan: pick.pan ?? 0,
            sections: usedIn as never,
          };
        }),
        skipDuplicates: true,
      });
      return created;
    });
    createdBeatId = created.id;

    const laneAssessment = await assessLaneCompliance({
      workspaceId: p.workspaceId,
      genre: p.genre,
      beatId: created.id,
      audioUrl: url,
      songId: p.songId,
    });
    const assessed = await prisma.beatAsset.findUnique({
      where: { id: created.id },
      select: { meta: true },
    });
    await prisma.$transaction([
      prisma.beatAsset.update({
        where: { id: created.id },
        data: {
          approved: true,
          meta: {
            ...((assessed?.meta ?? {}) as Record<string, unknown>),
            laneAssessment,
          } as never,
        },
      }),
      prisma.providerJob.update({
        where: { id: p.jobId },
        data: {
          status: "SUCCEEDED",
          finishedAt: new Date(),
          outputJson: {
            beatId: created.id,
            url,
            roles: usedPicks.map(pick => pick.role),
            qc: qc.verdict,
            laneAssessment,
          } as never,
        },
      }),
    ]);
    createdBeatId = null;
    attemptedUrls.length = 0;
  } catch (err) {
    if (createdBeatId)
      await prisma.beatAsset
        .delete({ where: { id: createdBeatId } })
        .catch(() => {});
    for (const attemptedUrl of attemptedUrls)
      await deleteObjectByUrl(attemptedUrl).catch(() => {});
    await markFailed(p.jobId, err);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
