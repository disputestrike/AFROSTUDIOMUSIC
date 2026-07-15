#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = join(repo, "scripts", "benchmark-corpus.mjs");
const directory = await mkdtemp(join(tmpdir(), "afrohit-benchmark-"));

function wav(seed) {
  const sampleRate = 8_000;
  const samples = 800;
  const dataBytes = samples * 2;
  const output = Buffer.alloc(44 + dataBytes);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write("WAVE", 8);
  output.write("fmt ", 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples; index += 1) {
    output.writeInt16LE(
      ((index * (seed + 3)) % 10_000) - 5_000,
      44 + index * 2
    );
  }
  return output;
}

try {
  const genres = [
    "afrobeats",
    "amapiano",
    "afro_fusion",
    "highlife",
    "afro_house",
  ];
  const entries = [];
  for (let index = 0; index < 10; index += 1) {
    const bytes = wav(index);
    const file = "reference-" + index + ".wav";
    await writeFile(join(directory, file), bytes);
    entries.push({
      id: "reference-" + index,
      songId: "cbenchmark-song-" + index,
      genre: genres[index % genres.length],
      file,
      format: "wav",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      rights: {
        confirmed: true,
        basis: "licensed_evaluation",
        note: "Licensed for controlled benchmark evaluation.",
        attestedBy: "Automated corpus test",
        attestedAt: "2026-07-14T12:00:00.000Z",
      },
    });
  }
  const manifest = {
    schemaVersion: 1,
    competitor: "suno",
    protocol: {
      version: 1,
      blind: true,
      identityMetadataRemoved: true,
      loudnessMatched: true,
      durationMatched: true,
      independentJudgesMin: 3,
      note: "Controlled, identity-blind, loudness- and duration-matched listening.",
    },
    entries,
  };
  const manifestPath = join(directory, "manifest.json");
  const reportPath = join(directory, "report.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const passed = spawnSync(
    process.execPath,
    [
      cli,
      "--manifest",
      manifestPath,
      "--validate-only",
      "--output",
      reportPath,
    ],
    { cwd: repo, encoding: "utf8" }
  );
  assert.equal(
    passed.status,
    0,
    "valid corpus failed: " + passed.stdout + passed.stderr
  );
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.mode, "validate-only");
  assert.equal(report.corpus.entries, 10);
  assert.equal(report.corpus.genres.length, 5);
  assert.match(report.evidenceHash, /^[a-f0-9]{64}$/);

  const duplicate = structuredClone(manifest);
  duplicate.entries[1].file = duplicate.entries[0].file;
  duplicate.entries[1].sha256 = duplicate.entries[0].sha256;
  const duplicatePath = join(directory, "duplicate.json");
  await writeFile(duplicatePath, JSON.stringify(duplicate));
  const rejected = spawnSync(
    process.execPath,
    [cli, "--manifest", duplicatePath, "--validate-only"],
    { cwd: repo, encoding: "utf8" }
  );
  assert.notEqual(rejected.status, 0, "duplicate audio was accepted");

  console.log("benchmark corpus CLI tests passed");
} finally {
  await rm(directory, { recursive: true, force: true });
}
