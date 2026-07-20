/**
 * SYNTH MATERIAL — 100%-owned signature loops from the detector's own math
 * (see py/synth_material.py). Not a sampled producer pack — a bridge: real,
 * grid-locked, rights-clean material so "build the beat from controlled
 * material" works end-to-end today. Disclosed via source:'forged' + meta.synth.
 *
 * GENRE-AWARE (audit fix): the bridge used to pass only (role, bpm) and hardcode
 * roles = [log_drum, percussion, bass], so EVERY genre got the same
 * amapiano-flavoured, always-A-minor bed. Now it derives the synth roles from the
 * genre's kit and passes genre + key + four-on-floor to the synth so each lane
 * renders its own pocket (afrobeats ≠ amapiano ≠ house).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@afrohit/db';
import { getGenreKit, laneSwingRatio, normalizeMaterialGenre, synthKitFor } from '@afrohit/shared';
import { deleteObjectByUrl, downloadToBuffer, uploadBytes } from '../lib/storage';
import { trimToLoop } from '../lib/ffmpeg';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { inspectMaterialAudio, normalizeLoopLoudness } from '../lib/material-inspection';

const PYTHON = process.env.PYTHON_BIN || 'python3';
// CJS worker (module: CommonJS) — resolve like lib/dsp.ts does: dist/processors -> ../../py
const SCRIPT = join(__dirname, '..', '..', 'py', 'synth_material.py');

export interface SynthMaterialPayload { jobId?: string; workspaceId: string; genre: string; bpm?: number; keySignature?: string; roles?: string[] }

/** Fallback home key per genre family (only used when none is supplied). */
function defaultKey(genre: string): string {
  if (/gospel|highlife|afro_pop|soukous|juju|country|reggae/.test(genre)) return 'C major';
  if (/house|afro_house|edm/.test(genre)) return 'A minor';
  return 'A minor';
}

function runSynth(role: string, bpm: number, out: string, genre: string, key: string, fourOnFloor: boolean, seed: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // ARGS: role bpm out seed genre key four_on_floor swing
    // SWING (SOUNDWAVE2): the lane's expert-prior swing ratio rides into the
    // synth so EVERY 16th-grid voice shares ONE pocket (the authoritative
    // value; the py fallback table only covers direct invocations).
    const p = spawn(PYTHON, [SCRIPT, role, String(bpm), out, String(seed), genre, key, fourOnFloor ? '1' : '0', laneSwingRatio(genre).toFixed(3)]);
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`synth ${role} exit ${code}: ${err.slice(0, 200)}`))));
  });
}

export async function processSynthMaterial(p: SynthMaterialPayload): Promise<void> {
  if (p.jobId) await markRunning(p.jobId);
  try {
    const kit = getGenreKit(p.genre);
    const bpm = p.bpm ?? kit?.typicalBpm ?? 112;
    const key = p.keySignature || defaultKey(p.genre);
    const fourOnFloor = !!kit?.fourOnFloor;
    const roles = p.roles?.length ? p.roles : synthKitFor(p.genre);
    const completed: string[] = [];
    const failed: string[] = [];
    for (const role of roles) {
      const digest = createHash('sha256').update(`${p.workspaceId}|${p.jobId ?? p.genre}|${role}`).digest('hex');
      const materialId = `synth_${digest.slice(0, 24)}`;
      const existing = await prisma.materialAsset.findUnique({
        where: { id: materialId },
        select: { id: true, url: true, readiness: true, roleEvidence: true, meta: true },
      });
      if (existing) {
        const bytes = await downloadToBuffer(existing.url);
        const inspection = await inspectMaterialAudio({
          bytes, url: existing.url, role, roleEvidence: 'synth-code', deep: false,
        });
        const duplicate = await prisma.materialAsset.findFirst({
          where: { workspaceId: p.workspaceId, contentHash: inspection.contentHash, id: { not: existing.id } },
          select: { id: true, role: true, readiness: true },
        });
        if (duplicate) {
          await prisma.materialAsset.update({
            where: { id: existing.id },
            data: {
              readiness: 'rejected',
              qualityState: 'duplicate',
              roleEvidence: 'synth-code',
              rightsBasis: 'code-generated',
              contentHash: null,
              verifiedAt: inspection.verifiedAt,
              meta: { ...((existing.meta ?? {}) as Record<string, unknown>), duplicateOf: duplicate.id } as never,
            },
          });
          if (duplicate.role === role && duplicate.readiness === 'ready') completed.push(role);
          else failed.push(role);
          continue;
        }
        await prisma.materialAsset.update({
          where: { id: existing.id },
          data: {
            readiness: inspection.readiness,
            qualityState: inspection.qualityState,
            roleEvidence: 'synth-code',
            rightsBasis: 'code-generated',
            contentHash: inspection.contentHash,
            verifiedAt: inspection.verifiedAt,
            keySignature: key,
          },
        });
        if (inspection.readiness === 'ready') completed.push(role);
        else failed.push(role);
        continue;
      }
      const tmp = join(tmpdir(), `synth-${role}-${digest.slice(0, 10)}.wav`);
      let uploadedUrl: string | null = null;
      try {
        // CROSS-ROLE DEDUP RETRY (owner incident 2026-07-19: the py generator
        // collapsed synth_pad onto kalimba's exact waveform, the dedup gate
        // refused to file it, and the requested role never existed). A cross-
        // role hash collision now retries ONCE with a perturbed seed — two
        // different seeds virtually never collapse to identical bytes unless
        // the generator ignores the seed entirely, in which case the role fails
        // honestly (and the own-engine renders without it, never dying).
        const baseSeed = Number.parseInt(digest.slice(0, 6), 16) % 9973;
        let url = '';
        let inspection: Awaited<ReturnType<typeof inspectMaterialAudio>> | null = null;
        let loudness: Awaited<ReturnType<typeof normalizeLoopLoudness>> | null = null;
        let sameRoleDup = false;
        let crossRoleDup: { id: string; role: string } | null = null;
        for (const seed of [baseSeed, (baseSeed + 4099) % 9973]) {
          await runSynth(role, bpm, tmp, p.genre, key, fourOnFloor, seed);
          const rendered = await readFile(tmp);
          // BELT-AND-BRACES EXACT BARS (source-truth item 5): the py synth now
          // slices its 0.25s scratch tail itself; trimToLoop with startS 0 (a
          // synth loop starts ON the grid by construction — never the 0.5s
          // provider default) re-asserts the exact 2-bar length and adds the
          // declick edge fades so the loop seam never pops.
          const trimmed = await trimToLoop(rendered, bpm, 2, { startS: 0 });
          // Same shelf-level law as the forge (item 3): every material loop
          // lands at ~-18 LUFS so the role-gain doctrine acts on KNOWN levels
          // (the synth's 0.89-peak normalize says nothing about loudness).
          loudness = await normalizeLoopLoudness(trimmed);
          const bytes = loudness.bytes;
          url = await uploadBytes({ workspaceId: p.workspaceId, kind: 'materials', bytes, contentType: 'audio/wav', ext: 'wav' });
          uploadedUrl = url;
          inspection = await inspectMaterialAudio({ bytes, url, role, roleEvidence: 'synth-code', deep: false });
          if (inspection.readiness !== 'ready') {
            throw new Error(`synthesized material failed technical QC (${inspection.reasons.join(', ') || 'unmeasured'})`);
          }
          const duplicate = await prisma.materialAsset.findFirst({
            where: { workspaceId: p.workspaceId, contentHash: inspection.contentHash },
            select: { id: true, role: true },
          });
          if (!duplicate) { sameRoleDup = false; crossRoleDup = null; break; }
          await deleteObjectByUrl(url).catch(() => {});
          uploadedUrl = null;
          if (duplicate.role === role) { sameRoleDup = true; break; }
          crossRoleDup = { id: duplicate.id, role: duplicate.role }; // perturbed seed retries
        }
        if (sameRoleDup) {
          completed.push(role);
          continue;
        }
        if (crossRoleDup || !inspection || !loudness) {
          throw new Error(`synth output duplicates ${crossRoleDup?.id} filed as ${crossRoleDup?.role} (even after seed retry)`);
        }
        // ACTUAL duration on the record: the QC'd length of the bytes that
        // ship (exactly 2 bars after the tail fix + trim), with the pure math
        // only as the fallback when ffprobe could not measure.
        const durationS = inspection.qc?.durationS ?? (60 / bpm) * 8;
        await prisma.materialAsset.create({
          data: {
            id: materialId,
            workspaceId: p.workspaceId, kind: 'loop', role,
            // canonical genre at write time (item 8a) — one shelf per lane,
            // never 'Afrobeats'/'afro-beats'/'afrobeats' as three ghosts
            genre: normalizeMaterialGenre(p.genre) || p.genre,
            bpm, bars: 2,
            keySignature: key,
            durationS, url, source: 'forged',
            readiness: inspection.readiness,
            qualityState: inspection.qualityState,
            roleEvidence: 'synth-code',
            rightsBasis: 'code-generated',
            contentHash: inspection.contentHash,
            verifiedAt: inspection.verifiedAt,
            meta: {
              synth: true,
              generator: 'signature-synth-v2',
              key,
              fourOnFloor,
              jobId: p.jobId,
              qc: inspection.qc,
              // cut + loudness receipts (source-truth wave): grid-exact by
              // construction, shelf-leveled to ~-18 LUFS like every loop
              trim: { trimStartS: 0, source: 'synth-grid' },
              loudness: {
                preLufs: loudness.preLufs,
                postLufs: inspection.qc?.integratedLufs ?? null,
                targetLufs: -18,
                applied: loudness.applied,
                ...(loudness.reason ? { skipped: loudness.reason } : {}),
              },
              rightsBasis: 'code-generated',
              note: 'synthesized material from studio code; genre and key aware',
            } as never,
          },
        });
        uploadedUrl = null;
        completed.push(role);
        console.log(`[synth-material] ${p.genre}/${role} @${bpm} key=${key} forged`);
      } catch (err) {
        if (uploadedUrl) await deleteObjectByUrl(uploadedUrl).catch(() => {});
        failed.push(role);
        console.warn(`[synth-material] ${role} failed:`, (err as Error)?.message);
      } finally {
        await unlink(tmp).catch(() => undefined);
      }
    }
    if (!completed.length) throw new Error(`all synthesized material roles failed: ${failed.join(', ')}`);
    if (p.jobId) await markSucceeded(p.jobId, { completed, failed, bpm, key });
  } catch (error) {
    if (p.jobId) await markFailed(p.jobId, error);
    throw error;
  }
}
