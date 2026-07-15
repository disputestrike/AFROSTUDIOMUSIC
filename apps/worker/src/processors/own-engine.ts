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
 * Rights-classified by construction: user, code-generated, licensed, or
 * connected-provider material; unknown provenance is blocked.
 */
import { openSecret, prisma } from '@afrohit/db';
import {
  blueprintFromMeasured, forgeKitFor, structureMatch, genreSignature, synthKitFor,
  isMaterialRole, jobOf, parseLyricSections, laneFeel, seedFrom, selectMaterialRows,
  materialCoverage, type SongBlueprint, type MeasuredAnalysis, type MelodyScore,
  withCoarseMaterialRoles, isSynthesizable, hasExactMaterialRoleEvidence,
  missingExactRequestedMaterialRoles, REQUESTED_MATERIAL_ROLES_VERSION,
  requestedMaterialRoleContract,
  type MaterialRole, type RequestedMaterialRoleProvenance,
} from '@afrohit/shared';
import { melodyBrain, getSoundDNA } from '@afrohit/ai';
import { deleteObjectByUrl, downloadToBuffer, resolveAssetForProvider, uploadBytes } from '../lib/storage';
import { measureAudioQuality, mixBuffers } from '../lib/ffmpeg';
import { renderMelodyGuide } from '../lib/melody-guide';
import { measureAudio, dspAvailable } from '../lib/dsp';
import { markRunning, markSucceeded, markFailed } from '../lib/jobs';
import { assessLaneCompliance } from '../lib/lane-assess';
import { processSynthMaterial } from './synth-material';
import { processAssembleBeat } from './material';

export interface OwnEnginePayload {
  jobId: string; workspaceId: string; projectId: string; songId?: string | null;
  genre: string; bpm?: number; melody?: boolean; melodyPrompt?: string;
  blueprint?: SongBlueprint | null;
  requestedRoles?: MaterialRole[];
  requestedRoleProvenance?: RequestedMaterialRoleProvenance;
}

async function pickKit(
  workspaceId: string,
  genre: string,
  bpm: number,
  key: string,
  varietySeed: number,
  requestedRoles: readonly MaterialRole[] = [],
) {
  const rows = await prisma.materialAsset.findMany({
    where: {
      workspaceId,
      genre,
      readiness: { not: 'rejected' },
      qualityState: { notIn: ['failed', 'duplicate'] },
      rightsBasis: { not: 'unknown' },
    },
    orderBy: { createdAt: 'desc' },
    take: 240,
  });
  const exactRequested = new Set<string>(requestedRoles);
  const eligibleRows = rows.filter(
    (row) => !exactRequested.has(row.role) || hasExactMaterialRoleEvidence(row),
  );
  // Rich signature roles lead; deterministic synth primitives remain the
  // controllable foundation when a lane's collected shelf is still shallow.
  const roles = withCoarseMaterialRoles([
    ...requestedRoles,
    ...forgeKitFor(genre, 12),
    ...synthKitFor(genre),
  ]);
  return selectMaterialRows(eligibleRows, roles, bpm, key, { varietySeed });
}

function sectionsFrom(blueprint: SongBlueprint | null | undefined, roles: string[]) {
  const bed = roles.filter((r) => r !== 'fill');
  if (blueprint?.sections?.length) {
    return blueprint.sections.map((s, i) => ({ name: `S${i + 1}`, bars: Math.max(2, s.bars ?? 8), roles: bed }));
  }
  // CRAFT LAW at the grid level: textures EVOLVE — no section repeats unchanged.
  const roleJob = (role: string) => isMaterialRole(role)
    ? jobOf(role)
    : ({ drums: 'rhythm', percussion: 'rhythm', bass: 'low_end', log_drum: 'low_end', chords: 'harmony' } as Record<string, string>)[role];
  const lite = bed.filter((role) => roleJob(role) !== 'low_end');
  const noBass = bed.filter((role) => roleJob(role) !== 'low_end');
  const strip = bed.filter((role) => roleJob(role) === 'harmony' || roleJob(role) === 'melody');
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
export async function melodyLayer(groove: string, prompt: string, durationS: number, workspaceToken?: string): Promise<{ url: string | null; note: string }> {
  const token = workspaceToken || process.env.REPLICATE_API_TOKEN;
  if (!token) return { url: null, note: 'melody skipped: no REPLICATE_API_TOKEN' };
  try {
    const providerGroove = await resolveAssetForProvider(groove);
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
          input_audio: providerGroove, continuation: false,
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
    const homeKey = getSoundDNA(p.genre)?.commonKeys?.[0] ?? 'A minor';
    const varietySeed = seedFrom(p.jobId, bpm);
    const rawRequestedRoles = p.requestedRoles ?? [];
    const invalidRequestedRoles = rawRequestedRoles.filter((role) => !isMaterialRole(role));
    if (invalidRequestedRoles.length) {
      throw new Error(`own-engine: invalid requested material roles (${invalidRequestedRoles.join(', ')})`);
    }
    const requestedRoles = [...new Set(rawRequestedRoles)] as MaterialRole[];
    const requestedRoleProvenance = p.requestedRoleProvenance;
    if (requestedRoles.length || requestedRoleProvenance?.instruments.length) {
      const derivedRequest = requestedMaterialRoleContract(
        requestedRoleProvenance?.instruments,
      );
      const mappedRoles = new Set(requestedRoleProvenance?.mappings?.map((mapping) => mapping.role) ?? []);
      if (
        requestedRoleProvenance?.version !== REQUESTED_MATERIAL_ROLES_VERSION
        || requestedRoleProvenance.source !== 'user-instrument-selection'
        || derivedRequest.unsupportedInstruments.length > 0
        || derivedRequest.requestedRoles.length !== requestedRoles.length
        || derivedRequest.requestedRoles.some((role) => !requestedRoles.includes(role))
        || mappedRoles.size !== requestedRoles.length
        || requestedRoles.some((role) => !mappedRoles.has(role))
      ) {
        throw new Error('own-engine: requested material roles are missing server-derived provenance');
      }
    }

    // L1a — consume the rich collected shelf, then synthesize only missing
    // controllable foundation roles. Signature uploads/loops remain preferred.
    let picks = await pickKit(p.workspaceId, p.genre, bpm, homeKey, varietySeed, requestedRoles);
    const haveRoles = new Set(picks.map((x) => x.role));
    // Genre-correct primitives (afrobeats gets drums, NOT amapiano's log_drum).
    const synthTargets = [...new Set([
      ...synthKitFor(p.genre),
      ...requestedRoles.filter((role) => isSynthesizable(role)),
    ])];
    const missing = synthTargets.filter((r) => !haveRoles.has(r));
    if (missing.length) {
      notes.push(`kit: synth-forged ${missing.join('+')}`);
      await processSynthMaterial({ workspaceId: p.workspaceId, genre: p.genre, bpm, keySignature: homeKey, roles: missing });
      picks = await pickKit(p.workspaceId, p.genre, bpm, homeKey, varietySeed, requestedRoles);
    }
    const missingRequestedRoles = missingExactRequestedMaterialRoles(picks, requestedRoles);
    if (missingRequestedRoles.length) {
      throw new Error(
        `own-engine: exact requested material unavailable (${missingRequestedRoles.join(', ')})`,
      );
    }
    if (requestedRoles.length) {
      notes.push(`requested roles: ${requestedRoles.join('+')} (exact evidence)`);
    }
    const coverage = materialCoverage(picks);
    if (!coverage.ready) {
      throw new Error(`own-engine: verified shelf is incomplete (beds=${coverage.beds}, rhythm=${coverage.rhythm}, low-end=${coverage.lowEnd}, tonal=${coverage.tonal})`);
    }

    // L1b — assemble on the grid via the existing renderer (child job, called inline).
    const sections = sectionsFrom(p.blueprint, picks.map((x) => x.role));
    const child = await prisma.providerJob.create({
      data: {
        workspaceId: p.workspaceId,
        projectId: p.projectId,
        kind: 'music',
        provider: 'material',
        status: 'QUEUED',
        inputJson: {
          ownEngineChild: p.jobId,
          assemble: true,
          ...(requestedRoles.length
            ? { requestedRoles, requestedRoleProvenance }
            : {}),
        } as never,
      },
    });
    await processAssembleBeat({ jobId: child.id, workspaceId: p.workspaceId, projectId: p.projectId, songId: p.songId ?? undefined, bpm, genre: p.genre, picks, sections } as never);
    const done = await prisma.providerJob.findUnique({ where: { id: child.id }, select: { status: true, outputJson: true } });
    const out = (done?.outputJson ?? {}) as { beatId?: string; url?: string };
    if (done?.status !== 'SUCCEEDED' || !out.beatId || !out.url) throw new Error('own-engine: grid assembly failed (see child job)');
    notes.push(`rhythm: assembled ${picks.map((x) => x.role).join('+')} across ${sections.length} sections`);

    // MELODY BRAIN (Own Singer piece 3) — the studio COMPOSES the vocal melody
    // itself when this render belongs to a song with a lyric: explicit notes
    // per syllable from the lane's DNA (home key + Afro pentatonic bias + the
    // prosody/hook-cell laws), the taste layer only picks phrasing parameters,
    // code emits every note. The score rides the beat's meta (the OWN-VOICE
    // seam below sings it once a trained voice is READY) and the guide WAV is
    // filed as audible evidence. ALL fail-open — a melody failure never breaks
    // the beat, it just leaves an honest note.
    let melodyScore: MelodyScore | null = null;
    let melodyGuideUrl: string | null = null;
    if (p.songId) {
      try {
        const draft = await prisma.lyricDraft.findUnique({ where: { songId: p.songId } });
        const lyricSections = draft?.body ? parseLyricSections(draft.body).filter((s) => s.lines.length > 0) : [];
        if (!lyricSections.length) {
          notes.push('melody score skipped: no lyric draft for this song');
        } else {
          // Anchors come from the Writing Brain's craft object (same read the
          // singing pipeline does) — absent on old drafts, and that's fine.
          const craft = (draft?.craftJson ?? null) as { anchors?: unknown } | null;
          const anchors = Array.isArray(craft?.anchors)
            ? (craft!.anchors as unknown[]).filter((a): a is string => typeof a === 'string' && !!a.trim())
            : [];
          const feel = laneFeel(p.genre);
          melodyScore = await melodyBrain({
            genre: p.genre, bpm, key: homeKey, seed: seedFrom(p.songId, bpm),
            swing: feel.swing, syncopation: feel.syncopation,
            sections: lyricSections.map((s) => ({
              name: s.name || s.kind, kind: s.kind, lines: s.lines,
              ...(anchors.length ? { anchors } : {}),
            })),
          });
          const noteCount = melodyScore.sections.reduce((a, s) => a + s.notes.length, 0);
          notes.push(`melody score: composed ${noteCount} notes across ${melodyScore.sections.length} sections in ${homeKey}`);
          // AUDIBLE EVIDENCE — a score guide attached to this beat, never
          // mislabeled as a reusable instrument material.
          try {
            const wav = await renderMelodyGuide(melodyScore);
            melodyGuideUrl = await uploadBytes({ workspaceId: p.workspaceId, kind: 'melody-guides', bytes: wav, contentType: 'audio/wav', ext: 'wav' });
            notes.push('melody guide: rendered and attached to the beat proof');
          } catch (err) {
            notes.push(`melody guide skipped: ${(err as Error)?.message?.slice(0, 100)}`);
          }
        }
      } catch (err) {
        melodyScore = null;
        notes.push(`melody score skipped: ${(err as Error)?.message?.slice(0, 100)}`);
      }
    }

    // L2 — melody, conditioned on OUR groove (optional, fail-open).
    let finalUrl = out.url;
    const finalBeatId = out.beatId;
    const totalS = p.blueprint?.totalDurationS ?? sections.reduce((a, s) => a + s.bars, 0) * (240 / bpm);
    if (p.melody === true && totalS <= 30) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: p.workspaceId },
        select: { musicProvider: true, musicApiKey: true },
      });
      const workspaceReplicateKey = workspace?.musicProvider === 'replicate' ? openSecret(workspace.musicApiKey) : undefined;
      const mel = await melodyLayer(out.url, p.melodyPrompt ?? genreSignature(p.genre).melodyPrompt, totalS, workspaceReplicateKey);
      notes.push(mel.note);
      if (mel.url) {
        let mixedUrl: string | null = null;
        try {
          const [bed, lead] = await Promise.all([downloadToBuffer(out.url), downloadToBuffer(mel.url)]);
          const mixed = await mixBuffers(bed, lead, 0.85);
          mixedUrl = await uploadBytes({ workspaceId: p.workspaceId, kind: 'beats', bytes: mixed, contentType: 'audio/wav', ext: 'wav' });
          const qc = await measureAudioQuality(mixedUrl).catch(() => null);
          // WO-1 SAFETY RAIL: the melody-mixed take passes the same QC gate as
          // any render — a broken mix is rejected and the clean assembled bed
          // (which already passed its own gate) stays the shipped take.
          if (!qc || qc.verdict === 'fail') {
            notes.push(`melody mix rejected by QC (${(qc?.flags ?? []).join(', ') || 'unmeasured/broken audio'}) — kept the clean assembled bed`);
            await deleteObjectByUrl(mixedUrl).catch(() => {});
            mixedUrl = null;
          } else {
            finalUrl = mixedUrl;
            const assembled = await prisma.beatAsset.findUnique({ where: { id: finalBeatId }, select: { meta: true } });
            await prisma.beatAsset.update({
              where: { id: finalBeatId },
              data: {
                url: finalUrl,
                provider: 'afrohit-own',
                meta: { ...((assembled?.meta ?? {}) as Record<string, unknown>), melodyLayer: { engine: 'musicgen', qc } } as never,
              },
            });
            await deleteObjectByUrl(out.url).catch(() => {});
            mixedUrl = null;
          }
        } catch (err) {
          if (mixedUrl) await deleteObjectByUrl(mixedUrl).catch(() => {});
          notes.push(`melody mix skipped: ${(err as Error)?.message?.slice(0, 100)}`);
        }
      }
    } else if (p.melody === true) {
      notes.push(`provider melody skipped: requested duration ${Math.round(totalS)}s exceeds the verified 30s conditioning window`);
    } else {
      notes.push('provider melody off: controlled material arrangement only');
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
      data: {
        meta: {
          ...((beatRow?.meta ?? {}) as Record<string, unknown>),
          ...(melodyScore ? { melodyScore } : {}),
          ...(melodyGuideUrl ? { melodyGuideUrl } : {}),
          ownEngine: {
            v: 2,
            layers: notes,
            blueprintMatch,
            ...(requestedRoles.length
              ? {
                  requestedRoles,
                  requestedRoleProvenance,
                  requestedRoleReceipts: picks
                    .filter((pick) => requestedRoles.includes(pick.role as MaterialRole))
                    .map((pick) => ({
                      materialId: pick.id,
                      role: pick.role,
                      roleEvidence: pick.roleEvidence,
                      rightsBasis: pick.rightsBasis,
                    })),
                }
              : {}),
          },
        } as never,
      },
    });

    // OWN-VOICE seam: once a VoiceProfile trained via POST /voices/train is READY (trainedVersion set), the artist's trained voice sings the lead here — inference wiring lands in a later round.
    await markSucceeded(p.jobId, {
      engine: 'afrohit-own-v1', beatId: finalBeatId, url: finalUrl, blueprintMatch, layers: notes,
      ...(requestedRoles.length
        ? {
            requestedRoles,
            requestedRoleProvenance,
            requestedRoleReceipts: picks
              .filter((pick) => requestedRoles.includes(pick.role as MaterialRole))
              .map((pick) => ({
                materialId: pick.id,
                role: pick.role,
                roleEvidence: pick.roleEvidence,
                rightsBasis: pick.rightsBasis,
              })),
          }
        : {}),
      voice: 'record or upload your vocal (POST /projects/:id/vocals/upload) — the mixer picks it up as lead',
    });
    console.log(`[own-engine] ${p.genre} done — ${notes.join(' | ')}${blueprintMatch != null ? ` | skeleton ${Math.round(blueprintMatch * 100)}%` : ''}`);
  } catch (err) {
    await markFailed(p.jobId, `own_engine_failed: ${(err as Error)?.message ?? 'unknown'}`);
    console.warn('[own-engine] failed:', (err as Error)?.message);
  }
}
