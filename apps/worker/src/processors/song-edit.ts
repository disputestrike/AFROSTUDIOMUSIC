/**
 * SONG-EDIT — the hands of "talk to your song". The chat route parses natural
 * language ("at 1:20 add a fill", "lay warm keys over the whole thing", "cut
 * 0:45–1:00") into ONE typed op; this job executes it on the CURRENT take and
 * appends the result as a new Master version — so it auto-plays, A/Bs against
 * the previous take, and reverts in one tap. Ops that existing routes already
 * serve (transform / remaster / regenerate) never reach here; the api injects
 * those directly.
 */
import { prisma } from '@afrohit/db';
import { downloadToBuffer, uploadBytes } from '../lib/storage';
import { mixBuffers, runFfmpeg } from '../lib/ffmpeg';
import { markRunning, markSucceeded, markFailed } from '../lib/jobs';
import { melodyLayer } from './own-engine';
import { separateStems } from '@afrohit/ai';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type SongEditOp =
  | { kind: 'add_layer'; prompt: string }
  | { kind: 'add_fill'; timesS: number[] }
  | { kind: 'cut'; fromS: number; toS: number }
  | { kind: 'move_section'; fromIndex: number; toIndex: number }
  | { kind: 'duplicate_section'; index: number }
  | { kind: 'stem_fx'; stem: 'vocals' | 'drums' | 'bass' | 'other'; fx: 'reverb' | 'eq_low' | 'eq_high' | 'gain'; amount?: number }
  | { kind: 'vocal_drop'; fromS: number; toS: number };

export interface SongEditPayload {
  jobId: string; workspaceId: string; projectId: string; songId: string;
  sourceUrl: string; genre?: string | null; durationS?: number; boundaries?: number[]; op: SongEditOp;
}

/** Trim out [fromS, toS) and butt-join the remainder (concat demuxer, WAV). */
async function cutRegion(input: Buffer, fromS: number, toS: number): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'cut-'));
  try {
    const inPath = join(dir, 'in.wav');
    await writeFile(inPath, input);
    const a = join(dir, 'a.wav'); const b = join(dir, 'b.wav'); const out = join(dir, 'out.wav');
    await runFfmpeg(['-i', inPath, '-t', String(Math.max(0.1, fromS)), '-ac', '2', '-ar', '44100', a]);
    await runFfmpeg(['-i', inPath, '-ss', String(toS), '-ac', '2', '-ar', '44100', b]);
    const list = join(dir, 'list.txt');
    await writeFile(list, `file '${a}'\nfile '${b}'\n`);
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
    return await readFile(out);
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/** Overlay one hit (the genre's fill) at each timestamp via adelay + amix. */
async function overlayAtTimes(bed: Buffer, hit: Buffer, timesS: number[], gain = 0.9): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'fillat-'));
  try {
    const bedP = join(dir, 'bed.wav'); const hitP = join(dir, 'hit.wav'); const out = join(dir, 'out.wav');
    await writeFile(bedP, bed); await writeFile(hitP, hit);
    const times = timesS.slice(0, 12); // sanity cap
    const inputs: string[] = ['-i', bedP];
    for (let i = 0; i < times.length; i++) inputs.push('-i', hitP);
    const parts = times.map((t, i) => `[${i + 1}:a]adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)},volume=${gain}[f${i}]`);
    const mixIns = ['[0:a]', ...times.map((_t, i) => `[f${i}]`)].join('');
    const fc = `${parts.join(';')}${parts.length ? ';' : ''}${mixIns}amix=inputs=${times.length + 1}:duration=first:dropout_transition=0[a]`;
    await runFfmpeg([...inputs, '-filter_complex', fc, '-map', '[a]', '-ac', '2', '-ar', '44100', out]);
    return await readFile(out);
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}


/** Section plan from measured boundaries: contiguous [s,e) segments, 1-based for humans. */
function segmentsFrom(durationS: number, boundaries?: number[]): Array<{ s: number; e: number }> {
  const edges = [...new Set([0, ...(boundaries ?? []).filter((t) => t > 2 && t < durationS - 2), durationS])].sort((a, b) => a - b);
  const segs: Array<{ s: number; e: number }> = [];
  for (let i = 0; i < edges.length - 1; i++) if (edges[i + 1]! - edges[i]! >= 3) segs.push({ s: edges[i]!, e: edges[i + 1]! });
  return segs;
}

/** Render an ordered list of [s,e) slices of the input into one WAV. */
async function concatSlices(input: Buffer, order: Array<{ s: number; e: number }>): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'arr-'));
  try {
    const inPath = join(dir, 'in.wav');
    await writeFile(inPath, input);
    const files: string[] = [];
    for (let i = 0; i < order.length; i++) {
      const f = join(dir, `p${i}.wav`);
      await runFfmpeg(['-i', inPath, '-ss', String(order[i]!.s), '-t', String(Math.max(0.2, order[i]!.e - order[i]!.s)), '-ac', '2', '-ar', '44100', f]);
      files.push(f);
    }
    const list = join(dir, 'list.txt');
    await writeFile(list, files.map((f) => `file '${f}'`).join('\n') + '\n');
    const out = join(dir, 'out.wav');
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
    return await readFile(out);
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

const FX_CHAIN: Record<string, (amt: number) => string> = {
  reverb: (a) => `aecho=0.8:0.88:${Math.round(40 + a * 50)}|${Math.round(70 + a * 80)}:${(0.25 + a * 0.3).toFixed(2)}|${(0.18 + a * 0.25).toFixed(2)}`,
  eq_low: (a) => `bass=g=${(a * 8 - 2).toFixed(1)}`,
  eq_high: (a) => `treble=g=${(a * 8 - 2).toFixed(1)}`,
  gain: (a) => `volume=${(0.4 + a * 1.2).toFixed(2)}`,
};

/** Demucs the record, apply an fx chain to ONE stem (or gate a region on vocals), remix all four. */
async function stemSurgery(sourceUrl: string, target: 'vocals' | 'drums' | 'bass' | 'other', chain: string): Promise<Buffer> {
  const stems = await separateStems({ audioUrl: sourceUrl, mode: 'full' });
  const urls = stems as unknown as Record<string, string | undefined>;
  const need: Array<'vocals' | 'drums' | 'bass' | 'other'> = ['vocals', 'drums', 'bass', 'other'];
  const dir = await mkdtemp(join(tmpdir(), 'stemfx-'));
  try {
    const paths: string[] = [];
    for (const nm of need) {
      const u = urls[nm];
      if (!u) throw new Error(`stem '${nm}' unavailable from separator`);
      const pth = join(dir, `${nm}.wav`);
      await writeFile(pth, await downloadToBuffer(u));
      if (nm === target) {
        const fxOut = join(dir, `${nm}.fx.wav`);
        await runFfmpeg(['-i', pth, '-af', chain, '-ac', '2', '-ar', '44100', fxOut]);
        paths.push(fxOut);
      } else paths.push(pth);
    }
    const out = join(dir, 'out.wav');
    await runFfmpeg([
      '-i', paths[0]!, '-i', paths[1]!, '-i', paths[2]!, '-i', paths[3]!,
      '-filter_complex', '[0:a][1:a][2:a][3:a]amix=inputs=4:duration=longest:dropout_transition=0,volume=1.9[a]',
      '-map', '[a]', '-ac', '2', '-ar', '44100', out,
    ]);
    return await readFile(out);
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

export async function processSongEdit(p: SongEditPayload): Promise<void> {
  await markRunning(p.jobId);
  try {
    const src = await downloadToBuffer(p.sourceUrl);
    let out: Buffer;
    let label = '';

    if (p.op.kind === 'cut') {
      const { fromS, toS } = p.op;
      if (!(toS > fromS) || fromS < 0) throw new Error('cut needs 0 <= from < to');
      out = await cutRegion(src, fromS, toS);
      label = `cut ${fromS.toFixed(1)}–${toS.toFixed(1)}s`;
    } else if (p.op.kind === 'add_fill') {
      const fill = await prisma.materialAsset.findFirst({ where: { workspaceId: p.workspaceId, genre: p.genre ?? undefined, role: 'fill' }, orderBy: { createdAt: 'desc' } });
      if (!fill) throw new Error('no fill on the shelf yet — the nightly kit forge stocks it, or run materials/synth');
      const hit = await downloadToBuffer(fill.url);
      out = await overlayAtTimes(src, hit, p.op.timesS);
      label = `fills @ ${p.op.timesS.map((t) => t.toFixed(0) + 's').join(', ')}`;
    } else if (p.op.kind === 'move_section' || p.op.kind === 'duplicate_section') {
      const segs = segmentsFrom(p.durationS ?? 180, p.boundaries);
      if (segs.length < 2) throw new Error('no measured section map on this take yet — regenerate once and the ear will chart it');
      const order = [...segs];
      if (p.op.kind === 'move_section') {
        const from = p.op.fromIndex - 1, to = p.op.toIndex - 1;
        if (from < 0 || from >= order.length || to < 0 || to >= order.length) throw new Error(`sections are S1–S${order.length}`);
        const [seg] = order.splice(from, 1);
        order.splice(to, 0, seg!);
        label = `moved S${p.op.fromIndex} → position ${p.op.toIndex}`;
      } else {
        const i = p.op.index - 1;
        if (i < 0 || i >= order.length) throw new Error(`sections are S1–S${order.length}`);
        order.splice(i + 1, 0, order[i]!);
        label = `duplicated S${p.op.index}`;
      }
      out = await concatSlices(src, order);
    } else if (p.op.kind === 'stem_fx') {
      const amt = Math.max(0, Math.min(1, p.op.amount ?? 0.5));
      out = await stemSurgery(p.sourceUrl, p.op.stem, FX_CHAIN[p.op.fx]!(amt));
      label = `${p.op.fx} on ${p.op.stem} (${Math.round(amt * 100)}%)`;
    } else if (p.op.kind === 'vocal_drop') {
      const { fromS, toS } = p.op;
      if (!(toS > fromS)) throw new Error('vocal_drop needs from < to');
      out = await stemSurgery(p.sourceUrl, 'vocals', `volume=enable='between(t,${fromS},${toS})':volume=0`);
      label = `vocal open ${fromS.toFixed(0)}–${toS.toFixed(0)}s`;
    } else {
      // add_layer — MusicGen conditioned on THIS song, mixed under it (fail-closed:
      // if the layer can't render, the edit fails honestly rather than faking it).
      const dur = Math.min(30, Math.max(8, Math.round(p.durationS ?? 30)));
      const mel = await melodyLayer(p.sourceUrl, p.op.prompt, dur);
      if (!mel.url) throw new Error(mel.note);
      const layer = await downloadToBuffer(mel.url);
      out = await mixBuffers(src, layer, 0.8);
      label = `layer: ${p.op.prompt.slice(0, 40)}`;
    }

    const url = await uploadBytes({ workspaceId: p.workspaceId, kind: 'masters', bytes: out, contentType: 'audio/wav', ext: 'wav' });
    await prisma.master.create({ data: { projectId: p.projectId, songId: p.songId, preset: `chat ${label}`.slice(0, 60), url, approved: true } });
    await markSucceeded(p.jobId, { url, label, note: 'New version is live — it auto-plays and reverts in one tap.' });
    console.log(`[song-edit] ${p.songId}: ${label}`);
  } catch (err) {
    await markFailed(p.jobId, `song_edit_failed: ${(err as Error)?.message ?? 'unknown'}`);
    console.warn('[song-edit] failed:', (err as Error)?.message);
  }
}
