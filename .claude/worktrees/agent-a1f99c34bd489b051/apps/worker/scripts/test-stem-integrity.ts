import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { separateStems } from '../../../packages/ai/src/stems';
import type { StemAudioOutput } from '../../../packages/ai/src/providers/types';
import {
  enforceMusicStemPersistence,
  resolveMusicStemSources,
  sniffStemAudio,
} from '../src/lib/demucs-local';

const wavStem: StemAudioOutput = {
  role: 'vocals',
  url: 'https://audio.example/vocals.wav',
  format: 'wav',
  contentType: 'audio/wav',
};

async function testProviderMetadata(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalVersion = process.env.REPLICATE_DEMUCS_VERSION;
  const originalOutput = process.env.REPLICATE_DEMUCS_OUTPUT;
  try {
    process.env.REPLICATE_DEMUCS_VERSION = 'demucs_test_version';
    process.env.REPLICATE_DEMUCS_OUTPUT = 'wav';
    globalThis.fetch = (async () =>
      Response.json({
        id: 'prediction_wav',
        status: 'succeeded',
        output: {
          vocals: {
            url: 'https://audio.example/vocals.mp3',
            content_type: 'audio/wav',
          },
          no_vocals: 'https://audio.example/instrumental',
        },
      })) as typeof fetch;

    const wav = await separateStems({
      audioUrl: 'https://audio.example/master.wav',
      apiKey: 'replicate_test',
      mode: 'instrumental',
    });
    assert.deepEqual(
      wav.stems.map((stem) => [stem.role, stem.format, stem.contentType]),
      [
        ['vocals', 'wav', 'audio/wav'],
        ['instrumental', 'wav', 'audio/wav'],
      ],
      'declared/provider-requested WAV metadata must survive result mapping',
    );

    delete process.env.REPLICATE_DEMUCS_OUTPUT;
    globalThis.fetch = (async () =>
      Response.json({
        id: 'prediction_mp3',
        status: 'succeeded',
        output: { vocals: 'https://audio.example/vocals.mp3' },
      })) as typeof fetch;
    const mp3 = await separateStems({
      audioUrl: 'https://audio.example/master.mp3',
      apiKey: 'replicate_test',
      mode: 'full',
    });
    assert.deepEqual(
      mp3.stems[0],
      {
        role: 'vocals',
        url: 'https://audio.example/vocals.mp3',
        format: 'mp3',
        contentType: 'audio/mpeg',
      },
      'MP3 separator output must remain MP3',
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalVersion === undefined) delete process.env.REPLICATE_DEMUCS_VERSION;
    else process.env.REPLICATE_DEMUCS_VERSION = originalVersion;
    if (originalOutput === undefined) delete process.env.REPLICATE_DEMUCS_OUTPUT;
    else process.env.REPLICATE_DEMUCS_OUTPUT = originalOutput;
  }
}

async function testCanonicalFallback(): Promise<void> {
  let separatorCalls = 0;
  const resolved = await resolveMusicStemSources(
    {
      withStems: true,
      canonicalSourceUrl: 's3://private-bucket/workspace/beats/certified.wav',
      workspaceId: 'workspace_test',
    },
    async (options) => {
      separatorCalls += 1;
      assert.equal(options.audioUrl, 's3://private-bucket/workspace/beats/certified.wav');
      assert.equal(options.mode, 'full');
      return { stems: [wavStem], engine: 'local' };
    },
  );
  assert.equal(separatorCalls, 1);
  assert.equal(resolved.source, 'canonical-separation');
  assert.deepEqual(resolved.stems, [wavStem]);

  const provider = await resolveMusicStemSources(
    {
      withStems: true,
      providerStems: [wavStem],
      canonicalSourceUrl: 'unused',
      workspaceId: 'workspace_test',
    },
    async () => {
      throw new Error('provider stems should bypass separation');
    },
  );
  assert.equal(provider.source, 'provider');

  const optional = await resolveMusicStemSources(
    {
      withStems: false,
      canonicalSourceUrl: 'unused',
      workspaceId: 'workspace_test',
    },
    async () => {
      throw new Error('unrequested stems should not run separation');
    },
  );
  assert.deepEqual(optional, { stems: [], source: 'none' });

  await assert.rejects(
    resolveMusicStemSources(
      {
        withStems: true,
        canonicalSourceUrl: 'certified',
        workspaceId: 'workspace_test',
      },
      async () => ({ stems: [] }),
    ),
    /returned no audio/,
    'an empty separation cannot become ordinary success',
  );
  await assert.rejects(
    resolveMusicStemSources(
      {
        withStems: true,
        canonicalSourceUrl: 'certified',
        workspaceId: 'workspace_test',
      },
      async () => {
        throw new Error('separation exploded');
      },
    ),
    /separation exploded/,
    'separation failures must remain failures for managed retry/refund handling',
  );
}

function testSniffingAndPostcondition(): void {
  const riff = Buffer.alloc(16);
  riff.write('RIFF', 0, 'ascii');
  riff.write('WAVE', 8, 'ascii');
  assert.deepEqual(sniffStemAudio(riff), { format: 'wav', contentType: 'audio/wav' });

  const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
  assert.deepEqual(sniffStemAudio(mp3), { format: 'mp3', contentType: 'audio/mpeg' });
  assert.throws(() => sniffStemAudio(Buffer.from('not audio')), /unrecognized container/);

  assert.equal(enforceMusicStemPersistence(true, 4), 4);
  assert.equal(enforceMusicStemPersistence(false, 0), 0);
  assert.throws(
    () => enforceMusicStemPersistence(true, 0),
    /requested stems were not persisted/,
    'withStems=true cannot pass its terminal postcondition with zero rows',
  );
}

function testProcessorWiring(): void {
  const music = readFileSync(join(process.cwd(), 'src/processors/music.ts'), 'utf8');
  const stems = readFileSync(join(process.cwd(), 'src/processors/stems.ts'), 'utf8');
  const ownEngine = readFileSync(join(process.cwd(), 'src/processors/own-engine.ts'), 'utf8');
  const cleanup = readFileSync(join(process.cwd(), 'src/processors/asset-cleanup.ts'), 'utf8');
  const hashAt = music.indexOf('const sourceContentHash');
  const resolveAt = music.indexOf('const stemResolution = await resolveMusicStemSources');
  const transactionAt = music.indexOf('const beat = await prisma.$transaction');
  assert.ok(hashAt >= 0 && hashAt < resolveAt && resolveAt < transactionAt);
  assert.match(music, /canonicalSourceUrl:\s*ingestedMain/);
  assert.match(music, /tx\.stem\.create\([\s\S]*format:\s*stem\.format/);
  assert.match(music, /const persistedStemCount = await prisma\.stem\.count/);
  assert.match(music, /enforceMusicStemPersistence\(p\.input\.withStems, persistedStemCount\)/);
  assert.match(music, /catch \(err\)[\s\S]*await markFailed\(p\.jobId, err\)/);
  assert.match(stems, /materializeStemAudio/);
  assert.match(stems, /format:\s*(?:s|stem)\.format/);

  const melodyMixAt = ownEngine.indexOf('const mixed = await mixBuffers');
  const melodyCertAt = ownEngine.indexOf('const certified = await certifyAudioBytes', melodyMixAt);
  const melodyUpdateAt = ownEngine.indexOf('const updated = await prisma.beatAsset.updateMany', melodyCertAt);
  const melodyPublishAt = ownEngine.indexOf('finalUrl = certified.url', melodyUpdateAt);
  const melodyRetireAt = ownEngine.indexOf('await deleteUnreferencedAssetRefs', melodyPublishAt);
  assert.ok(
    melodyMixAt >= 0 &&
      melodyMixAt < melodyCertAt &&
      melodyCertAt < melodyUpdateAt &&
      melodyUpdateAt < melodyPublishAt &&
      melodyPublishAt < melodyRetireAt,
    'melody bytes must be certified and atomically published before old-object retirement',
  );
  assert.match(ownEngine, /where:\s*\{\s*id:\s*finalBeatId,\s*url:\s*out\.url\s*\}/);
  assert.match(ownEngine, /duration:\s*certified\.qc\.durationS/);
  assert.match(ownEngine, /qualityState:\s*certified\.qualityState/);
  assert.match(ownEngine, /contentHash:\s*certified\.contentHash/);
  assert.match(ownEngine, /verifiedAt:\s*certified\.verifiedAt/);
  assert.doesNotMatch(ownEngine, /measureAudioQuality\(mixedUrl\)/);

  assert.ok([...stems.matchAll(/certifyAudioBytes\(/g)].length >= 3);
  assert.match(stems, /stem separation must return both instrumental and acapella outputs/);
  assert.match(stems, /sourceLineage[\s\S]*instrumentalMeta/);
  assert.match(stems, /project:\s*\{\s*workspaceId:\s*p\.workspaceId\s*\}/);
  assert.doesNotMatch(stems, /await prisma\.stem\.deleteMany/);
  const truePath = stems.slice(stems.indexOf('async function processTrueInstrumental'));
  const trueTransactionAt = truePath.indexOf('await prisma.$transaction([');
  const trueDeleteAt = truePath.indexOf('prisma.stem.deleteMany', trueTransactionAt);
  const songUpdateAt = truePath.indexOf('prisma.song.update', trueDeleteAt);
  const beatReceiptAt = truePath.indexOf('prisma.beatAsset.update', songUpdateAt);
  const trueRetireAt = truePath.indexOf('await retireSupersededAudio', beatReceiptAt);
  assert.ok(
    trueTransactionAt >= 0 &&
      trueTransactionAt < trueDeleteAt &&
      trueDeleteAt < songUpdateAt &&
      songUpdateAt < beatReceiptAt &&
      beatReceiptAt < trueRetireAt,
    'true stems must replace rows and receipts transactionally before old-object retirement',
  );
  assert.match(truePath, /instrumental:\s*\{[\s\S]*wav:\s*audioCertificationReceipt[\s\S]*mp3:\s*audioCertificationReceipt/);
  assert.match(truePath, /acapella:\s*\{[\s\S]*wav:\s*audioCertificationReceipt[\s\S]*mp3:\s*audioCertificationReceipt/);

  const cleanupHelper = cleanup.slice(cleanup.indexOf('export async function deleteUnreferencedAssetRefs'));
  const protectedAt = cleanupHelper.indexOf('const protectedRefs = await protectedAssetRefs');
  const cleanupPlanAt = cleanupHelper.indexOf('const plan = planAssetCleanup', protectedAt);
  const physicalDeleteAt = cleanupHelper.indexOf('await deleteObjectByUrl', cleanupPlanAt);
  assert.ok(protectedAt >= 0 && protectedAt < cleanupPlanAt && cleanupPlanAt < physicalDeleteAt);
  assert.doesNotMatch(cleanup, /\$queryRaw</);
}

async function main(): Promise<void> {
  await testProviderMetadata();
  await testCanonicalFallback();
  testSniffingAndPostcondition();
  testProcessorWiring();
  console.log('stem integrity: format, canonical separation, persistence, and failure contracts passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
