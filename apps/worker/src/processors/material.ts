import { createHash } from 'node:crypto';
import { openSecret, prisma } from '@afrohit/db';
import { musicAdapter } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { deleteObjectByUrl, downloadToBuffer, uploadBytes } from '../lib/storage';
import { trimToLoop, assembleBeat, measureAudioQuality, transformAudio, type AssemblyLayer, type AssemblySection } from '../lib/ffmpeg';
import { overlayFills } from '../lib/fills';
import { genreSignature, planFills, isKeyedRole, isMaterialRole, jobOf, materialGainFor, materialPanFor } from '@afrohit/shared';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
import { forgePromptFor } from '../lib/forge-prompts';
import { inspectMaterialAudio } from '../lib/material-inspection';

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
    const prompt = forgePromptFor(p.role, p.genre, p.bpm, p.keySignature, p.variant);
    if (!prompt) throw new Error(`unknown material role: ${p.role}`);
    const key = isKeyedRole(p.role) ? p.keySignature : undefined;
    const bars = p.bars ?? 8;
    const loopDur = Math.ceil((60 / p.bpm) * 4 * bars) + 3; // headroom for trim
    const ws = await prisma.workspace.findUnique({ where: { id: p.workspaceId }, select: { musicProvider: true, musicApiKey: true } });
    const adapter = musicAdapter(ws?.musicProvider ?? undefined, openSecret(ws?.musicApiKey));
    // Forging must start from a connected real engine; unavailable routes never
    // become registered material assets.
    if (adapter.name === 'unavailable') {
      throw new Error('forge blocked: no music engine is connected; set a workspace engine before forging owned material.');
    }

    // Generate with 429-aware retries — Replicate throttles prediction creation
    // (observed live: 6/min, burst 1), so a throttled forge WAITS and retries
    // instead of dying.
    let result: Awaited<ReturnType<typeof adapter.generate>> | null = null;
    for (let tryNo = 0; tryNo < 4; tryNo++) {
      if (tryNo > 0) await new Promise((r) => setTimeout(r, 20_000 * tryNo));
      let r = await adapter.generate({
        genre: p.genre,
        bpm: p.bpm,
        durationS: Math.min(loopDur, 30),
        withStems: false,
        vibePrompt: prompt,
      });
      let attempts = 0;
      while (r.status === 'queued' || r.status === 'running') {
        if (!adapter.poll || !r.externalId) break;
        await new Promise((res) => setTimeout(res, r.pollAfterMs ?? 8000));
        if (++attempts > 25) break;
        r = await adapter.poll(r.externalId);
      }
      if (r.status === 'succeeded' && r.output) { result = r; break; }
      const err = String(r.error ?? '');
      if (!/429|throttl|rate limit|capacity/i.test(err)) throw new Error(`forge render failed: ${err || 'provider_failed'}`);
    }
    if (!result?.output) throw new Error('forge render failed: rate-limited after retries — try again in a minute');

    // Trim to an exact loop + QC it. A forged loop that fails QC is discarded —
    // only good material enters the library.
    const raw = result.output.audioBytes
      ?? (result.output.mainAudioUrl
        ? await downloadToBuffer(result.output.mainAudioUrl)
        : (() => { throw new Error('forge provider returned no playable audio'); })());
    const loop = await trimToLoop(raw, p.bpm, bars);
    const url = await uploadBytes({ workspaceId: p.workspaceId, kind: 'material', bytes: loop, contentType: 'audio/wav', ext: 'wav' });
    uploadedUrl = url;
    const inspection = await inspectMaterialAudio({
      bytes: loop,
      url,
      role: p.role,
      roleEvidence: 'provider-prompted',
      deep: true,
    });
    // ISOLATED-LOOP gate (not song thresholds): a solo dry chord bed or shaker
    // loop is SUPPOSED to be quiet-ish and steady — 'too_quiet'/'flat' would
    // wrongly discard good material. Only reject true junk: near-silence,
    // clipping, or no meaningful duration.
    if (inspection.readiness !== 'ready') {
      throw new Error(`forged ${p.role} loop did not pass technical QC (${inspection.reasons.join(', ') || 'unmeasured'})`);
    }
    const duplicate = await prisma.materialAsset.findFirst({
      where: { workspaceId: p.workspaceId, contentHash: inspection.contentHash },
      select: { id: true, role: true, url: true, readiness: true },
    });
    if (duplicate) {
      await deleteObjectByUrl(url).catch(() => {});
      uploadedUrl = null;
      if (duplicate.role !== p.role || duplicate.readiness === 'rejected') {
        throw new Error(`forged audio duplicates material ${duplicate.id} filed as ${duplicate.role}; refusing a second label`);
      }
      await markSucceeded(p.jobId, {
        materialId: duplicate.id, role: p.role, url: duplicate.url,
        qc: inspection.qualityState, deduped: true,
      }, result.estimatedCostUsd);
      return;
    }

    const material = await prisma.materialAsset.create({
      data: {
        workspaceId: p.workspaceId,
        kind: 'loop',
        role: p.role,
        genre: p.genre,
        bpm: p.bpm,
        keySignature: key ?? null,
        bars,
        durationS: (60 / p.bpm) * 4 * bars,
        url,
        source: 'forged',
        readiness: inspection.readiness,
        qualityState: inspection.qualityState,
        roleEvidence: inspection.roleEvidence,
        rightsBasis: 'provider-generated',
        contentHash: inspection.contentHash,
        verifiedAt: inspection.verifiedAt,
        meta: {
          qc: inspection.qc,
          measured: inspection.measured,
          prompt,
          engine: adapter.name,
          origin: 'forged',
          rightsBasis: 'provider-generated',
          ...(p.variant ? { variant: p.variant } : {}),
        } as never,
      },
    });
    uploadedUrl = null;
    await markSucceeded(p.jobId, {
      materialId: material.id, role: p.role, url,
      qc: inspection.qualityState, roleEvidence: inspection.roleEvidence,
    }, result.estimatedCostUsd);
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
  picks: Array<{ id: string; url: string; sourceBpm: number; role: string; gain: number; pan?: number }>;
  /** Claude-authored arrangement (API-side, validated); absent → classic template. */
  sections?: Array<{ name: string; bars: number; roles: string[] }> | null;
}

type AssemblyPick = AssemblePayload['picks'][number];

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

async function canonicalAssemblyPicks(p: AssemblePayload): Promise<AssemblyPick[]> {
  const ids = [...new Set(p.picks.map((pick) => pick.id))];
  if (ids.length !== p.picks.length) throw new Error('duplicate material id in assembly request');
  const rows: MaterialAssetRow[] = await prisma.materialAsset.findMany({
    where: { workspaceId: p.workspaceId, id: { in: ids } },
  });
  if (rows.length !== ids.length) throw new Error('assembly material missing or outside workspace');
  const byId = new Map(rows.map((row) => [row.id, row]));
  const output: AssemblyPick[] = [];

  for (const requested of p.picks) {
    let asset = byId.get(requested.id)!;
    if (asset.role !== requested.role) throw new Error(`material ${asset.id} role mismatch (${asset.role} != ${requested.role})`);
    if (asset.readiness === 'rejected' || asset.qualityState === 'failed' || asset.qualityState === 'duplicate') {
      throw new Error(`material ${asset.id} is rejected (${asset.qualityState})`);
    }

    const meta = (asset.meta ?? {}) as Record<string, unknown> & { synth?: boolean };
    const declaredEvidence = asset.roleEvidence !== 'unknown'
      ? asset.roleEvidence
      : meta.synth
        ? 'synth-code'
        : asset.source === 'artist_stem' || asset.source === 'provider_stem'
          ? 'stem-separated'
          : 'provider-prompted';
    const needsInspection =
      asset.readiness !== 'ready' || !asset.contentHash || !asset.verifiedAt ||
      asset.bpm == null || (isKeyedRole(asset.role) && asset.keySignature == null);
    if (needsInspection) {
      const bytes = await downloadToBuffer(asset.url);
      const inspection = await inspectMaterialAudio({
        bytes,
        url: asset.url,
        role: asset.role,
        roleEvidence: declaredEvidence,
        deep: asset.bpm == null || (isKeyedRole(asset.role) && asset.keySignature == null) || declaredEvidence.startsWith('provider-prompted'),
      });
      if (inspection.readiness !== 'ready') {
        await prisma.materialAsset.update({
          where: { id: asset.id },
          data: {
            readiness: inspection.readiness,
            qualityState: inspection.qualityState,
            roleEvidence: inspection.roleEvidence,
            verifiedAt: inspection.verifiedAt,
            meta: { ...meta, materialInspection: { reasons: inspection.reasons, qc: inspection.qc } } as never,
          },
        });
        throw new Error(`material ${asset.id} failed verification (${inspection.reasons.join(', ') || 'unmeasured'})`);
      }
      const duplicate = await prisma.materialAsset.findFirst({
        where: { workspaceId: p.workspaceId, contentHash: inspection.contentHash, id: { not: asset.id } },
      });
      if (duplicate) {
        await prisma.materialAsset.update({
          where: { id: asset.id },
          data: {
            readiness: 'rejected',
            qualityState: 'duplicate',
            roleEvidence: inspection.roleEvidence,
            meta: { ...meta, duplicateOf: duplicate.id, materialInspection: { qc: inspection.qc } } as never,
          },
        });
        if (duplicate.role !== asset.role || duplicate.readiness !== 'ready') {
          throw new Error(`material ${asset.id} duplicates ${duplicate.id} with incompatible role/readiness`);
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
            bpm: asset.bpm ?? (inspection.detectedBpm ? Math.round(inspection.detectedBpm) : null),
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
    if (asset.readiness !== 'ready' || asset.qualityState !== 'passed') {
      throw new Error(`material ${asset.id} is not technically verified`);
    }
    if (!asset.rightsBasis || asset.rightsBasis === 'unknown') {
      throw new Error(`material ${asset.id} has no classified rights basis`);
    }
    if (output.some((pick) => pick.id === asset.id)) continue;
    output.push({
      id: asset.id,
      url: asset.url,
      sourceBpm: asset.bpm ?? requested.sourceBpm ?? p.bpm,
      role: asset.role,
      gain: materialGainFor(asset.role),
      pan: materialPanFor(asset.role),
    });
  }
  return output;
}

export async function processAssembleBeat(p: AssemblePayload) {
  await markRunning(p.jobId);
  const dir = await mkdtemp(join(tmpdir(), 'mats-'));
  const attemptedUrls: string[] = [];
  try {
    if (!p.picks.length) throw new Error('no material picked — forge some loops for this genre first');
    const picks = await canonicalAssemblyPicks(p);
    // A 'fill' is a transition, not a bed — keep it OUT of the section layers (it's
    // overlaid at boundaries below), else it would play continuously under the hook.
    const bedPicks = picks.filter((x) => x.role !== 'fill');
    if (!bedPicks.length) throw new Error('no bed material — forge drums/bass/chords for this genre first');
    const bedJobs = bedPicks.map((pick) => isMaterialRole(pick.role)
      ? jobOf(pick.role)
      : ({ drums: 'rhythm', percussion: 'rhythm', bass: 'low_end', log_drum: 'low_end', chords: 'harmony' } as Record<string, string>)[pick.role]);
    const rhythmCount = bedJobs.filter((job) => job === 'rhythm').length;
    const lowEndCount = bedJobs.filter((job) => job === 'low_end').length;
    const tonalCount = bedJobs.filter((job) => job === 'harmony' || job === 'melody').length;
    if (bedPicks.length < 5 || rhythmCount < 2 || lowEndCount < 1 || tonalCount < 1) {
      throw new Error(`material bed incomplete (beds=${bedPicks.length}, rhythm=${rhythmCount}, low-end=${lowEndCount}, tonal=${tonalCount})`);
    }
    // Pull every picked loop local.
    const layers: AssemblyLayer[] = [];
    const roleIdx = new Map<string, number>();
    for (let i = 0; i < bedPicks.length; i++) {
      const pick = bedPicks[i]!;
      const buf = await downloadToBuffer(pick.url);
      const path = join(dir, `mat${i}.wav`);
      await writeFile(path, buf);
      layers.push({ path, sourceBpm: pick.sourceBpm || p.bpm, gain: pick.gain, pan: pick.pan ?? 0, role: pick.role });
      roleIdx.set(pick.role, i);
    }
    const idx = (roles: string[]) => roles.map((r) => roleIdx.get(r)).filter((i): i is number => i != null);
    const all = layers.map((_, i) => i);
    // FAMILY BUCKETS so the classic template arranges the RICH kit (conga/
    // shekere/talking_drum/highlife_guitar…), not just the 5 legacy names.
    // Producer arc: intro = texture (perc + harmony), verse = groove foundation,
    // hook = EVERYTHING, outro = strip back.
    const bucket = (job: string) =>
      bedPicks
        .map((x, i) => ({ i, j: isMaterialRole(x.role) ? jobOf(x.role) : ({ drums: 'rhythm', percussion: 'rhythm', talking_drum: 'rhythm', log_drum: 'low_end', bass: 'low_end', chords: 'harmony' } as Record<string, string>)[x.role] ?? 'melody' }))
        .filter((x) => x.j === job)
        .map((x) => x.i);
    const rhythm = bucket('rhythm');
    const lowEnd = bucket('low_end');
    const harmony = bucket('harmony');
    const dedupe = (a: number[]) => [...new Set(a)];
    // The arrangement: Claude's plan when the API authored one (creative,
    // per-material), otherwise the family-aware producer template — strip in,
    // stack the hook, breathe, strip out.
    const planned: AssemblySection[] = (p.sections ?? [])
      .map((s) => ({ name: s.name, bars: s.bars, layerIdx: idx(s.roles) }))
      .filter((s) => s.layerIdx.length > 0 && s.bars >= 2);
    // OWNER LAW: when a bucket comes up empty the fallback is ALWAYS the full
    // stack (`all`) — a thin one-loop section is never acceptable.
    const sections: AssemblySection[] = planned.length >= 3 ? planned : [
      { name: 'intro', bars: 4, layerIdx: dedupe([...rhythm.slice(0, 2), ...harmony.slice(0, 1)]).length ? dedupe([...rhythm.slice(0, 2), ...harmony.slice(0, 1)]) : all },
      { name: 'verse', bars: 8, layerIdx: dedupe([...rhythm, ...lowEnd]).length ? dedupe([...rhythm, ...lowEnd]) : all },
      { name: 'hook', bars: 8, layerIdx: all },
      { name: 'verse2', bars: 8, layerIdx: dedupe([...rhythm, ...lowEnd, ...harmony]).length ? dedupe([...rhythm, ...lowEnd, ...harmony]) : all },
      { name: 'hook2', bars: 8, layerIdx: all },
      { name: 'outro', bars: 4, layerIdx: dedupe([...rhythm.slice(0, 2), ...lowEnd.slice(0, 1)]).length ? dedupe([...rhythm.slice(0, 2), ...lowEnd.slice(0, 1)]) : all },
    ];
    // TACTICAL CORRECTION (owner law: a clipped take gets FIXED, not abandoned):
    // render → QC; if the ONLY failure is clipping, trim every layer's gain and
    // re-render — deterministic ffmpeg, no brain, no credit. Two attempts
    // (unity, then -4.4 dB); anything still broken after that fails honestly.
    let url = '';
    let qc: Awaited<ReturnType<typeof measureAudioQuality>> | null = null;
    let tacticalTrim: number | null = null;
    let fillApplied = false;
    for (const scale of [1, 0.6]) {
      let attemptFillApplied = false;
      const scaledLayers = scale === 1 ? layers : layers.map((l) => ({ ...l, gain: +(l.gain * scale).toFixed(2) }));
      const beatWav = await assembleBeat({ layers: scaledLayers, sections, targetBpm: p.bpm });

      // PHASE 5 — lay fills at the arrangement's KNOWN section boundaries (bar counts
      // give exact seconds). Gated FILL_OVERLAY=1; best-effort, clean assembly kept on
      // any failure. A 'fill' loop is excluded from the section LAYERS (it's a
      // transition, not a bed) and used only here.
      let beatBytes = beatWav;
      if (process.env.FILL_OVERLAY !== '0') {
        try {
          const fillMat = picks.find((x) => x.role === 'fill');
          if (fillMat) {
            const secPerBar = (60 / p.bpm) * 4;
            const boundaries: number[] = [];
            let cum = 0;
            for (const s of sections) { cum += s.bars; boundaries.push(cum * secPerBar); }
            boundaries.pop(); // no fill after the final section
            const placements = planFills(p.bpm, cum * secPerBar, boundaries, genreSignature(p.genre).fillBars);
            if (placements.length) {
              const rawFill = await downloadToBuffer(fillMat.url);
              const tempoRatio = p.bpm / (fillMat.sourceBpm || p.bpm);
              const fillBuf = Math.abs(tempoRatio - 1) > 0.001
                ? await transformAudio(rawFill, { tempo: tempoRatio })
                : rawFill;
              beatBytes = await overlayFills(beatWav, fillBuf, placements.map((f) => f.atS));
              attemptFillApplied = true;
              console.log(`[assemble] overlaid ${placements.length} fills at section boundaries`);
            }
          }
        } catch (err) {
          console.warn('[assemble] fill overlay failed (clean assembly kept):', (err as Error)?.message);
        }
      }
      url = await uploadBytes({ workspaceId: p.workspaceId, kind: 'beats', bytes: beatBytes, contentType: 'audio/wav', ext: 'wav' });
      attemptedUrls.push(url);
      fillApplied = attemptFillApplied;
      qc = await measureAudioQuality(url).catch(() => null);
      const clippingOnly = qc?.verdict === 'fail' && (qc.flags ?? []).includes('clipping');
      if (!clippingOnly) break;
      if (scale !== 1) break; // trimmed retry still clips → fall through to the honest fail
      tacticalTrim = 0.6;
      console.warn('[assemble] take clipped — tactical correction: retrying with layer gains ×0.6');
    }
    // WO-1 SAFETY RAIL: assembled output passes the SAME QC gate as provider
    // output — a broken render (near-silence/clipping) is rejected with the real
    // reason, never approved. 'weak' ships flagged; unmeasured ships disclosed.
    if (!qc) {
      throw new Error('assembled take could not be technically measured — nothing shipped');
    }
    if (qc.verdict !== 'pass') {
      throw new Error(`assembled take failed QC (${(qc.flags ?? []).join(', ') || 'broken audio'}) — nothing shipped`);
    }
    for (const staleUrl of attemptedUrls.filter((candidate) => candidate !== url)) {
      await deleteObjectByUrl(staleUrl).catch(() => {});
    }
    const assembledContentHash = createHash('sha256')
      .update(await downloadToBuffer(url))
      .digest('hex');

    const usedPicks = picks.filter((pick) => pick.role !== 'fill' || fillApplied);
    const assemblyLog = usedPicks.map((pick) => ({
      materialId: pick.id,
      role: pick.role,
      sourceBpm: pick.sourceBpm,
      targetBpm: p.bpm,
      stretchRatio: +(p.bpm / (pick.sourceBpm || p.bpm)).toFixed(4),
      gain: pick.gain,
      pan: pick.pan ?? 0,
    }));
    await prisma.$transaction(async (tx) => {
      const created = await tx.beatAsset.create({
        data: {
          projectId: p.projectId,
          songId: p.songId,
          url,
          format: 'wav',
          bpm: p.bpm,
          duration: qc.durationS,
          provider: 'material',
          assetKind: 'instrumental',
          qualityState: 'passed',
          contentHash: assembledContentHash,
          verifiedAt: new Date(),
          approved: true,
          meta: {
            assembled: true,
            arrangedBy: planned.length >= 3 ? 'claude' : 'template',
            ...(tacticalTrim ? { tacticalTrim } : {}),
            materialIds: usedPicks.map((pick) => pick.id),
            roles: usedPicks.map((pick) => pick.role),
            sections: sections.map((section) => `${section.name}:${section.bars}`),
            assemblyLog,
            qc,
          } as never,
        },
      });
      await tx.materialUsage.createMany({
        data: usedPicks.map((pick) => {
          const layerIndex = bedPicks.findIndex((bed) => bed.id === pick.id);
          const usedIn = pick.role === 'fill'
            ? ['section-boundaries']
            : sections.filter((section) => section.layerIdx.includes(layerIndex)).map((section) => section.name);
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
      await tx.providerJob.update({
        where: { id: p.jobId },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          outputJson: { beatId: created.id, url, roles: usedPicks.map((pick) => pick.role), qc: qc.verdict } as never,
        },
      });
      return created;
    });
    attemptedUrls.length = 0;
  } catch (err) {
    for (const attemptedUrl of attemptedUrls) await deleteObjectByUrl(attemptedUrl).catch(() => {});
    await markFailed(p.jobId, err);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
