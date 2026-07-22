import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { prisma } from "@afrohit/db";
import {
  OWNED_AUDIO_RIGHTS_CONFIRMATION_VERSION,
  REQUESTED_MATERIAL_ROLES_VERSION,
  analyzeAudioSchema,
  attachBeatUploadSchema,
  attachSongUploadSchema,
  generateBeatInputSchema,
  importUrlSchema,
  missingExactRequestedMaterialRoles,
  requestedMaterialRoleContract,
  type MaterialRole,
} from "../../../packages/shared/src/schemas";
import { GENRES } from "../../../packages/shared/src/constants";
import { ownedRightsEvidence } from "../src/lib/harvest";
import {
  learnedReferenceBrief,
  learnedReferenceLines,
  learnedUsage,
  PinnedLearnedReferenceUnavailableError,
  type LearnedPromptReference,
} from "../src/lib/learned";
import uploads from "../src/routes/uploads";
import {
  resolveOwnEngineRouting,
  unsupportedOwnEngineControls,
} from "../src/routes/beats";
import { identitySafeZapFacts } from "../src/routes/zap";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const projectId = "clz000000000000000000001";
const songId = "clz000000000000000000002";
const workspaceId = "clz000000000000000000003";
const rightsConfirmation = {
  version: OWNED_AUDIO_RIGHTS_CONFIRMATION_VERSION,
  confirmed: true as const,
};

function assertRightsContracts(): void {
  const beat = { key: "owned/beat.wav", rightsConfirmation };
  const song = { key: "owned/song.wav", rightsConfirmation };
  const imported = {
    projectId,
    url: "https://cdn.example.test/owned.wav",
    kind: "song" as const,
    rightsConfirmation,
  };

  assert.equal(attachBeatUploadSchema.safeParse(beat).success, true);
  assert.equal(attachSongUploadSchema.safeParse(song).success, true);
  assert.equal(importUrlSchema.safeParse(imported).success, true);
  assert.equal(
    attachBeatUploadSchema.safeParse({ key: beat.key }).success,
    false,
    "owned beat ingress must require the attestation",
  );
  assert.equal(
    importUrlSchema.safeParse({ ...imported, rightsConfirmation: undefined }).success,
    false,
    "URL import must require the attestation",
  );
  assert.equal(
    importUrlSchema.safeParse({
      ...imported,
      rightsConfirmation: { version: 2, confirmed: true },
    }).success,
    false,
    "unknown attestation versions must fail closed",
  );
  assert.equal(
    importUrlSchema.safeParse({ ...imported, rightsBasis: "licensed" }).success,
    false,
    "clients cannot submit rightsBasis",
  );
  assert.equal(
    analyzeAudioSchema.safeParse({
      url: imported.url,
      factsOnly: true,
    }).success,
    true,
    "facts-only analysis remains available without an ownership claim",
  );
  assert.equal(
    analyzeAudioSchema.safeParse({
      url: imported.url,
      factsOnly: false,
    }).success,
    false,
    "full learning requires the ownership attestation",
  );
  assert.equal(
    analyzeAudioSchema.safeParse({
      url: imported.url,
      factsOnly: true,
      rightsBasis: "user-attested",
    }).success,
    false,
    "facts-only callers cannot forge a rights basis either",
  );

  assert.deepEqual(
    ownedRightsEvidence({
      ...rightsConfirmation,
      rightsBasis: "licensed",
    } as never),
    {
      schemaVersion: OWNED_AUDIO_RIGHTS_CONFIRMATION_VERSION,
      confirmed: true,
      rightsBasis: "user-attested",
    },
    "the API derives rightsBasis instead of trusting client-shaped input",
  );
}

function assertRequestedRoleContracts(): void {
  const contract = requestedMaterialRoleContract([
    "Piano",
    "highlife guitar",
    "guitar",
    "steel pan",
    "piano",
  ]);
  assert.deepEqual(contract.requestedRoles, [
    "piano",
    "highlife_guitar",
    "guitar_chords",
  ]);
  assert.deepEqual(contract.unsupportedInstruments, ["steel pan"]);
  assert.equal(contract.provenance.version, REQUESTED_MATERIAL_ROLES_VERSION);
  assert.equal(contract.provenance.source, "user-instrument-selection");

  const parsed = generateBeatInputSchema.parse({
    projectId,
    genre: "highlife",
    bpm: 112,
    instruments: ["piano"],
    requestedRoles: ["guitar_chords"],
    requestedRoleProvenance: { version: 999 },
  });
  assert.equal("requestedRoles" in parsed, false);
  assert.equal("requestedRoleProvenance" in parsed, false);

  const requested = ["piano", "highlife_guitar"] as MaterialRole[];
  assert.deepEqual(
    missingExactRequestedMaterialRoles(
      [
        { role: "piano", roleEvidence: "provider-prompted-dsp-consistent" },
        { role: "chords", roleEvidence: "stem-separated" },
      ],
      requested,
    ),
    requested,
    "family evidence and generic chords cannot satisfy exact piano/guitar asks",
  );
  assert.deepEqual(
    missingExactRequestedMaterialRoles(
      [
        { role: "piano", roleEvidence: "synth-code" },
        { role: "highlife_guitar", roleEvidence: "human-confirmed" },
      ],
      requested,
    ),
    [],
  );
}

function assertOwnEngineRoutingIsLossless(): void {
  const unsupportedCases: Array<{
    input: Parameters<typeof resolveOwnEngineRouting>[0];
    trainingReferenceCount?: number;
    expected: string;
  }> = [
    // mood / influence / vibePrompt / durationS are HONORED by the own engine
    // since reference-steering (2026-07-21) — they are no longer unsupported.
    // Only the controls the own worker genuinely cannot honor remain here.
    { input: { fusionGenres: ["amapiano"], withStems: false }, expected: "fusionGenres" },
    { input: { keySignature: "F# minor", withStems: false }, expected: "keySignature" },
    { input: { pinnedReferenceId: "old-pin", withStems: false }, expected: "pinnedReferenceId" },
    { input: { withStems: false }, trainingReferenceCount: 1, expected: "trainingReferences" },
  ];

  // The now-honored controls must NOT block auto-routing to the own engine.
  for (const honored of [
    { mood: "joyful", withStems: false },
    { influence: "live highlife pocket", withStems: false },
    { vibePrompt: "dry live room", withStems: false },
  ]) {
    assert.equal(
      resolveOwnEngineRouting(honored, 0).mode,
      "auto-candidate",
      `honored control ${Object.keys(honored)[0]} must stay auto-routable to the own engine`,
    );
  }

  for (const testCase of unsupportedCases) {
    const automatic = resolveOwnEngineRouting(
      testCase.input,
      testCase.trainingReferenceCount ?? 0,
    );
    assert.equal(
      automatic.mode,
      "provider",
      `automatic routing must keep ${testCase.expected} on a capable provider`,
    );
    assert.ok(automatic.unsupportedControls.includes(testCase.expected));

    const explicit = resolveOwnEngineRouting(
      { ...testCase.input, songEngine: "own" },
      testCase.trainingReferenceCount ?? 0,
    );
    // Owner directive (2026-07-19): Our Engine is the default and must ALWAYS
    // render when explicitly chosen — it IGNORES controls it can't honor yet
    // (still reported in unsupportedControls) instead of rejecting the job.
    assert.equal(
      explicit.mode,
      "own",
      `explicit Our Engine must render (never reject) despite ${testCase.expected}`,
    );
    assert.ok(explicit.unsupportedControls.includes(testCase.expected));
  }

  assert.deepEqual(
    resolveOwnEngineRouting({ songEngine: "own", withStems: false }),
    { mode: "own", unsupportedControls: [] },
  );
  assert.deepEqual(
    resolveOwnEngineRouting({ withStems: false }),
    { mode: "auto-candidate", unsupportedControls: [] },
  );
  assert.deepEqual(
    unsupportedOwnEngineControls({ withStems: true, durationS: 90, candidates: 3 }),
    [],
    "native stems, duration, and controlled candidates must stay on AfroOne",
  );
  assert.equal(
    resolveOwnEngineRouting({ songEngine: "minimax", withStems: false }).mode,
    "provider",
  );
}

async function assertPinnedReferenceEscapesRecentWindow(): Promise<void> {
  type FindMany = (args: unknown) => Promise<unknown[]>;
  type FindFirst = (args: unknown) => Promise<unknown | null>;
  const delegate = prisma.soundReference as unknown as {
    findMany: FindMany;
    findFirst: FindFirst;
  };
  const originalFindMany = delegate.findMany;
  const originalFindFirst = delegate.findFirst;
  const pinned: LearnedPromptReference = {
    id: "old-pin",
    title: "Old owned reference",
    summary: "Pinned sound",
    genre: "highlife",
    sourceUrl: "owned:old-pin.wav",
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
    recipe: { source: "upload", drums: "live pocket" },
    generated: false,
    zap: false,
  };
  const recent: LearnedPromptReference[] = Array.from({ length: 60 }, (_, index) => ({
    id: `recent-${index}`,
    title: `Recent ${index}`,
    summary: null,
    genre: "highlife",
    sourceUrl: `owned:recent-${index}.wav`,
    createdAt: new Date(1_800_000_000_000 - index * 1_000),
    recipe: { source: "upload", drums: "recent pocket" },
    generated: false,
    zap: false,
  }));
  let capturedPinQuery: unknown;

  delegate.findMany = async () => recent;
  delegate.findFirst = async (args) => {
    capturedPinQuery = args;
    return pinned;
  };

  try {
    const usage = await learnedUsage(workspaceId, "highlife", pinned.id);
    assert.equal(
      usage.referenceIds[0],
      pinned.id,
      "an eligible old pin must lead even when it is outside the newest-60 window",
    );
    assert.equal(
      usage.referenceIds.filter((id) => id === pinned.id).length,
      1,
      "the separately fetched pin must be deduplicated",
    );
    const where = (capturedPinQuery as {
      where?: {
        id?: string;
        workspaceId?: string;
        active?: boolean;
        analysisState?: { not?: string };
      };
    }).where;
    assert.deepEqual(
      {
        id: where?.id,
        workspaceId: where?.workspaceId,
        active: where?.active,
        analysisState: where?.analysisState,
      },
      {
        id: pinned.id,
        workspaceId,
        active: true,
        analysisState: { not: "failed" },
      },
      "the direct pin lookup must retain tenant and eligibility filters",
    );

    delegate.findMany = async () => [pinned, ...recent.slice(0, 59)];
    const deduped = await learnedUsage(workspaceId, "highlife", pinned.id);
    assert.equal(deduped.referenceIds.filter((id) => id === pinned.id).length, 1);

    delegate.findFirst = async () => null;
    await assert.rejects(
      () => learnedReferenceBrief(workspaceId, "highlife", pinned.id),
      (error: unknown) => {
        assert.ok(error instanceof PinnedLearnedReferenceUnavailableError);
        assert.equal(error.referenceId, pinned.id);
        assert.equal(error.code, "pinned_reference_unavailable");
        return true;
      },
      "an unavailable explicit pin must fail instead of silently substituting recent rows",
    );
  } finally {
    delegate.findMany = originalFindMany;
    delegate.findFirst = originalFindFirst;
  }
}

async function assertRequestedRoleWiring(): Promise<void> {
  const [beatsSource, chatSource, ownEngineSource] = await Promise.all([
    readFile(resolve(repoRoot, "apps/api/src/routes/beats.ts"), "utf8"),
    readFile(resolve(repoRoot, "apps/api/src/services/chat-tools.ts"), "utf8"),
    readFile(
      resolve(repoRoot, "apps/worker/src/processors/own-engine.ts"),
      "utf8",
    ),
  ]);
  for (const source of [beatsSource, chatSource]) {
    assert.match(source, /requestedMaterialRoleContract\(/);
    assert.match(source, /requestedRoles:\s*roleRequest\.requestedRoles/);
    assert.match(
      source,
      /requestedRoleProvenance:\s*roleRequest\.provenance/,
    );
  }
  // AfroOne vocals share one capability-gated contract across REST and Chat.
  // They sing or fail before charge; they never silently become a bed-only job.
  for (const source of [chatSource, beatsSource]) {
    assert.doesNotMatch(source, /error:\s*["']own_vocal_pipeline_unavailable["']/);
    assert.match(source, /withVocals:\s*(?:input|a)\.withVocals|withVocals:\s*true/);
    assert.match(source, /lyrics/);
  }
  assert.match(chatSource, /afroone_lyrics_required/);
  assert.match(chatSource, /trainingUsage:\s*ownTrainingUsage/);
  assert.match(ownEngineSource, /processAfroOneSinging\(/);
  assert.match(
    ownEngineSource,
    /missingExactRequestedMaterialRoles\(\s*picks,\s*requestedRoles\s*\)/,
  );
  const generateSource = beatsSource.slice(beatsSource.indexOf("'/generate'"));
  const routingGuardIndex = generateSource.indexOf("const ownRouting = resolveOwnEngineRouting");
  const chargeIndex = generateSource.indexOf("const charge = await app.chargeCredits");
  const ownJobIndex = generateSource.indexOf("jobName: 'own-engine'");
  assert.ok(routingGuardIndex >= 0);
  assert.ok(
    routingGuardIndex < chargeIndex && routingGuardIndex < ownJobIndex,
    "owned-engine semantic validation must run before charging or creating a job",
  );
  assert.match(ownEngineSource, /requested role\(s\) unavailable, rendered without/);
  assert.match(ownEngineSource, /requestedRoleReceipts/);
}

async function assertZapPromptSafety(): Promise<void> {
  const facts = identitySafeZapFacts("Highlife");
  assert.ok(facts);
  assert.equal(facts.genre, "highlife");
  assert.equal(facts.identitySafe, true);
  const firstGlobalGenre = GENRES.indexOf("pop");
  for (const genre of GENRES.slice(0, firstGlobalGenre)) {
    assert.equal(
      identitySafeZapFacts(genre)?.genre,
      genre,
      `${genre} must normalize through the shared African genre set`,
    );
  }

  const zapRef: LearnedPromptReference = {
    id: "zap-reference",
    title: "SECRET SONG TITLE",
    summary: "SECRET ARTIST summary",
    genre: "highlife",
    sourceUrl: "zap:secret-artist-secret-song",
    createdAt: new Date("2026-07-15T00:00:00.000Z"),
    generated: false,
    zap: true,
    recipe: {
      source: "zap",
      title: "SECRET SONG TITLE",
      artist: "SECRET ARTIST",
      drums: "COPY THIS IDENTITY-SPECIFIC DRUM DESCRIPTION",
      learnedRecipe: "COPY THE RECORD",
      // THE HONESTY LAW (learned.ts measuredValue): only source:'measured'
      // may speak as measured — absent provenance is not evidence. This
      // fixture predated that hardening and carried bare {value} wrappers,
      // which the law now (correctly) refuses to print as measurements; the
      // fixture represents a genuinely DSP-measured zap ref, so it must SAY so.
      measured: {
        engineOk: true,
        tempoBpm: { value: 118, source: "measured" },
        swingRatio: { value: 0.61, source: "measured" },
      },
    },
  };
  const line = learnedReferenceLines([zapRef]).join("\n");
  assert.match(line, /118 bpm \(measured\)/);
  assert.match(line, /identity removed/);
  assert.doesNotMatch(line, /SECRET|COPY THIS|COPY THE RECORD/i);
  const laneLessLine = learnedReferenceLines([
    { ...zapRef, genre: null },
  ]).join("\n");
  assert.match(laneLessLine, /118 bpm \(measured\)/);
  assert.match(laneLessLine, /lane unresolved/);
  assert.doesNotMatch(laneLessLine, /afrobeats|SECRET|COPY/i);

  type FindMany = (args: unknown) => Promise<unknown[]>;
  const delegate = prisma.soundReference as unknown as { findMany: FindMany };
  const originalFindMany = delegate.findMany;
  let capturedQuery: unknown;
  delegate.findMany = async (args) => {
    capturedQuery = args;
    return [zapRef];
  };
  try {
    const brief = await learnedReferenceBrief(workspaceId, "highlife");
    assert.match(brief, /ZAP highlife FACTS/);
    assert.doesNotMatch(brief, /SECRET|COPY THIS|COPY THE RECORD/i);
    const where = (capturedQuery as {
      where?: { OR?: Array<{ rightsBasis?: string; sourceUrl?: { startsWith?: string } }> };
    }).where;
    assert.ok(
      where?.OR?.some(
        (entry) => entry.rightsBasis === "facts-only"
          && entry.sourceUrl?.startsWith === "zap:",
      ),
      "automatic learned-reference retrieval must include facts-only Zap rows",
    );
  } finally {
    delegate.findMany = originalFindMany;
  }

  const zapSource = await readFile(
    resolve(repoRoot, "apps/api/src/routes/zap.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    zapSource,
    /extractSongCraft/,
    "Zap identity must never be sent to the provider craft extractor",
  );
  const learnUi = await readFile(
    resolve(repoRoot, "apps/web/components/LearnMySound.tsx"),
    "utf8",
  );
  assert.match(learnUi, /rightsConfirmation\s*:\s*\{/);
  assert.match(learnUi, /OWNED_AUDIO_RIGHTS_CONFIRMATION_VERSION/);
}

async function assertCrossTenantSongRejectedBeforeNetwork(): Promise<void> {
  type Delegate = (args: unknown) => Promise<unknown>;
  const projectDelegate = prisma.project as unknown as {
    findFirstOrThrow: Delegate;
  };
  const songDelegate = prisma.song as unknown as { findFirst: Delegate };
  const originalProjectLookup = projectDelegate.findFirstOrThrow;
  const originalSongLookup = songDelegate.findFirst;
  let capturedSongWhere: unknown;
  projectDelegate.findFirstOrThrow = async (args) => {
    assert.deepEqual((args as { where: unknown }).where, {
      id: projectId,
      workspaceId,
    });
    return { id: projectId, title: "Owned project", genre: "highlife" };
  };
  songDelegate.findFirst = async (args) => {
    capturedSongWhere = (args as { where: unknown }).where;
    return null;
  };

  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("auth", undefined);
  app.addHook("onRequest", async (req) => {
    req.auth = {
      userId: "test-user",
      workspaceId,
      role: "OWNER",
      isService: false,
    };
  });

  try {
    await app.register(uploads);
    const response = await app.inject({
      method: "POST",
      url: "/import",
      payload: {
        projectId,
        songId,
        url: "http://127.0.0.1/should-never-be-resolved.wav",
        kind: "beat",
        rightsConfirmation,
      },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().message, "song_not_found");
    assert.deepEqual(capturedSongWhere, {
      id: songId,
      workspaceId,
      projectId,
    });
  } finally {
    projectDelegate.findFirstOrThrow = originalProjectLookup;
    songDelegate.findFirst = originalSongLookup;
    await app.close();
  }
}

async function main(): Promise<void> {
  assertRightsContracts();
  assertRequestedRoleContracts();
  assertOwnEngineRoutingIsLossless();
  await assertPinnedReferenceEscapesRecentWindow();
  await assertRequestedRoleWiring();
  await assertZapPromptSafety();
  await assertCrossTenantSongRejectedBeforeNetwork();
  console.log("rights, Zap, import ownership, and requested-role tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
