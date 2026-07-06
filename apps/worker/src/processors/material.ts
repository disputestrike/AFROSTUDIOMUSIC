import { prisma } from '@afrohit/db';
import { musicAdapter } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { downloadToBuffer, uploadBytes, ingestRemoteFile } from '../lib/storage';
import { trimToLoop, assembleBeat, measureAudioQuality, type AssemblyLayer, type AssemblySection } from '../lib/ffmpeg';
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

// Role → forge prompt. ISOLATION is everything: one instrument group per loop,
// dry, no melody bleeding in — this is what makes the material arrangeable.
const FORGE_PROMPTS: Record<string, (genre: string, bpm: number) => string> = {
  drums: (g, b) => `solo drum kit groove loop for ${g.replace(/_/g, ' ')}, ${b} bpm, tight kick snare and hi-hats only, completely dry, no melody, no bass, no vocals, seamless loop`,
  log_drum: (g, b) => `solo amapiano log drum bassline loop, ${b} bpm, deep woody log drum only, completely dry, no other instruments, no vocals, seamless loop`,
  bass: (g, b) => `solo bassline loop for ${g.replace(/_/g, ' ')}, ${b} bpm, warm round sub bass only, no drums, no melody, no vocals, seamless loop`,
  percussion: (g, b) => `solo percussion bed loop for ${g.replace(/_/g, ' ')}, ${b} bpm, shakers congas and woodblock only, no kick, no snare, no melody, no vocals, seamless loop`,
  chords: (g, b) => `solo warm chord bed loop for ${g.replace(/_/g, ' ')}, ${b} bpm, soft keys or guitar chords only, no drums, no bass, no vocals, seamless loop`,
};

interface ForgePayload {
  jobId: string;
  workspaceId: string;
  genre: string;
  role: string;
  bpm: number;
  bars?: number;
}

export async function processForgeMaterial(p: ForgePayload) {
  await markRunning(p.jobId);
  try {
    const promptFor = FORGE_PROMPTS[p.role];
    if (!promptFor) throw new Error(`unknown material role: ${p.role}`);
    const bars = p.bars ?? 8;
    const loopDur = Math.ceil((60 / p.bpm) * 4 * bars) + 3; // headroom for trim
    const ws = await prisma.workspace.findUnique({ where: { id: p.workspaceId }, select: { musicProvider: true, musicApiKey: true } });
    const adapter = musicAdapter(ws?.musicProvider ?? undefined, ws?.musicApiKey ?? undefined);

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
        vibePrompt: promptFor(p.genre, p.bpm),
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
    const raw = await downloadToBuffer(result.output.mainAudioUrl);
    const loop = await trimToLoop(raw, p.bpm, bars);
    const url = await uploadBytes({ workspaceId: p.workspaceId, kind: 'material', bytes: loop, contentType: 'audio/wav', ext: 'wav' });
    const qc = await measureAudioQuality(url).catch(() => null);
    // ISOLATED-LOOP gate (not song thresholds): a solo dry chord bed or shaker
    // loop is SUPPOSED to be quiet-ish and steady — 'too_quiet'/'flat' would
    // wrongly discard good material. Only reject true junk: near-silence,
    // clipping, or no meaningful duration.
    if (qc) {
      const silent = qc.integratedLufs !== null && qc.integratedLufs < -38;
      const clipping = (qc.flags ?? []).includes('clipping');
      const tooShort = qc.durationS > 0 && qc.durationS < 3;
      if (silent || clipping || tooShort) {
        throw new Error(`forged ${p.role} loop is unusable (${silent ? 'near-silent' : clipping ? 'clipping' : 'too short'}) — discarded, try again`);
      }
    }

    const material = await prisma.materialAsset.create({
      data: {
        workspaceId: p.workspaceId,
        kind: 'loop',
        role: p.role,
        genre: p.genre,
        bpm: p.bpm,
        bars,
        durationS: (60 / p.bpm) * 4 * bars,
        url,
        source: 'forged',
        meta: { qc, prompt: promptFor(p.genre, p.bpm), engine: adapter.name } as never,
      },
    });
    await markSucceeded(p.jobId, { materialId: material.id, role: p.role, url, qc: qc?.verdict ?? 'unmeasured' }, result.estimatedCostUsd);
  } catch (err) {
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
  /** materials picked API-side: [{id, url, sourceBpm, role, gain}] */
  picks: Array<{ id: string; url: string; sourceBpm: number; role: string; gain: number }>;
}

export async function processAssembleBeat(p: AssemblePayload) {
  await markRunning(p.jobId);
  const dir = await mkdtemp(join(tmpdir(), 'mats-'));
  try {
    if (!p.picks.length) throw new Error('no material picked — forge some loops for this genre first');
    // Pull every picked loop local.
    const layers: AssemblyLayer[] = [];
    const roleIdx = new Map<string, number>();
    for (let i = 0; i < p.picks.length; i++) {
      const pick = p.picks[i]!;
      const buf = await downloadToBuffer(pick.url);
      const path = join(dir, `mat${i}.wav`);
      await writeFile(path, buf);
      layers.push({ path, sourceBpm: pick.sourceBpm || p.bpm, gain: pick.gain });
      roleIdx.set(pick.role, i);
    }
    const idx = (roles: string[]) => roles.map((r) => roleIdx.get(r)).filter((i): i is number => i != null);
    const all = layers.map((_, i) => i);
    // The arrangement — a real producer's build: strip in, stack the hook, breathe, strip out.
    const sections: AssemblySection[] = [
      { name: 'intro', bars: 4, layerIdx: idx(['percussion', 'chords']).length ? idx(['percussion', 'chords']) : all.slice(0, 1) },
      { name: 'verse', bars: 8, layerIdx: idx(['drums', 'percussion', 'bass', 'log_drum']).length ? idx(['drums', 'percussion', 'bass', 'log_drum']) : all },
      { name: 'hook', bars: 8, layerIdx: all },
      { name: 'verse2', bars: 8, layerIdx: idx(['drums', 'percussion', 'bass', 'log_drum', 'chords']).length ? idx(['drums', 'percussion', 'bass', 'log_drum', 'chords']) : all },
      { name: 'hook2', bars: 8, layerIdx: all },
      { name: 'outro', bars: 4, layerIdx: idx(['percussion', 'log_drum']).length ? idx(['percussion', 'log_drum']) : all.slice(0, 1) },
    ];
    const beatWav = await assembleBeat({ layers, sections, targetBpm: p.bpm });
    const url = await uploadBytes({ workspaceId: p.workspaceId, kind: 'beats', bytes: beatWav, contentType: 'audio/wav', ext: 'wav' });
    const qc = await measureAudioQuality(url).catch(() => null);

    const beat = await prisma.beatAsset.create({
      data: {
        projectId: p.projectId,
        songId: p.songId,
        url,
        format: 'wav',
        bpm: p.bpm,
        duration: qc?.durationS ?? null,
        provider: 'material',
        approved: true,
        meta: {
          assembled: true,
          materialIds: p.picks.map((x) => x.id),
          roles: p.picks.map((x) => x.role),
          sections: sections.map((s) => `${s.name}:${s.bars}`),
          qc,
        } as never,
      },
    });
    await markSucceeded(p.jobId, { beatId: beat.id, url, roles: p.picks.map((x) => x.role), qc: qc?.verdict ?? 'unmeasured' });
  } catch (err) {
    await markFailed(p.jobId, err);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
