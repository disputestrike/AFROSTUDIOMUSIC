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
import { getGenreKit, synthKitFor } from '@afrohit/shared';
import { deleteObjectByUrl, downloadToBuffer, uploadBytes } from '../lib/storage';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { inspectMaterialAudio } from '../lib/material-inspection';

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
    // ARGS: role bpm out seed genre key four_on_floor
    const p = spawn(PYTHON, [SCRIPT, role, String(bpm), out, String(seed), genre, key, fourOnFloor ? '1' : '0']);
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
        await runSynth(role, bpm, tmp, p.genre, key, fourOnFloor, Number.parseInt(digest.slice(0, 6), 16) % 9973);
        const bytes = await readFile(tmp);
        const url = await uploadBytes({ workspaceId: p.workspaceId, kind: 'materials', bytes, contentType: 'audio/wav', ext: 'wav' });
        uploadedUrl = url;
        const inspection = await inspectMaterialAudio({ bytes, url, role, roleEvidence: 'synth-code', deep: false });
        if (inspection.readiness !== 'ready') {
          throw new Error(`synthesized material failed technical QC (${inspection.reasons.join(', ') || 'unmeasured'})`);
        }
        const duplicate = await prisma.materialAsset.findFirst({
          where: { workspaceId: p.workspaceId, contentHash: inspection.contentHash },
          select: { id: true, role: true },
        });
        if (duplicate) {
          await deleteObjectByUrl(url).catch(() => {});
          uploadedUrl = null;
          if (duplicate.role !== role) throw new Error(`synth output duplicates ${duplicate.id} filed as ${duplicate.role}`);
          completed.push(role);
          continue;
        }
        const durationS = (60 / bpm) * 8;
        await prisma.materialAsset.create({
          data: {
            id: materialId,
            workspaceId: p.workspaceId, kind: 'loop', role, genre: p.genre, bpm, bars: 2,
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
