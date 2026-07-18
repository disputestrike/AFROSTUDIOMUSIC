/**
 * VIDEO TREATMENT (full-song) — off the request path.
 *
 * The creative-director treatment is long-form: one main LLM pass (up to 120s),
 * an optional critic (60s) and an optional repair (120s) — worst case a few
 * minutes. Run synchronously it blew straight through Railway/Cloudflare's ~100s
 * edge timeout, so "Make the whole video" could 502 at the proxy while the work
 * kept running. This processor owns that compute on the `video` queue; the route
 * now returns 202 + a jobId and the client polls /jobs/:id. The compute is a
 * faithful port of the old inline route body — same laws, same gates:
 *   - THE SONG IS THE SUBJECT (its words + measured structure drive the plan)
 *   - WHO IS SINGING (recovered voice → PERFORMER LAW / duet gate)
 *   - THE DIRECTOR'S ROOM (grounded critic + one minimal repair, best-effort)
 * Text only — never spends a video-render credit. A domain rejection (invalid
 * output / duet gate) is a SUCCESSFUL job whose output says `rejected` (the
 * lyric doctrine: a rejection is the correct output, not an error to retry).
 */
import { prisma } from "@afrohit/db";
import {
  assumedThreeActSections,
  missingDuetLeads,
  normalizeVideoTreatment,
  performersFromVoice,
  treatmentSectionsFromBoundaries,
  currentPlayableAsset,
  playableArrangement,
  playableAssetHistory,
  type TreatmentSection,
} from "@afrohit/shared";
import { prompts, generateJson } from "@afrohit/ai";
import { markRunning, markSucceeded } from "../lib/jobs";

type TreatmentInput = {
  projectId: string;
  songId?: string | null;
  format: "vertical" | "square" | "landscape";
  durationS?: number;
  prompt?: string;
  vision?: string;
  visionMode?: "strict" | "enhance";
};

export type VideoTreatmentPayload = {
  jobId: string;
  workspaceId: string;
  projectId: string;
  songId: string | null;
  input: TreatmentInput;
};

export async function processVideoTreatment(
  payload: VideoTreatmentPayload
): Promise<void> {
  const { jobId, workspaceId, projectId, input } = payload;
  await markRunning(jobId);

  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId },
    include: { artist: true, briefs: { take: 1, orderBy: { createdAt: "desc" } } },
  });
  if (!project) {
    // The route authorized the project before enqueue; if it vanished, say so
    // plainly as a domain rejection rather than looping the queue on it.
    await markSucceeded(jobId, {
      rejected: true,
      code: "project_not_found",
      note: "The project for this video plan no longer exists.",
    });
    return;
  }

  const song = payload.songId
    ? await prisma.song.findFirst({
        where: { id: payload.songId, projectId: project.id, workspaceId },
        include: {
          lyric: true,
          masters: { orderBy: { createdAt: "desc" }, take: 20 },
          mixes: { orderBy: { createdAt: "desc" }, take: 20 },
          beats: { orderBy: { createdAt: "desc" }, take: 20 },
        },
      })
    : null;
  if (payload.songId && !song) {
    await markSucceeded(jobId, {
      rejected: true,
      code: "song_not_found",
      note: "The song for this video plan no longer exists.",
    });
    return;
  }

  // WHO IS SINGING — recover the vocalist the user picked at creation from the
  // render job input, so the PERFORMER LAW has something to enforce (two-pass:
  // exact-song jobs first, project-level no-songId jobs only as legacy fallback).
  let recoveredVoice: string | null = null;
  let sectionVoicing: Array<{ section: string; voices: string[] }> = [];
  if (song) {
    const renderJobs = await prisma.providerJob.findMany({
      where: { workspaceId, projectId: project.id, kind: "music" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { inputJson: true },
    });
    const readJob = (inputJson: unknown) => {
      const row = inputJson as {
        songId?: unknown;
        voice?: unknown;
        sectionVoicing?: unknown;
      } | null;
      return {
        songId: typeof row?.songId === "string" ? row.songId : null,
        voice: typeof row?.voice === "string" ? row.voice : null,
        voicing: Array.isArray(row?.sectionVoicing)
          ? (row!.sectionVoicing as Array<{ section?: unknown; voices?: unknown }>)
              .map(entry => ({
                section: typeof entry?.section === "string" ? entry.section : "",
                voices: Array.isArray(entry?.voices)
                  ? entry.voices.filter((v): v is string => typeof v === "string")
                  : [],
              }))
              .filter(entry => entry.section && entry.voices.length)
          : [],
      };
    };
    const jobs = renderJobs.map(job => readJob(job.inputJson));
    for (const pass of [
      jobs.filter(job => job.songId === song.id),
      jobs.filter(job => !job.songId),
    ]) {
      for (const job of pass) {
        if (!recoveredVoice && job.voice && job.voice !== "auto") {
          recoveredVoice = job.voice;
        }
        if (!sectionVoicing.length && job.voicing.length) {
          sectionVoicing = job.voicing;
        }
        if (recoveredVoice && sectionVoicing.length) break;
      }
      if (recoveredVoice) break;
    }
  }
  const vocalist: string =
    recoveredVoice ?? "unknown — infer from the lyrics' first-person voice";
  const performers = performersFromVoice(recoveredVoice);

  const songPayload = song
    ? {
        title: song.title,
        genre: project.genre,
        bpm: project.bpm,
        vocalist,
        performers,
        lyrics: song.lyric?.cleanVersion ?? song.lyric?.body ?? null,
        madeAt: song.createdAt.toISOString(),
      }
    : undefined;

  // THE SONG'S MEASURED STRUCTURE IS THE SPINE — the current audio's arrangement
  // decides the sequences; the model only fills them. No measurement = an honest
  // 3-act arc marked structureSource:'assumed'.
  let sections: TreatmentSection[] = [];
  let structureSource: "measured" | "assumed" = "assumed";
  let songDurationS: number | null = null;
  if (song) {
    const history = playableAssetHistory(song);
    const current = currentPlayableAsset(song);
    const arrangement = current ? playableArrangement(history, current) : null;
    if (arrangement) {
      songDurationS = arrangement.durationS;
      if (arrangement.boundaries.length) {
        sections = treatmentSectionsFromBoundaries(
          arrangement.durationS,
          arrangement.boundaries
        );
        structureSource = "measured";
      }
    }
  }
  const targetDurationS = songDurationS ?? input.durationS ?? 180;
  if (!sections.length) {
    sections = assumedThreeActSections(targetDurationS);
    structureSource = "assumed";
  }

  // VOCAL-SYNC input: map arranger-declared section voicing onto the MEASURED
  // sections by label — who SINGS a passage decides who is ON SCREEN in it.
  const voicingPool = [...sectionVoicing];
  const sectionsForBrain = sections.map(section => {
    const matchIndex = voicingPool.findIndex(
      entry =>
        entry.section.trim().toLowerCase() === section.label.trim().toLowerCase()
    );
    if (matchIndex < 0) return section;
    const [match] = voicingPool.splice(matchIndex, 1);
    const voices = new Set(match!.voices.map(voice => voice.toLowerCase()));
    const vocal =
      voices.size > 1
        ? "both"
        : voices.has("female")
          ? "female"
          : voices.has("male")
            ? "male"
            : "ensemble";
    return { ...section, vocal };
  });

  const result = await generateJson<Record<string, unknown>>({
    task: "video-treatment",
    system: prompts.VIDEO_TREATMENT_SYSTEM + "\n\n" + prompts.SCENE_GRAMMAR,
    user: JSON.stringify({
      artist: {
        stageName: project.artist.stageName,
        lane: project.artist.laneSummary,
      },
      brief: project.briefs[0] ?? {},
      song: songPayload,
      structure: {
        source: structureSource,
        durationS: targetDurationS,
        sections: sectionsForBrain,
      },
      format: input.format,
      teaser: { allowedDurations: [15, 30], format: "vertical" },
      extraPrompt: input.prompt,
      ...(input.vision?.trim()
        ? { artistVision: { text: input.vision.trim(), mode: input.visionMode } }
        : {}),
    }),
    temperature: 0.7,
    maxTokens: 6_000,
    timeoutMs: 120_000,
  });

  const treatment = normalizeVideoTreatment(result, {
    durationS: targetDurationS,
    sections,
    structureSource,
  });
  if (!treatment) {
    await markSucceeded(jobId, {
      rejected: true,
      code: "invalid_storyboard_output",
      note: "The treatment came back unusable — try writing the plan again.",
    });
    return;
  }
  // DUET GATE — a duet plan that forgot a lead is REJECTED before it can ever
  // spend a render credit. Code mirrors the prompt law.
  const missingLeads = missingDuetLeads(performers, treatment);
  if (missingLeads.length) {
    await markSucceeded(jobId, {
      rejected: true,
      code: "invalid_storyboard_output",
      note: `performer law failed — missing lead(s): ${missingLeads.join(", ")}. Regenerate the plan.`,
    });
    return;
  }

  // THE DIRECTOR'S ROOM — a second brain reviews against a fixed rubric before
  // render money exists. Anti-assumption tripwire: a review that can't quote the
  // lyrics it grounded in is discarded. One minimal repair round max; the repair
  // re-passes the same normalize + duet gates. Best-effort — critic trouble
  // never blocks the artist; the original plan stands.
  let finalTreatment = treatment;
  let finalResult: Record<string, unknown> = result;
  let criticReport: Record<string, unknown> | null = null;
  try {
    const lyricsText = songPayload?.lyrics ?? "";
    if (lyricsText) {
      const review = await generateJson<{
        lyricsRead?: string;
        scores?: Record<string, number>;
        verdict?: string;
        fixes?: string[];
      }>({
        task: "video-treatment-critic",
        system: prompts.TREATMENT_CRITIC_SYSTEM,
        user: JSON.stringify({ lyrics: lyricsText, performers, treatment: finalResult }),
        temperature: 0.2,
        maxTokens: 1_200,
        timeoutMs: 60_000,
      });
      const quoted = (review.lyricsRead ?? "").trim();
      const grounded =
        quoted.length > 10 &&
        !/i assume/i.test(quoted) &&
        quoted
          .split(/\n|\|/)
          .some(line => line.trim() && lyricsText.includes(line.trim().slice(0, 24)));
      if (grounded) {
        criticReport = {
          lyricsRead: quoted.slice(0, 500),
          scores: review.scores ?? {},
          verdict: review.verdict === "revise" ? "revise" : "pass",
          fixes: (review.fixes ?? []).slice(0, 8),
        };
        if (
          criticReport.verdict === "revise" &&
          (criticReport.fixes as string[]).length
        ) {
          const repaired = await generateJson<Record<string, unknown>>({
            task: "video-treatment-repair",
            system: prompts.TREATMENT_REPAIR_SYSTEM,
            user: JSON.stringify({ original: finalResult, fixes: criticReport.fixes }),
            temperature: 0.3,
            maxTokens: 6_000,
            timeoutMs: 120_000,
          });
          const repairedTreatment = normalizeVideoTreatment(repaired, {
            durationS: targetDurationS,
            sections,
            structureSource,
          });
          if (
            repairedTreatment &&
            !missingDuetLeads(performers, repairedTreatment).length
          ) {
            finalTreatment = repairedTreatment;
            finalResult = repaired;
            criticReport.repaired = true;
          } else {
            criticReport.repairFailed = true; // honest: original stands
          }
        }
      }
    }
  } catch (criticError) {
    console.warn(
      "[video-treatment] critic skipped — the original plan stands:",
      (criticError as Error)?.message
    );
  }

  const title =
    typeof finalResult.title === "string" && (finalResult.title as string).trim()
      ? (finalResult.title as string).trim().slice(0, 200)
      : finalTreatment.concept.slice(0, 200);
  const concept = await prisma.videoConcept.create({
    data: {
      projectId: project.id,
      songId: song?.id ?? null,
      title,
      storyboard: finalTreatment as never,
      durationS: finalTreatment.durationS,
      format: input.format,
      meta: { performers, ...(criticReport ? { criticReport } : {}) } as never,
    },
  });

  await markSucceeded(jobId, {
    conceptId: concept.id,
    songId: song?.id ?? null,
    title,
    structureSource,
    repaired: criticReport?.repaired === true,
  });
}
