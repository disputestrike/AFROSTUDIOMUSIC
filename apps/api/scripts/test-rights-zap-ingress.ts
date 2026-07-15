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
  type LearnedPromptReference,
} from "../src/lib/learned";
import uploads from "../src/routes/uploads";
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
  assert.match(
    ownEngineSource,
    /missingExactRequestedMaterialRoles\(\s*picks,\s*requestedRoles\s*\)/,
  );
  assert.match(ownEngineSource, /exact requested material unavailable/);
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
      measured: {
        engineOk: true,
        tempoBpm: { value: 118 },
        swingRatio: { value: 0.61 },
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
  await assertRequestedRoleWiring();
  await assertZapPromptSafety();
  await assertCrossTenantSongRejectedBeforeNetwork();
  console.log("rights, Zap, import ownership, and requested-role tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
