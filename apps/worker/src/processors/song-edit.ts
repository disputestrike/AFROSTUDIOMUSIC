/**
 * SONG-EDIT — the hands of "talk to your song". The chat route parses natural
 * language ("at 1:20 add a fill", "lay warm keys over the whole thing", "cut
 * 0:45–1:00") into ONE typed op; this job executes it on the CURRENT take and
 * appends the result as a new Master version — so it auto-plays, A/Bs against
 * the previous take, and reverts in one tap. Ops that existing routes already
 * serve (transform / remaster / regenerate) never reach here; the api injects
 * those directly.
 */
import { prisma, Prisma } from '@afrohit/db';
import { forgeKitFor, materialCoverage, seedFrom, selectMaterialRows, withCoarseMaterialRoles } from '@afrohit/shared';
import { deleteObjectByUrl, downloadToBuffer } from '../lib/storage';
import { assertStoredContentHash, certifyAudioBytes } from '../lib/certified-assets';
import { mixBuffers, runFfmpeg } from '../lib/ffmpeg';
import { markRunning, markFailed } from '../lib/jobs';
import { melodyLayer } from './own-engine';
import { separateStemsRouted } from '../lib/demucs-local';
import { processAssembleBeat } from './material';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  derivedMixLineageMeta,
  resolveCertifiedDerivedAudioSource,
  type CertifiedSourceAssetRef,
} from '../lib/derived-audio-lineage';

export type SongEditOp =
  | { kind: 'add_layer'; prompt: string }
  | { kind: 'add_fill'; timesS: number[] }
  | { kind: 'cut'; fromS: number; toS: number }
  | { kind: 'move_section'; fromIndex: number; toIndex: number }
  | { kind: 'duplicate_section'; index: number }
  | { kind: 'stem_fx'; stem: 'vocals' | 'drums' | 'bass' | 'other'; fx: 'reverb' | 'eq_low' | 'eq_high' | 'gain'; amount?: number }
  | { kind: 'vocal_drop'; fromS: number; toS: number }
  | { kind: 'resing_section'; index: number };

export interface SongEditPayload {
  jobId: string; workspaceId: string; projectId: string; songId: string;
  sourceUrl: string;
  sourceAsset: CertifiedSourceAssetRef;
  genre?: string | null; durationS?: number; bpm?: number | null; boundaries?: number[]; op: SongEditOp;
}

export interface TimeSlice { s: number; e: number }

export interface SongEditArrangement {
  durationS: number;
  boundaries: number[];
  slices?: TimeSlice[];
}

const TIME_EPSILON_S = 0.001;

const finiteDuration = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > TIME_EPSILON_S ? value : null;

export function nonEmptyTimeSlices(slices: ReadonlyArray<TimeSlice>): TimeSlice[] {
  return slices
    .filter((slice) => Number.isFinite(slice.s) && Number.isFinite(slice.e) && slice.e - slice.s > TIME_EPSILON_S)
    .map((slice) => ({ s: Math.max(0, slice.s), e: slice.e }));
}

const arrangementBoundaries = (boundaries: ReadonlyArray<number> | undefined, durationS: number): number[] =>
  [...new Set((boundaries ?? [])
    .filter((value) => Number.isFinite(value) && value > TIME_EPSILON_S && value < durationS - TIME_EPSILON_S)
    .map((value) => Math.round(value * 1000) / 1000))]
    .sort((left, right) => left - right);

export function cutTimeSlices(durationS: number, fromS: number, toS: number): TimeSlice[] {
  if (!Number.isFinite(fromS) || !Number.isFinite(toS) || fromS < 0 || !(toS > fromS)) {
    throw new Error('cut needs 0 <= from < to');
  }
  const from = Math.min(fromS, durationS);
  const to = Math.min(toS, durationS);
  if (!(to > from)) throw new Error('cut starts beyond the end of the current take');
  const slices = nonEmptyTimeSlices([{ s: 0, e: from }, { s: to, e: durationS }]);
  if (!slices.length) throw new Error('cut must leave some audio');
  return slices;
}

function arrangementFromSlices(slices: ReadonlyArray<TimeSlice>): SongEditArrangement {
  const clean = nonEmptyTimeSlices(slices);
  if (!clean.length) throw new Error('arrangement must contain audio');
  const lengths = clean.map((slice) => slice.e - slice.s);
  const durationS = lengths.reduce((sum, length) => sum + length, 0);
  let elapsed = 0;
  const boundaries: number[] = [];
  for (const length of lengths.slice(0, -1)) {
    elapsed += length;
    boundaries.push(elapsed);
  }
  return { durationS, boundaries, slices: clean };
}

export function planSongEditArrangement(
  durationS: number,
  boundaries: ReadonlyArray<number> | undefined,
  op: SongEditOp,
): SongEditArrangement {
  const duration = finiteDuration(durationS);
  if (duration == null) throw new Error('song edit needs a positive current duration');
  const currentBoundaries = arrangementBoundaries(boundaries, duration);

  if (op.kind === 'cut') {
    const slices = cutTimeSlices(duration, op.fromS, op.toS);
    const from = Math.min(op.fromS, duration);
    const to = Math.min(op.toS, duration);
    const removed = to - from;
    const outputDuration = duration - removed;
    const mapped = currentBoundaries.flatMap((boundary) => {
      if (boundary <= from) return [boundary];
      if (boundary >= to) return [boundary - removed];
      return [];
    });
    if (from > TIME_EPSILON_S && to < duration - TIME_EPSILON_S) mapped.push(from);
    return {
      durationS: outputDuration,
      boundaries: arrangementBoundaries(mapped, outputDuration),
      slices,
    };
  }

  if (op.kind === 'move_section' || op.kind === 'duplicate_section') {
    const order = [...segmentsFrom(duration, currentBoundaries)];
    if (order.length < 2) throw new Error('no measured section map on this take yet');
    if (op.kind === 'move_section') {
      const from = op.fromIndex - 1;
      const to = op.toIndex - 1;
      if (from < 0 || from >= order.length || to < 0 || to >= order.length) throw new Error(`sections are S1-S${order.length}`);
      const [section] = order.splice(from, 1);
      order.splice(to, 0, section!);
    } else {
      const index = op.index - 1;
      if (index < 0 || index >= order.length) throw new Error(`sections are S1-S${order.length}`);
      order.splice(index + 1, 0, order[index]!);
    }
    return arrangementFromSlices(order);
  }

  return { durationS: duration, boundaries: currentBoundaries };
}

export function reconcileArrangementDuration(
  arrangement: SongEditArrangement,
  measuredDurationS: number,
): SongEditArrangement {
  const measured = finiteDuration(measuredDurationS) ?? arrangement.durationS;
  const scale = arrangement.durationS > 0 ? measured / arrangement.durationS : 1;
  return {
    durationS: measured,
    boundaries: arrangementBoundaries(arrangement.boundaries.map((boundary) => boundary * scale), measured),
  };
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
export function segmentsFrom(durationS: number, boundaries?: number[]): TimeSlice[] {
  const edges = [0, ...arrangementBoundaries(boundaries, durationS), durationS];
  const segs: Array<{ s: number; e: number }> = [];
  for (let i = 0; i < edges.length - 1; i++) {
    if (edges[i + 1]! - edges[i]! > TIME_EPSILON_S) segs.push({ s: edges[i]!, e: edges[i + 1]! });
  }
  return segs;
}

/** Render an ordered list of [s,e) slices of the input into one WAV. */
async function concatSlices(input: Buffer, order: Array<{ s: number; e: number }>): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'arr-'));
  try {
    const inPath = join(dir, 'in.wav');
    await writeFile(inPath, input);
    const slices = nonEmptyTimeSlices(order);
    if (!slices.length) throw new Error('cannot concatenate an empty arrangement');
    const files: string[] = [];
    for (let i = 0; i < slices.length; i++) {
      const f = join(dir, `p${i}.wav`);
      await runFfmpeg(['-i', inPath, '-ss', String(slices[i]!.s), '-t', String(slices[i]!.e - slices[i]!.s), '-ac', '2', '-ar', '44100', f]);
      files.push(f);
    }
    const out = join(dir, 'out.wav');
    const fadeS = Math.min(0.12, ...slices.map((slice) => (slice.e - slice.s) / 4));
    await crossfadeJoin(files, out, fadeS);
    return await readFile(out);
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/** Join WAV parts with short equal-power crossfades (v3: no clicky seams). */
async function crossfadeJoin(files: string[], outPath: string, fadeS = 0.12): Promise<void> {
  if (!files.length) throw new Error('cannot join zero audio files');
  if (files.length === 1) { await runFfmpeg(['-i', files[0]!, '-c', 'copy', outPath]); return; }
  const inputs = files.flatMap((f) => ['-i', f]);
  let chain = '';
  let prev = '[0:a]';
  for (let i = 1; i < files.length; i++) {
    const lbl = i === files.length - 1 ? '[a]' : `[x${i}]`;
    chain += `${prev}[${i}:a]acrossfade=d=${fadeS}:c1=tri:c2=tri${lbl};`;
    prev = lbl;
  }
  await runFfmpeg([...inputs, '-filter_complex', chain.slice(0, -1), '-map', '[a]', '-ac', '2', '-ar', '44100', outPath]);
}

const FX_CHAIN: Record<string, (amt: number) => string> = {
  reverb: (a) => `aecho=0.8:0.88:${Math.round(40 + a * 50)}|${Math.round(70 + a * 80)}:${(0.25 + a * 0.3).toFixed(2)}|${(0.18 + a * 0.25).toFixed(2)}`,
  eq_low: (a) => `bass=g=${(a * 8 - 2).toFixed(1)}`,
  eq_high: (a) => `treble=g=${(a * 8 - 2).toFixed(1)}`,
  gain: (a) => `volume=${(0.4 + a * 1.2).toFixed(2)}`,
};

/** Demucs the record, apply an fx chain to ONE stem (or gate a region on vocals), remix all four. */
async function stemSurgery(sourceUrl: string, target: 'vocals' | 'drums' | 'bass' | 'other', chain: string): Promise<Buffer> {
  const res = await separateStemsRouted({ audioUrl: sourceUrl, mode: 'full', purpose: 'user' });
  const byRole = new Map(res.stems.map((st) => [st.role.toLowerCase(), st.url]));
  const urls: Record<string, string | undefined> = {
    vocals: byRole.get('vocals') ?? byRole.get('vocal'),
    drums: byRole.get('drums') ?? byRole.get('drum'),
    bass: byRole.get('bass'),
    other: byRole.get('other') ?? byRole.get('instrumental') ?? res.instrumentalUrl,
  };
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
  let storedUrl: string | null = null;
  try {
    const resolvedSource = await resolveCertifiedDerivedAudioSource({
      workspaceId: p.workspaceId,
      projectId: p.projectId,
      songId: p.songId,
      source: p.sourceAsset,
    });
    if (p.sourceUrl !== resolvedSource.url) throw new Error('song_edit_source_url_changed');
    const src = await downloadToBuffer(resolvedSource.url);
    assertStoredContentHash(src, resolvedSource.contentHash, 'song_edit_source_audio');
    const sourceDurationS = p.durationS ?? 180;
    const arrangementPlan = planSongEditArrangement(sourceDurationS, p.boundaries, p.op);
    let out: Buffer;
    let label = '';

    if (p.op.kind === 'cut') {
      const { fromS, toS } = p.op;
      out = await concatSlices(src, arrangementPlan.slices ?? []);
      label = `cut ${fromS.toFixed(1)}–${toS.toFixed(1)}s`;
    } else if (p.op.kind === 'add_fill') {
      const fill = await prisma.materialAsset.findFirst({
        where: {
          workspaceId: p.workspaceId,
          genre: p.genre ?? undefined,
          role: 'fill',
          readiness: 'ready',
          qualityState: 'passed',
          rightsBasis: { not: 'unknown' },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!fill) throw new Error('no fill on the shelf yet — the nightly kit forge stocks it, or run materials/synth');
      const hit = await downloadToBuffer(fill.url);
      out = await overlayAtTimes(src, hit, p.op.timesS);
      label = `fills @ ${p.op.timesS.map((t) => t.toFixed(0) + 's').join(', ')}`;
    } else if (p.op.kind === 'move_section' || p.op.kind === 'duplicate_section') {
      if (p.op.kind === 'move_section') {
        label = `moved S${p.op.fromIndex} → position ${p.op.toIndex}`;
      } else {
        label = `duplicated S${p.op.index}`;
      }
      out = await concatSlices(src, arrangementPlan.slices ?? []);
    } else if (p.op.kind === 'stem_fx') {
      const amt = Math.max(0, Math.min(1, p.op.amount ?? 0.5));
      out = await stemSurgery(p.sourceUrl, p.op.stem, FX_CHAIN[p.op.fx]!(amt));
      label = `${p.op.fx} on ${p.op.stem} (${Math.round(amt * 100)}%)`;
    } else if (p.op.kind === 'vocal_drop') {
      const { fromS, toS } = p.op;
      if (!(toS > fromS)) throw new Error('vocal_drop needs from < to');
      out = await stemSurgery(p.sourceUrl, 'vocals', `volume=enable='between(t,${fromS},${toS})':volume=0`);
      label = `vocal open ${fromS.toFixed(0)}–${toS.toFixed(0)}s`;
    } else if (p.op.kind === 'resing_section') {
      // V3: RE-PLAY one section — a FRESH owned beat under the ORIGINAL vocal.
      // (True new-vocal re-sing activates when an engine exposes section vocals;
      // this variant is real today and labeled exactly for what it is.)
      const segs = segmentsFrom(sourceDurationS, p.boundaries);
      const i = p.op.index - 1;
      if (i < 0 || i >= segs.length) throw new Error(`sections are S1–S${segs.length}`);
      const bpm = p.bpm ?? 112;
      const secPerBar = (60 / bpm) * 4;
      const seg = segs[i]!;
      const segLen = seg.e - seg.s;
      const bars = Math.max(2, Math.round(segLen / secPerBar));
      // stems: vocal + instrumental bed
      const res = await separateStemsRouted({ audioUrl: p.sourceUrl, mode: 'full', purpose: 'user', workspaceId: p.workspaceId });
      const byRole = new Map(res.stems.map((st) => [st.role.toLowerCase(), st.url]));
      const vocalUrl = byRole.get('vocals') ?? byRole.get('vocal');
      const instrUrl = res.instrumentalUrl ?? byRole.get('instrumental');
      if (!vocalUrl || !instrUrl) throw new Error('separator returned no vocal/instrumental pair');
      // Fresh owned section: the same validated rich-role selector used by the
      // primary material engine, so rejected or rights-unknown rows never enter.
      const genre = p.genre ?? 'afrobeats';
      const wantedRoles = withCoarseMaterialRoles(forgeKitFor(genre, 14));
      const rows = await prisma.materialAsset.findMany({
        where: { workspaceId: p.workspaceId, genre, role: { in: wantedRoles } },
        orderBy: { createdAt: 'desc' },
        take: 120,
      });
      const picks = selectMaterialRows(rows, wantedRoles, bpm, null, { varietySeed: seedFrom(p.jobId, p.op.index) });
      const coverage = materialCoverage(picks);
      if (!coverage.ready) {
        throw new Error(`kit too thin for a section re-play (beds=${coverage.beds}, rhythm=${coverage.rhythm}, low-end=${coverage.lowEnd}, tonal=${coverage.tonal})`);
      }
      const child = await prisma.providerJob.create({ data: { workspaceId: p.workspaceId, projectId: p.projectId, kind: 'music', provider: 'material', status: 'QUEUED', inputJson: { resingChild: p.jobId } as never } });
      await processAssembleBeat({ jobId: child.id, workspaceId: p.workspaceId, projectId: p.projectId, songId: p.songId, bpm, genre, picks, sections: [{ name: `S${p.op.index}`, bars, roles: picks.map((x) => x.role) }] } as never);
      const done = await prisma.providerJob.findUnique({ where: { id: child.id }, select: { status: true, outputJson: true } });
      const newUrl = ((done?.outputJson ?? {}) as { url?: string }).url;
      if (done?.status !== 'SUCCEEDED' || !newUrl) throw new Error('section assembly failed (see child job)');
      // splice instrumental: [0,s) + new(exact len) + [e,dur)
      const dir = await mkdtemp(join(tmpdir(), 'resing-'));
      try {
        const instrP = join(dir, 'instr.wav'); const secP = join(dir, 'sec.wav'); const secFit = join(dir, 'fit.wav');
        await writeFile(instrP, await downloadToBuffer(instrUrl));
        await writeFile(secP, await downloadToBuffer(newUrl));
        await runFfmpeg(['-i', secP, '-t', String(segLen), '-af', 'apad', '-ac', '2', '-ar', '44100', secFit]);
        const outI = join(dir, 'outI.wav');
        const parts: string[] = [];
        if (seg.s > TIME_EPSILON_S) {
          const prefix = join(dir, 'prefix.wav');
          await runFfmpeg(['-i', instrP, '-t', String(seg.s), '-ac', '2', '-ar', '44100', prefix]);
          parts.push(prefix);
        }
        parts.push(secFit);
        if (seg.e < sourceDurationS - TIME_EPSILON_S) {
          const suffix = join(dir, 'suffix.wav');
          await runFfmpeg(['-i', instrP, '-ss', String(seg.e), '-t', String(sourceDurationS - seg.e), '-ac', '2', '-ar', '44100', suffix]);
          parts.push(suffix);
        }
        await crossfadeJoin(parts, outI);
        const instrNew = await readFile(outI);
        const vox = await downloadToBuffer(vocalUrl);
        out = await mixBuffers(instrNew, vox, 1.0);
        label = `S${p.op.index} re-played — fresh beat under your original vocal`;
      } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
    } else {
      // add_layer — MusicGen conditioned on THIS song, mixed under it (fail-closed:
      // if the layer can't render, the edit fails honestly rather than faking it).
      const dur = Math.min(30, Math.max(8, Math.round(sourceDurationS)));
      const mel = await melodyLayer(p.sourceUrl, p.op.prompt, dur);
      if (!mel.url) throw new Error(mel.note);
      const layer = await downloadToBuffer(mel.url);
      out = await mixBuffers(src, layer, 0.8);
      label = `layer: ${p.op.prompt.slice(0, 40)}`;
    }

    const certified = await certifyAudioBytes({
      workspaceId: p.workspaceId,
      kind: 'masters',
      bytes: out,
    });
    const arrangement = reconcileArrangementDuration(arrangementPlan, certified.qc.durationS);
    storedUrl = certified.url;
    const preservesSourceContributors = [
      'cut',
      'move_section',
      'duplicate_section',
      'stem_fx',
      'vocal_drop',
    ].includes(p.op.kind);
    const lineageMeta = derivedMixLineageMeta({
      source: resolvedSource,
      outputContentHash: certified.contentHash,
      derivedAt: certified.verifiedAt,
      operation: p.op,
      preservesSourceContributors,
    });
    await prisma.$transaction(async (tx) => {
      const mix = await tx.mix.create({
        data: {
          projectId: p.projectId,
          songId: p.songId,
          preset: 'song-edit-source',
          url: certified.url,
          notes: `Certified song edit source: ${label}`.slice(0, 500),
          qualityState: certified.qualityState,
          contentHash: certified.contentHash,
          verifiedAt: certified.verifiedAt,
          approved: true,
          meta: {
            qc: certified.qc,
            ...lineageMeta,
            operation: p.op,
          } as never,
        },
      });
      const master = await tx.master.create({
        data: {
          projectId: p.projectId,
          songId: p.songId,
          mixId: mix.id,
          preset: `chat ${label}`.slice(0, 60),
          url: certified.url,
          qualityState: certified.qualityState,
          contentHash: certified.contentHash,
          verifiedAt: certified.verifiedAt,
          approved: true,
          meta: {
            qc: certified.qc,
            sourceMixId: mix.id,
            sourceContentHash: mix.contentHash,
            sourceAsset: p.sourceAsset ?? null,
            operation: p.op,
            arrangement: {
              durationS: arrangement.durationS,
              boundaries: arrangement.boundaries,
              bpm: p.bpm ?? null,
            },
            measured: {
              engineOk: true,
              analyzedAt: certified.verifiedAt.toISOString(),
              durationS: {
                value: arrangement.durationS,
                source: 'measured',
                confidence: 1,
                method: 'ffprobe-after-song-edit',
              },
              tempoBpm: p.bpm != null
                ? { value: p.bpm, source: 'inferred', confidence: 1, method: 'carried-from-source' }
                : { value: null, source: 'unknown', confidence: 0, method: 'song-edit-source-unavailable' },
              sectionBoundaries: {
                value: arrangement.boundaries,
                source: 'inferred',
                confidence: 1,
                method: 'deterministic-song-edit-remap',
              },
            },
          } as never,
        },
      });
      await tx.song.update({
        where: { id: p.songId },
        data: {
          status: 'MASTERED',
          releaseReady: false,
          instrumentalUrl: null,
          acapellaUrl: null,
          instrumentalMeta: Prisma.DbNull,
        },
      });
      await tx.providerJob.update({
        where: { id: p.jobId },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          outputJson: {
            masterId: master.id,
            mixId: mix.id,
            url: master.url,
            label,
            durationS: arrangement.durationS,
            boundaries: arrangement.boundaries,
            asset: {
              type: 'master',
              id: master.id,
              url: master.url,
              createdAt: master.createdAt,
              format: 'wav',
              certification: {
                status: 'certified',
                certified: true,
                approved: true,
                qualityState: master.qualityState,
                contentHash: master.contentHash,
                verifiedAt: master.verifiedAt,
              },
            },
          } as never,
        },
      });
    });
    storedUrl = null;
    // The edit just became the song's current audio — a stale instrumental/
    // acapella must never be served for the changed record. Clear; re-separate on demand.
    await prisma.song.update({ where: { id: p.songId }, data: { instrumentalUrl: null, acapellaUrl: null, instrumentalMeta: Prisma.DbNull } }).catch(() => undefined);
    // VERSION DISCIPLINE — chat edits never pile up an endless version list:
    // keep the CURRENT edit + ONE previous chat version; older chat versions
    // are pruned. The ORIGINAL render/master (non-chat presets) is never
    // touched, so "do it to the original" and full revert always survive.
    try {
      const chatVersions = await prisma.master.findMany({
        where: { songId: p.songId, preset: { startsWith: 'chat ' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      const stale = chatVersions.slice(2);
      if (stale.length) {
        await prisma.master.deleteMany({ where: { id: { in: stale.map((m: { id: string }) => m.id) } } });
        console.log(`[song-edit] pruned ${stale.length} old chat version(s) — current + 1 previous kept, original untouched`);
      }
    } catch (err) {
      console.warn('[song-edit] version prune failed (non-fatal):', (err as Error)?.message);
    }
    console.log(`[song-edit] ${p.songId}: ${label}`);
  } catch (err) {
    if (storedUrl) await deleteObjectByUrl(storedUrl).catch(() => undefined);
    await markFailed(p.jobId, `song_edit_failed: ${(err as Error)?.message ?? 'unknown'}`);
    console.warn('[song-edit] failed:', (err as Error)?.message);
  }
}
