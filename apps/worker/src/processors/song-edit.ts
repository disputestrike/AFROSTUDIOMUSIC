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
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type SongEditOp =
  | { kind: 'add_layer'; prompt: string }
  | { kind: 'add_fill'; timesS: number[] }
  | { kind: 'cut'; fromS: number; toS: number };

export interface SongEditPayload {
  jobId: string; workspaceId: string; projectId: string; songId: string;
  sourceUrl: string; genre?: string | null; durationS?: number; op: SongEditOp;
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

export async function processSongEdit(p: SongEditPayload): Promise<void> {
  await markRunning(p.jobId);
  try {
    const src = await downloadToBuffer(p.sourceUrl);
    let out: Buffer;
    let label: string;

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
