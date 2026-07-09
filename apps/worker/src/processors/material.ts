import { prisma } from '@afrohit/db';
import { musicAdapter } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { downloadToBuffer, uploadBytes, ingestRemoteFile } from '../lib/storage';
import { trimToLoop, assembleBeat, measureAudioQuality, type AssemblyLayer, type AssemblySection } from '../lib/ffmpeg';
import { overlayFills } from '../lib/fills';
import { genreSignature, planFills } from '@afrohit/shared';
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

// Role → forge prompt. ISOLATION keeps one instrument group per loop (so it's
// arrangeable), but NOT lifeless: the old prompts said "completely dry" and asked
// for bare "kick snare hats" / "shakers woodblock", which is exactly why the loops
// sounded dull and thin. These ask for CHARACTER — punch, swing, human timing,
// warmth and a little natural room — plus the real African hand-drums (talking
// drum, shekere, agogo) so Afro beats have their signature texture. Melodic roles
// are forged IN KEY so separately-forged loops fit together.
const FORGE_PROMPTS: Record<string, (genre: string, bpm: number, key?: string) => string> = {
  drums: (g, b) => `solo ${g.replace(/_/g, ' ')} drum groove, ${b} bpm — punchy tuned kick, crisp snare and rimshots, lively swung hi-hats with ghost notes, a real human pocket and a little room so it breathes; drums only, no melody, no bass, no vocals, seamless loop`,
  talking_drum: (g, b) => `solo Nigerian talking drum (gángan / dùndún) groove for ${g.replace(/_/g, ' ')}, ${b} bpm — expressive pitch-bending talking-drum phrases with call-and-response, warm resonant hand-played skin tone; talking drum only, no drum kit, no melody, no vocals, seamless loop`,
  log_drum: (g, b, k) => `solo amapiano log drum bassline${k ? ` in ${k}` : ''}, ${b} bpm — deep round woody log drum with real punch, bounce and tuneful glides, a little air around it; log drum only, no other instruments, no vocals, seamless loop`,
  bass: (g, b, k) => `solo ${g.replace(/_/g, ' ')} bassline${k ? ` in ${k}` : ''}, ${b} bpm — warm round sub-bass with genuine groove and movement, fingered feel sitting in the pocket; bass only, no drums, no melody, no vocals, seamless loop`,
  percussion: (g, b) => `solo African percussion bed for ${g.replace(/_/g, ' ')}, ${b} bpm — interlocking shekere, agogo bells, congas and shaker with organic groove, space and human timing; percussion only, no kick, no snare, no melody, no vocals, seamless loop`,
  chords: (g, b, k) => `solo ${g.replace(/_/g, ' ')} chord bed${k ? ` in ${k}` : ''}, ${b} bpm — warm rich keys or clean guitar chords with gentle movement, emotive and musical with natural space; chords only, no drums, no bass, no vocals, seamless loop`,
  fill: (g, b) => `solo ${g.replace(/_/g, ' ')} DRUM FILL, ${b} bpm — a short 1-2 bar drum roll/tumble that BUILDS and lifts into a new section: rising tom rolls, snare buzz and a crash-style accent landing on the downbeat; drums only, no melody, no bass, no vocals — a one-shot fill, not a repeating loop`,
};
const MELODIC_ROLES = new Set(['log_drum', 'bass', 'chords']);

interface ForgePayload {
  jobId: string;
  workspaceId: string;
  genre: string;
  role: string;
  bpm: number;
  keySignature?: string;
  bars?: number;
}

export async function processForgeMaterial(p: ForgePayload) {
  await markRunning(p.jobId);
  try {
    const promptFor = FORGE_PROMPTS[p.role];
    if (!promptFor) throw new Error(`unknown material role: ${p.role}`);
    const key = MELODIC_ROLES.has(p.role) ? p.keySignature : undefined;
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
        vibePrompt: promptFor(p.genre, p.bpm, key),
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
        keySignature: key ?? null,
        bars,
        durationS: (60 / p.bpm) * 4 * bars,
        url,
        source: 'forged',
        meta: { qc, prompt: promptFor(p.genre, p.bpm, key), engine: adapter.name } as never,
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
  /** Claude-authored arrangement (API-side, validated); absent → classic template. */
  sections?: Array<{ name: string; bars: number; roles: string[] }> | null;
}

export async function processAssembleBeat(p: AssemblePayload) {
  await markRunning(p.jobId);
  const dir = await mkdtemp(join(tmpdir(), 'mats-'));
  try {
    if (!p.picks.length) throw new Error('no material picked — forge some loops for this genre first');
    // A 'fill' is a transition, not a bed — keep it OUT of the section layers (it's
    // overlaid at boundaries below), else it would play continuously under the hook.
    const bedPicks = p.picks.filter((x) => x.role !== 'fill');
    if (!bedPicks.length) throw new Error('no bed material — forge drums/bass/chords for this genre first');
    // Pull every picked loop local.
    const layers: AssemblyLayer[] = [];
    const roleIdx = new Map<string, number>();
    for (let i = 0; i < bedPicks.length; i++) {
      const pick = bedPicks[i]!;
      const buf = await downloadToBuffer(pick.url);
      const path = join(dir, `mat${i}.wav`);
      await writeFile(path, buf);
      layers.push({ path, sourceBpm: pick.sourceBpm || p.bpm, gain: pick.gain });
      roleIdx.set(pick.role, i);
    }
    const idx = (roles: string[]) => roles.map((r) => roleIdx.get(r)).filter((i): i is number => i != null);
    const all = layers.map((_, i) => i);
    // The arrangement: Claude's plan when the API authored one (creative,
    // per-material), otherwise the classic producer template — strip in,
    // stack the hook, breathe, strip out.
    const planned: AssemblySection[] = (p.sections ?? [])
      .map((s) => ({ name: s.name, bars: s.bars, layerIdx: idx(s.roles) }))
      .filter((s) => s.layerIdx.length > 0 && s.bars >= 2);
    const sections: AssemblySection[] = planned.length >= 3 ? planned : [
      { name: 'intro', bars: 4, layerIdx: idx(['percussion', 'chords']).length ? idx(['percussion', 'chords']) : all.slice(0, 1) },
      { name: 'verse', bars: 8, layerIdx: idx(['drums', 'percussion', 'bass', 'log_drum']).length ? idx(['drums', 'percussion', 'bass', 'log_drum']) : all },
      { name: 'hook', bars: 8, layerIdx: all },
      { name: 'verse2', bars: 8, layerIdx: idx(['drums', 'percussion', 'bass', 'log_drum', 'chords']).length ? idx(['drums', 'percussion', 'bass', 'log_drum', 'chords']) : all },
      { name: 'hook2', bars: 8, layerIdx: all },
      { name: 'outro', bars: 4, layerIdx: idx(['percussion', 'log_drum']).length ? idx(['percussion', 'log_drum']) : all.slice(0, 1) },
    ];
    const beatWav = await assembleBeat({ layers, sections, targetBpm: p.bpm });

    // PHASE 5 — lay fills at the arrangement's KNOWN section boundaries (bar counts
    // give exact seconds). Gated FILL_OVERLAY=1; best-effort, clean assembly kept on
    // any failure. A 'fill' loop is excluded from the section LAYERS (it's a
    // transition, not a bed) and used only here.
    let beatBytes = beatWav;
    if (process.env.FILL_OVERLAY !== '0') {
      try {
        const fillPick = p.picks.find((x) => x.role === 'fill');
        const fillMat = fillPick ?? (await prisma.materialAsset.findFirst({ where: { workspaceId: p.workspaceId, role: 'fill', OR: [{ genre: p.genre }, { genre: null }] }, orderBy: { createdAt: 'desc' } }));
        if (fillMat) {
          const secPerBar = (60 / p.bpm) * 4;
          const boundaries: number[] = [];
          let cum = 0;
          for (const s of sections) { cum += s.bars; boundaries.push(cum * secPerBar); }
          boundaries.pop(); // no fill after the final section
          const placements = planFills(p.bpm, cum * secPerBar, boundaries, genreSignature(p.genre).fillBars);
          if (placements.length) {
            const fillBuf = await downloadToBuffer(fillMat.url);
            beatBytes = await overlayFills(beatWav, fillBuf, placements.map((f) => f.atS));
            console.log(`[assemble] overlaid ${placements.length} fills at section boundaries`);
          }
        }
      } catch (err) {
        console.warn('[assemble] fill overlay failed (clean assembly kept):', (err as Error)?.message);
      }
    }
    const url = await uploadBytes({ workspaceId: p.workspaceId, kind: 'beats', bytes: beatBytes, contentType: 'audio/wav', ext: 'wav' });
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
          arrangedBy: planned.length >= 3 ? 'claude' : 'template',
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
