/**
 * THE AFROHIT ENGINE v1 — composed, not rented. One job chains the four layers:
 *
 *  L1 RHYTHM (owned):   ensure a signature kit (synth-forge any missing role),
 *                       pick real material, assemble on a locked grid via the
 *                       existing Phase-5 renderer. In-lane BY CONSTRUCTION.
 *  L2 MELODY (conditioned): optional — MusicGen (open weights, Replicate) with
 *                       OUR assembled groove as input_audio, so the melodic
 *                       layer honors the exact beat. Fail-open: skipped with a
 *                       disclosed reason, never fatal.
 *  L3 VOICE:            the artist's uploaded vocal rides the existing
 *                       /vocals/upload -> mixer path over this instrumental.
 *  L4 PROOF:            measured QC + lane compliance (existing lane-assess) +
 *                       blueprint skeleton verification. Receipts, not vibes.
 *
 * Rights-clean by construction: synth/forged/user material + open weights.
 * Nobody can fence this engine off.
 */
import { prisma } from '@afrohit/db';
import { blueprintFromMeasured, structureMatch, genreSignature, synthKitFor, MATERIAL_GAINS, type SongBlueprint, type MeasuredAnalysis } from '@afrohit/shared';
import { downloadToBuffer, uploadBytes } from '../lib/storage';
import { measureAudioQuality, mixBuffers } from '../lib/ffmpeg';
import { measureAudio, dspAvailable } from '../lib/dsp';
import { markRunning, markSucceeded, markFailed } from '../lib/jobs';
import { assessLaneCompliance } from '../lib/lane-assess';
import { processSynthMaterial } from './synth-material';
import { processAssembleBeat } from './material';

export interface OwnEnginePayload {
  jobId: string; workspaceId: string; projectId: string; songId?: string | null;
  genre: string; bpm?: number; melody?: boolean; melodyPrompt?: string;
  blueprint?: SongBlueprint | null;
}

const BED_ROLES = ['log_drum', 'drums', 'percussion', 'bass', 'chords'] as const;

async function pickKit(workspaceId: string, genre: string, bpm: number) {
  const rows = await prisma.materialAsset.findMany({ where: { workspaceId, genre }, orderBy: { createdAt: 'desc' }, take: 120 });
  // processAssembleBeat's contract is the MAPPED pick shape {id,url,sourceBpm,role,gain}
  // — raw Prisma rows carry bpm (not sourceBpm) and no gain, which crashed the
  // assembler (gain.toFixed) on every own-engine run.
  const picks: Array<{ id: string; url: string; sourceBpm: number; role: string; gain: number }> = [];
  for (const role of BED_ROLES) {
    const ofRole = rows.filter((r: { role: string }) => r.role === role).sort((a: { bpm: number | null }, b: { bpm: number | null }) => Math.abs((a.bpm ?? bpm) - bpm) - Math.abs((b.bpm ?? bpm) - bpm));
    const best = ofRole[0];
    if (best) picks.push({ id: best.id, url: best.url, sourceBpm: best.bpm ?? bpm, role, gain: MATERIAL_GAINS[role] ?? 0.9 });
  }
  return picks;
}

function sectionsFrom(blueprint: SongBlueprint | null | undefined, roles: string[]) {
  const bed = roles.filter((r) => r !== 'fill');
  if (blueprint?.sections?.length) {
    return blueprint.sections.map((s, i) => ({ name: `S${i + 1}`, bars: Math.max(2, s.bars ?? 8), roles: bed }));
  }
  // CRAFT LAW at the grid level: textures EVOLVE — no section repeats unchanged.
  const lite = bed.filter((r) => r !== 'log_drum');
  const noBass = bed.filter((r) => r !== 'bass');
  const strip = bed.filter((r) => r === 'bass' || r === 'chords');
  return [
    { name: 'intro', bars: 4, roles: lite.length ? lite : bed },
    { name: 'verse', bars: 16, roles: noBass.length >= 2 ? noBass : bed }, // bass held back
    { name: 'hook', bars: 8, roles: bed },                                 // full band arrives
    { name: 'verse2', bars: 16, roles: bed },                              // fuller than verse 1
    { name: 'bridge', bars: 8, roles: strip.length ? strip : lite },       // energy flip: strip-back
    { name: 'hook2', bars: 8, roles: bed },
    { name: 'outro', bars: 4, roles: lite.length ? lite : bed },
  ];
}

/** Minimal direct MusicGen call (Replicate, Prefer:wait) with OUR groove as the
 *  melody condition. Returns an audio URL or null (reason logged) — fail-open. */
export async function melodyLayer(groove: string, prompt: string, durationS: number): Promise<{ url: string | null; note: string }> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return { url: null, note: 'melody skipped: no REPLICATE_API_TOKEN' };
  try {
    let version = process.env.REPLICATE_MUSIC_VERSION;
    if (!version) {
      const mres = await fetch('https://api.replicate.com/v1/models/meta/musicgen', { headers: { authorization: `Bearer ${token}` } });
      version = ((await mres.json()) as { latest_version?: { id?: string } }).latest_version?.id;
    }
    if (!version) return { url: null, note: 'melody skipped: no model version' };
    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'wait=60' },
      body: JSON.stringify({
        version,
        input: {
          prompt, duration: Math.min(30, Math.max(8, Math.round(durationS))),
          input_audio: groove, continuation: false,
          model_version: 'melody-large', output_format: 'wav',
        },
      }),
    });
    let data = (await res.json()) as { id?: string; status?: string; output?: string | string[]; error?: string };
    // prefer:wait only holds 60s — a slower render comes back 'processing' while
    // Replicate keeps working. POLL it out (up to ~5 min) instead of dropping a
    // render we already paid for.
    const deadline = Date.now() + 5 * 60_000;
    while (data.id && (data.status === 'starting' || data.status === 'processing') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5_000));
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${data.id}`, { headers: { authorization: `Bearer ${token}` } });
      data = (await poll.json()) as typeof data;
    }
    const out = Array.isArray(data.output) ? data.output[0] : data.output;
    if (data.status === 'succeeded' && out) return { url: out, note: 'melody: musicgen conditioned on our groove' };
    return { url: null, note: `melody skipped: ${data.error ?? data.status ?? 'no output'}` };
  } catch (err) {
    return { url: null, note: `melody skipped: ${(err as Error)?.message?.slice(0, 120)}` };
  }
}

export async function processOwnEngine(p: OwnEnginePayload): Promise<void> {
  await markRunning(p.jobId);
  const notes: string[] = [];
  try {
    const bpm = p.bpm ?? genreSignature(p.genre).bpm ?? 112;

    // L1a — ensure the kit: synth-forge any missing signature role (owned, seconds).
    let picks = await pickKit(p.workspaceId, p.genre, bpm);
    const haveRoles = new Set(picks.map((x) => x.role));
    // Genre-correct primitives (afrobeats gets drums, NOT amapiano's log_drum).
    const missing = synthKitFor(p.genre).filter((r) => !haveRoles.has(r));
    if (missing.length) {
      notes.push(`kit: synth-forged ${missing.join('+')}`);
      await processSynthMaterial({ workspaceId: p.workspaceId, genre: p.genre, bpm, roles: missing });
      picks = await pickKit(p.workspaceId, p.genre, bpm);
    }
    // the fill rides ALONGSIDE the bed — the assembler overlays it at boundaries + 16-bar pulses
    const fillPick = (await prisma.materialAsset.findFirst({ where: { workspaceId: p.workspaceId, genre: p.genre, role: 'fill' }, orderBy: { createdAt: 'desc' } }));
    if (fillPick) picks.push({ id: fillPick.id, url: fillPick.url, sourceBpm: fillPick.bpm ?? bpm, role: 'fill', gain: 0.9 });
    if (picks.length < 2) throw new Error('own-engine: could not build a kit (need >=2 bed roles)');

    // L1b — assemble on the grid via the existing renderer (child job, called inline).
    const sections = sectionsFrom(p.blueprint, picks.map((x) => x.role));
    const child = await prisma.providerJob.create({
      data: { workspaceId: p.workspaceId, projectId: p.projectId, kind: 'music', provider: 'material', status: 'QUEUED', inputJson: { ownEngineChild: p.jobId, assemble: true } as never },
    });
    await processAssembleBeat({ jobId: child.id, workspaceId: p.workspaceId, projectId: p.projectId, songId: p.songId ?? undefined, bpm, genre: p.genre, picks, sections } as never);
    const done = await prisma.providerJob.findUnique({ where: { id: child.id }, select: { status: true, outputJson: true } });
    const out = (done?.outputJson ?? {}) as { beatId?: string; url?: string };
    if (done?.status !== 'SUCCEEDED' || !out.beatId || !out.url) throw new Error('own-engine: grid assembly failed (see child job)');
    notes.push(`rhythm: assembled ${picks.map((x) => x.role).join('+')} across ${sections.length} sections`);

    // L2 — melody, conditioned on OUR groove (optional, fail-open).
    let finalUrl = out.url;
    let finalBeatId = out.beatId;
    const totalS = p.blueprint?.totalDurationS ?? sections.reduce((a, s) => a + s.bars, 0) * (240 / bpm);
    if (p.melody !== false) {
      const mel = await melodyLayer(out.url, p.melodyPrompt ?? genreSignature(p.genre).melodyPrompt, totalS);
      notes.push(mel.note);
      if (mel.url) {
        try {
          const [bed, lead] = await Promise.all([downloadToBuffer(out.url), downloadToBuffer(mel.url)]);
          const mixed = await mixBuffers(bed, lead, 0.85);
          const mixedUrl = await uploadBytes({ workspaceId: p.workspaceId, kind: 'beats', bytes: mixed, contentType: 'audio/wav', ext: 'wav' });
          const qc = await measureAudioQuality(mixedUrl).catch(() => null);
          // WO-1 SAFETY RAIL: the melody-mixed take passes the same QC gate as
          // any render — a broken mix is rejected and the clean assembled bed
          // (which already passed its own gate) stays the shipped take.
          if (qc?.verdict === 'fail') {
            notes.push(`melody mix REJECTED by QC (${(qc.flags ?? []).join(', ') || 'broken audio'}) — kept the clean assembled bed`);
          } else {
            finalUrl = mixedUrl;
            const beat = await prisma.beatAsset.create({
              data: {
                projectId: p.projectId, songId: p.songId ?? null, url: finalUrl, format: 'wav', bpm,
                provider: 'afrohit-own', approved: true,
                meta: { ownEngine: { v: 1, layers: notes }, qc } as never,
              },
            });
            finalBeatId = beat.id;
          }
        } catch (err) {
          notes.push(`melody mix skipped: ${(err as Error)?.message?.slice(0, 100)}`);
        }
      }
    }

    // L4 — PROOF: lane compliance (persists measured/compliance/laneRepair on the
    // beat) + blueprint skeleton verification, receipts on the row.
    await assessLaneCompliance({ workspaceId: p.workspaceId, genre: p.genre, beatId: finalBeatId, audioUrl: finalUrl });
    let blueprintMatch: number | null = null;
    if (p.blueprint && (await dspAvailable())) {
      const m: MeasuredAnalysis | null = await measureAudio(finalUrl).catch(() => null);
      blueprintMatch = m?.engineOk ? structureMatch(blueprintFromMeasured(m), p.blueprint) : null;
    }
    const beatRow = await prisma.beatAsset.findUnique({ where: { id: finalBeatId }, select: { meta: true } });
    await prisma.beatAsset.update({
      where: { id: finalBeatId },
      data: { meta: { ...((beatRow?.meta ?? {}) as Record<string, unknown>), ownEngine: { v: 1, layers: notes, blueprintMatch } } as never },
    });

    // OWN-VOICE seam: once a VoiceProfile trained via POST /voices/train is READY (trainedVersion set), the artist's trained voice sings the lead here — inference wiring lands in a later round.
    await markSucceeded(p.jobId, {
      engine: 'afrohit-own-v1', beatId: finalBeatId, url: finalUrl, blueprintMatch, layers: notes,
      voice: 'record or upload your vocal (POST /projects/:id/vocals/upload) — the mixer picks it up as lead',
    });
    console.log(`[own-engine] ${p.genre} done — ${notes.join(' | ')}${blueprintMatch != null ? ` | skeleton ${Math.round(blueprintMatch * 100)}%` : ''}`);
  } catch (err) {
    await markFailed(p.jobId, `own_engine_failed: ${(err as Error)?.message ?? 'unknown'}`);
    console.warn('[own-engine] failed:', (err as Error)?.message);
  }
}
