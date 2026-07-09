/**
 * SYNTH MATERIAL — 100%-owned signature loops from the detector's own math
 * (see py/synth_material.py). Not a sampled producer pack — a bridge: real,
 * grid-locked, rights-clean material so "build the beat from controlled
 * material" works end-to-end today. Disclosed via source:'forged' + meta.synth.
 */
import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@afrohit/db';
import { uploadBytes } from '../lib/storage';

const PYTHON = process.env.PYTHON_BIN || 'python3';
// CJS worker (module: CommonJS) — resolve like lib/dsp.ts does: dist/processors -> ../../py
const SCRIPT = join(__dirname, '..', '..', 'py', 'synth_material.py');

export interface SynthMaterialPayload { workspaceId: string; genre: string; bpm?: number; roles?: string[] }

function runSynth(role: string, bpm: number, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(PYTHON, [SCRIPT, role, String(bpm), out, String(Date.now() % 9973)]);
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`synth ${role} exit ${code}: ${err.slice(0, 200)}`))));
  });
}

export async function processSynthMaterial(p: SynthMaterialPayload): Promise<void> {
  const bpm = p.bpm ?? 112;
  const roles = p.roles?.length ? p.roles : ['log_drum', 'percussion', 'bass'];
  for (const role of roles) {
    const tmp = join(tmpdir(), `synth-${role}-${Date.now()}.wav`);
    try {
      await runSynth(role, bpm, tmp);
      const bytes = await readFile(tmp);
      const url = await uploadBytes({ workspaceId: p.workspaceId, kind: 'materials', bytes, contentType: 'audio/wav', ext: 'wav' });
      const durationS = (60 / bpm) * 8;
      await prisma.materialAsset.create({
        data: {
          workspaceId: p.workspaceId, kind: 'loop', role, genre: p.genre, bpm, bars: 2,
          durationS, url, source: 'forged',
          meta: { synth: true, generator: 'signature-synth-v1', note: 'synthesized owned material — bridge until a licensed producer pack lands' } as never,
        },
      });
      console.log(`[synth-material] ${p.genre}/${role} @${bpm} forged`);
    } catch (err) {
      console.warn(`[synth-material] ${role} failed (non-fatal):`, (err as Error)?.message);
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  }
}
