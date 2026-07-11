import { prisma } from '@afrohit/db';
import { musicAdapter } from '@afrohit/ai';
import { markFailed, markRunning, markSucceeded } from '../lib/jobs';
import { downloadToBuffer, uploadBytes, ingestRemoteFile } from '../lib/storage';
import { trimToLoop, assembleBeat, measureAudioQuality, type AssemblyLayer, type AssemblySection } from '../lib/ffmpeg';
import { overlayFills } from '../lib/fills';
import { genreSignature, planFills, isMaterialRole, jobOf, type MaterialRole } from '@afrohit/shared';
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
import { forgePromptFor, isKeyedRole } from '../lib/forge-prompts';

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
    const prompt = forgePromptFor(p.role, p.genre, p.bpm, p.keySignature);
    if (!prompt) throw new Error(`unknown material role: ${p.role}`);
    const key = isKeyedRole(p.role) ? p.keySignature : undefined;
    const bars = p.bars ?? 8;
    const loopDur = Math.ceil((60 / p.bpm) * 4 * bars) + 3; // headroom for trim
    const ws = await prisma.workspace.findUnique({ where: { id: p.workspaceId }, select: { musicProvider: true, musicApiKey: true } });
    const adapter = musicAdapter(ws?.musicProvider ?? undefined, ws?.musicApiKey ?? undefined);
    // STUB GUARD (audit HIGH): if the forge provider resolves to the stub, EVERY
    // forged loop would be the SAME SoundHelix mp3 chopped to a "loop" — it passes
    // loop-QC and gets registered as a real MaterialAsset, so the whole "owned,
    // rights-clean" engine ends up built from one placeholder rock track. Refuse.
    if (adapter.name === 'stub' && process.env.ALLOW_STUB_AUDIO !== '1') {
      throw new Error('forge blocked: no real music engine configured (stub) — set a workspace engine before forging owned material.');
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
        meta: { qc, prompt, engine: adapter.name, origin: 'forged', license: 'owned-generation' } as never,
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
  /** materials picked API-side: [{id, url, sourceBpm, role, gain, pan}] */
  picks: Array<{ id: string; url: string; sourceBpm: number; role: string; gain: number; pan?: number }>;
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
      layers.push({ path, sourceBpm: pick.sourceBpm || p.bpm, gain: pick.gain, pan: pick.pan ?? 0 });
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
    // WO-1 SAFETY RAIL: assembled output passes the SAME QC gate as provider
    // output — a broken render (near-silence/clipping) is rejected with the real
    // reason, never approved. 'weak' ships flagged; unmeasured ships disclosed.
    if (qc?.verdict === 'fail') {
      throw new Error(`assembled take failed QC (${(qc.flags ?? []).join(', ') || 'broken audio'}) — nothing shipped`);
    }

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
          // PROOF-OF-USE (Executive-Summary spec): the full assembly log — every
          // loop ID with its transforms (stretch ratio to target bpm, gain, pan).
          // This is how "which materials made this beat" is provable per beat.
          assemblyLog: p.picks.map((x) => ({
            materialId: x.id,
            role: x.role,
            sourceBpm: x.sourceBpm,
            targetBpm: p.bpm,
            stretchRatio: +(p.bpm / (x.sourceBpm || p.bpm)).toFixed(4),
            gain: x.gain,
            pan: x.pan ?? 0,
          })),
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
