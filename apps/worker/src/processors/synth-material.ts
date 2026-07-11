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
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@afrohit/db';
import { getGenreKit, type GenreKit, type MaterialRole } from '@afrohit/shared';
import { uploadBytes } from '../lib/storage';

const PYTHON = process.env.PYTHON_BIN || 'python3';
// CJS worker (module: CommonJS) — resolve like lib/dsp.ts does: dist/processors -> ../../py
const SCRIPT = join(__dirname, '..', '..', 'py', 'synth_material.py');

export interface SynthMaterialPayload { workspaceId: string; genre: string; bpm?: number; keySignature?: string; roles?: string[] }

/** Fallback home key per genre family (only used when none is supplied). */
function defaultKey(genre: string, kit?: GenreKit): string {
  if (/gospel|highlife|afro_pop|soukous|juju|country|reggae/.test(genre)) return 'C major';
  if (/house|afro_house|edm/.test(genre)) return 'A minor';
  return 'A minor';
}

/**
 * Which SYNTH PRIMITIVES to forge for a genre — derived from its kit, not
 * hardcoded. The synth renders a small primitive set (drums, percussion, bass,
 * chords, log_drum, fill); we turn the kit's rich role list into that set so the
 * bed matches the lane (e.g. house gets four-on-floor drums, no log_drum;
 * amapiano keeps its log_drum; afrobeats gets syncopated drums + shaker + bass).
 */
function synthRolesFor(genre: string, kit?: GenreKit): string[] {
  const roles = new Set<MaterialRole>([...(kit?.requiredRoles ?? []), ...(kit?.signatureRoles ?? [])]);
  const has = (...rs: MaterialRole[]) => rs.some((r) => roles.has(r));
  const out: string[] = [];
  if (has('kick', 'kick_808', 'soft_kick', 'club_kick', 'live_kick', 'snare', 'rimshot', 'clap')) out.push('drums');
  if (has('shaker', 'shekere', 'cabasa', 'maraca', 'conga', 'bongo', 'closed_hat', 'talking_drum', 'djembe')) out.push('percussion');
  if (roles.has('log_drum')) out.push('log_drum');
  if (has('bass_guitar', 'synth_bass', 'sub_bass', 'bass_808', 'sliding_808', 'moog_bass', 'reese_bass', 'upright_bass', 'organ_bass', 'pluck_bass')) out.push('bass');
  if (has('piano', 'rhodes', 'wurlitzer', 'organ', 'hammond', 'gospel_organ', 'guitar_chords', 'highlife_guitar', 'house_piano_stab', 'synth_pad', 'warm_pad')) out.push('chords');
  out.push('fill');
  // Always keep at least a minimal bed if the kit was missing/thin.
  return out.length > 1 ? [...new Set(out)] : ['drums', 'bass', 'chords', 'percussion', 'fill'];
}

function runSynth(role: string, bpm: number, out: string, genre: string, key: string, fourOnFloor: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    // ARGS: role bpm out seed genre key four_on_floor
    const p = spawn(PYTHON, [SCRIPT, role, String(bpm), out, String(Date.now() % 9973), genre, key, fourOnFloor ? '1' : '0']);
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`synth ${role} exit ${code}: ${err.slice(0, 200)}`))));
  });
}

export async function processSynthMaterial(p: SynthMaterialPayload): Promise<void> {
  const kit = getGenreKit(p.genre);
  const bpm = p.bpm ?? kit?.typicalBpm ?? 112;
  const key = p.keySignature || defaultKey(p.genre, kit);
  const fourOnFloor = !!kit?.fourOnFloor;
  const roles = p.roles?.length ? p.roles : synthRolesFor(p.genre, kit);
  for (const role of roles) {
    const tmp = join(tmpdir(), `synth-${role}-${Date.now()}.wav`);
    try {
      await runSynth(role, bpm, tmp, p.genre, key, fourOnFloor);
      const bytes = await readFile(tmp);
      const url = await uploadBytes({ workspaceId: p.workspaceId, kind: 'materials', bytes, contentType: 'audio/wav', ext: 'wav' });
      const durationS = (60 / bpm) * 8;
      await prisma.materialAsset.create({
        data: {
          workspaceId: p.workspaceId, kind: 'loop', role, genre: p.genre, bpm, bars: 2,
          durationS, url, source: 'forged',
          meta: { synth: true, generator: 'signature-synth-v2', key, fourOnFloor, note: 'synthesized owned material — genre + key aware' } as never,
        },
      });
      console.log(`[synth-material] ${p.genre}/${role} @${bpm} key=${key} forged`);
    } catch (err) {
      console.warn(`[synth-material] ${role} failed (non-fatal):`, (err as Error)?.message);
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  }
}
