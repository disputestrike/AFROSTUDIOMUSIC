import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import {
  assertCertifiableAudioQuality,
  assertStoredContentHash,
  sha256Bytes,
} from "../src/lib/certified-assets";
import {
  audioQualityFromFfmpegCapture,
  ffmpegAvailable,
  probeDurationS,
  runFfmpeg,
  type AudioQuality,
  type FfmpegCaptureResult,
} from "../src/lib/ffmpeg";
import { verifyReleaseArchive } from "../src/processors/export";

const measuredStderr = [
  "Summary:",
  "  I: -14.0 LUFS",
  "  LRA: 6.0 LU",
  "  Peak: -1.0 dBFS",
  "Overall",
  "Peak level dB: -1.0",
  "RMS level dB: -10.0",
  "Flat factor: 0.0",
].join("\n");

function capture(
  overrides: Partial<FfmpegCaptureResult> = {}
): FfmpegCaptureResult {
  return {
    stderr: measuredStderr,
    exitCode: 0,
    failure: null,
    ...overrides,
  };
}

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function buildArchive(options: {
  storedContent: Buffer;
  manifestBytes: Buffer;
  checksumsText: string;
  extraFile?: boolean;
}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("audio/test.mp3", options.storedContent, { createFolders: false });
  zip.file("manifest.json", options.manifestBytes, { createFolders: false });
  zip.file("checksums.sha256", options.checksumsText, { createFolders: false });
  if (options.extraFile)
    zip.file("unexpected.txt", "nope", { createFolders: false });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function main(): Promise<void> {
  const measured = audioQualityFromFfmpegCapture(120, capture());
  assert.equal(measured.verdict, "pass");
  assert.doesNotThrow(() => assertCertifiableAudioQuality(measured));

  for (const failedCapture of [
    capture({ exitCode: 1 }),
    capture({ failure: "timeout" }),
    capture({ failure: "output_limit" }),
    capture({ stderr: "" }),
  ]) {
    const quality = audioQualityFromFfmpegCapture(120, failedCapture);
    assert.equal(
      quality.verdict,
      "weak",
      "unmeasured long audio must remain non-green without hard-failing creative use"
    );
    assert.deepEqual(quality.flags, ["unmeasured"]);
    assert.throws(
      () => assertCertifiableAudioQuality(quality),
      /missing finite decoded metrics/,
      "unmeasured audio cannot be certified"
    );
  }

  const nonFinite = { ...measured, truePeakDb: Number.NaN } as AudioQuality;
  assert.throws(() => assertCertifiableAudioQuality(nonFinite), /truePeakDb/);
  const finiteWeak = { ...measured, verdict: "weak", ok: true } as AudioQuality;
  assert.throws(
    () => assertCertifiableAudioQuality(finiteWeak),
    /audio_qc_failed/
  );
  const flatNativeStem = {
    ...measured,
    verdict: "weak",
    ok: true,
    flags: ["flat"],
  } as AudioQuality;
  assert.throws(
    () => assertCertifiableAudioQuality(flatNativeStem),
    /audio_qc_failed/,
    "finished-program certification must remain strict"
  );
  assert.doesNotThrow(
    () => assertCertifiableAudioQuality(flatNativeStem, "stem", "native_stem"),
    "a repetitive isolated bus may be low-dynamic-range without being broken"
  );
  for (const flags of [["too_quiet"], ["clipping"], ["short"], ["unmeasured"]]) {
    const brokenStem = { ...measured, verdict: "fail", ok: false, flags } as AudioQuality;
    assert.throws(
      () => assertCertifiableAudioQuality(brokenStem, "stem", "native_stem"),
      /audio_qc_failed/,
      `native stem certification must reject ${flags[0]}`
    );
  }

  const original = Buffer.from("certified-audio-bytes");
  const originalHash = sha256Bytes(original);
  assert.equal(
    assertStoredContentHash(original, originalHash, "fixture"),
    originalHash
  );
  const mutated = Buffer.from(original);
  mutated[0] = mutated[0]! ^ 0xff;
  assert.throws(
    () => assertStoredContentHash(mutated, originalHash, "fixture"),
    /fixture_content_hash_mismatch/
  );
  assert.throws(
    () => assertStoredContentHash(original, "short", "fixture"),
    /content_hash_invalid/
  );

  const archiveContent = Buffer.from("release-audio-payload");
  const sourceFingerprint = "a".repeat(64);
  const manifest = {
    schemaVersion: 1,
    sourceFingerprint,
    files: [
      {
        path: "audio/test.mp3",
        sizeBytes: archiveContent.byteLength,
        sha256: hash(archiveContent),
      },
    ],
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest) + "\n");
  const checksumsText = [
    `${hash(archiveContent)}  audio/test.mp3`,
    `${hash(manifestBytes)}  manifest.json`,
    "",
  ].join("\n");
  const validArchive = await buildArchive({
    storedContent: archiveContent,
    manifestBytes,
    checksumsText,
  });
  await verifyReleaseArchive(validArchive, {
    expectedContentHash: hash(validArchive),
    expectedSizeBytes: validArchive.byteLength,
    expectedSourceFingerprint: sourceFingerprint,
    expectedManifest: manifest,
    requiredPaths: ["audio/test.mp3"],
  });

  const changedContent = Buffer.from(archiveContent);
  changedContent[0] = changedContent[0]! ^ 0xff;
  await assert.rejects(
    buildArchive({
      storedContent: changedContent,
      manifestBytes,
      checksumsText,
    }).then(bytes =>
      verifyReleaseArchive(bytes, {
        expectedSourceFingerprint: sourceFingerprint,
      })
    ),
    /release_archive_file_hash_mismatch/
  );
  const changedManifestBytes = Buffer.from(
    JSON.stringify({ ...manifest, receiptId: "tampered" }) + "\n"
  );
  await assert.rejects(
    buildArchive({
      storedContent: archiveContent,
      manifestBytes: changedManifestBytes,
      checksumsText,
    }).then(bytes =>
      verifyReleaseArchive(bytes, {
        expectedSourceFingerprint: sourceFingerprint,
      })
    ),
    /release_archive_manifest_hash_mismatch/
  );
  await assert.rejects(
    buildArchive({
      storedContent: archiveContent,
      manifestBytes,
      checksumsText,
      extraFile: true,
    }).then(bytes => verifyReleaseArchive(bytes)),
    /release_archive_file_set_mismatch/
  );

  const invalidDirectory = await mkdtemp(join(tmpdir(), "audio-cert-test-"));
  try {
    const invalidAudio = join(invalidDirectory, "invalid.bin");
    await writeFile(invalidAudio, "not audio");
    assert.equal(
      await probeDurationS(invalidAudio, {
        timeoutMs: 1_000,
        outputLimitBytes: 128,
      }),
      0
    );
  } finally {
    await rm(invalidDirectory, { recursive: true, force: true });
  }

  if (await ffmpegAvailable({ timeoutMs: 5_000 })) {
    const startedAt = Date.now();
    await assert.rejects(
      runFfmpeg(
        ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-f", "null", "-"],
        { timeoutMs: 75, outputLimitBytes: 4_096 }
      ),
      /ffmpeg timeout/
    );
    assert.ok(
      Date.now() - startedAt < 5_000,
      "timed-out ffmpeg must be terminated promptly"
    );
    await assert.rejects(
      runFfmpeg(["-definitely-invalid-option"], {
        timeoutMs: 5_000,
        outputLimitBytes: 8,
      }),
      /ffmpeg output exceeded 8 bytes/
    );
  }

  const ffmpegSource = await readFile("src/lib/ffmpeg.ts", "utf8");
  assert.match(ffmpegSource, /stageFfmpegInput/);
  assert.match(ffmpegSource, /downloadToBuffer\(input/);
  assert.match(
    ffmpegSource,
    /maxBytes:\s*NATIVE_AUDIO_LIMITS\.remoteInputMaxBytes/
  );
  assert.match(
    ffmpegSource,
    /timeoutMs:\s*NATIVE_AUDIO_LIMITS\.remoteInputTimeoutMs/
  );
  assert.doesNotMatch(ffmpegSource, /resolveAssetForProvider/);

  const masterSource = await readFile("src/processors/master.ts", "utf8");
  const rightsSource = await readFile("src/processors/rights.ts", "utf8");
  const exportSource = await readFile("src/processors/export.ts", "utf8");
  assert.match(
    masterSource,
    /assertStoredContentHash\(sourceBytes, mix\.contentHash/
  );
  assert.match(masterSource, /certifiedMp3 = await certifyAudioBytes/);
  assert.match(rightsSource, /probeAudioBufferDurationS\(audioBytes\)/);
  assert.match(
    exportSource,
    /assertCertifiableAudioQuality\(mp3Qc, 'release_mp3'\)/
  );
  assert.match(exportSource, /uploadedArchive = await downloadToBuffer/);

  console.log("audio certification hardening tests passed");
}

void main();
