import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeMelody, parseLyricSections } from '@afrohit/shared';
import {
  afroOneSingingJobContract,
  buildAfroOneSungAssetReceipt,
  combineAfroOneSingingCost,
  createAfroOneSingingManifest,
  renderAfroOneSinging,
  type AfroOneSingingManifest,
} from '../../../packages/ai/src/afroone-singing';
import { singVoiceAuthorizationFailure } from '../src/processors/voice-sing';

const lyrics = `[Verse 1]
Hold me tonight
[Hook]
Go go higher`;

function score(seed = 42) {
  return composeMelody({
    genre: 'afrobeats',
    bpm: 100,
    key: 'A minor',
    seed,
    sections: parseLyricSections(lyrics).map((section) => ({
      name: section.name,
      kind: section.kind,
      lines: section.lines,
    })),
  });
}

function manifest(seed = 42): AfroOneSingingManifest {
  return createAfroOneSingingManifest({
    lyrics,
    melodyScore: score(seed),
    genre: 'afrobeats',
    language: 'en',
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function main(): Promise<void> {
  // Deterministic score input: same score + seed + lyric produces byte-stable
  // hashes and a job contract that can be rebound at worker execution time.
  const first = manifest();
  const second = manifest();
  assert.deepEqual(second, first);
  assert.equal(first.seed, 42);
  assert.equal(first.performanceKind, 'sung_vocal');
  assert.ok(first.alignment.length > 0);
  assert.deepEqual(
    afroOneSingingJobContract(first, 'voice-a'),
    afroOneSingingJobContract(second, 'voice-a')
  );
  assert.notEqual(manifest(43).scoreHash, first.scoreHash);

  // The lyric/melody contract is exact. A stale or tampered syllable cannot be
  // rendered against newly approved lyrics.
  const tampered = structuredClone(score());
  tampered.sections[0]!.notes[0]!.syllable = 'Wrong';
  assert.throws(
    () =>
      createAfroOneSingingManifest({
        lyrics,
        melodyScore: tampered,
        genre: 'afrobeats',
      }),
    /afroone_singing_lyric_score_mismatch/
  );

  let disabledFetches = 0;
  await assert.rejects(
    renderAfroOneSinging(first, {
      env: {},
      fetch: (async () => {
        disabledFetches += 1;
        return jsonResponse({});
      }) as typeof fetch,
    }),
    /afroone_singing_disabled/
  );
  assert.equal(disabledFetches, 0, 'disabled engine must spend nothing');

  // The exact-score local engine must echo every input receipt and explicitly
  // identify its output as a sung isolated vocal.
  let localRequest: Record<string, unknown> | null = null;
  const localRender = await renderAfroOneSinging(first, {
    env: {
      AFROONE_SINGING_ENABLED: '1',
      AFROONE_SINGING_ENGINE_ORDER: 'local-score-singer',
      AFROONE_SINGING_LOCAL_URL: 'https://singer.internal/render',
    },
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      localRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({
        performanceKind: 'sung_vocal',
        engine: 'diffsinger-local',
        scoreInputConsumed: true,
        scoreHash: first.scoreHash,
        lyricsHash: first.lyricsHash,
        alignmentHash: first.alignmentHash,
        seed: first.seed,
        audioUrl: 'https://audio.internal/lead.wav',
        outputKind: 'isolated_vocal',
        renderId: 'local-1',
        costUsd: 0.002,
        costFinal: true,
      });
    }) as typeof fetch,
  });
  assert.deepEqual(localRequest, { manifest: first });
  assert.equal(localRender.performanceKind, 'sung_vocal');
  assert.equal(localRender.performanceSource, 'score_synth');
  assert.equal(localRender.outputKind, 'isolated_vocal');
  assert.equal(localRender.exactScoreInput, true);
  assert.equal(localRender.cost.totalUsd, 0.002);
  assert.equal(localRender.cost.estimated, false);

  const receipt = buildAfroOneSungAssetReceipt({
    render: localRender,
    personalizedVoice: false,
  });
  assert.deepEqual(
    {
      assetKind: receipt.assetKind,
      performanceKind: receipt.performanceKind,
      performanceSource: receipt.performanceSource,
      spokenGuideNotSung: receipt.spokenGuideNotSung,
      placeholder: receipt.placeholder,
    },
    {
      assetKind: 'isolated_vocal',
      performanceKind: 'sung_vocal',
      performanceSource: 'score_synth',
      spokenGuideNotSung: false,
      placeholder: false,
    }
  );

  // TTS, speech, guide, stub, and placeholder-labelled engines can never enter
  // the singing receipt even if a backend returns a playable URL.
  for (const engine of ['tts-local', 'speech synth', 'spoken guide', 'stub', 'placeholder']) {
    await assert.rejects(
      renderAfroOneSinging(first, {
        env: {
          AFROONE_SINGING_ENABLED: '1',
          AFROONE_SINGING_ENGINE_ORDER: 'local-score-singer',
          AFROONE_SINGING_LOCAL_URL: 'https://singer.internal/render',
        },
        fetch: (async () =>
          jsonResponse({
            performanceKind: 'sung_vocal',
            engine,
            scoreInputConsumed: true,
            scoreHash: first.scoreHash,
            lyricsHash: first.lyricsHash,
            alignmentHash: first.alignmentHash,
            seed: first.seed,
            audioUrl: 'https://audio.internal/not-singing.wav',
            outputKind: 'isolated_vocal',
          })) as typeof fetch,
      }),
      /afroone_singing_no_genuine_engine_succeeded/
    );
  }

  // Cheapest-first fallback: local is attempted first, then the seeded genuine
  // singing provider. The fallback is truthfully marked non-exact because it
  // consumes lyrics + seed, not every score note.
  const calls: string[] = [];
  const falRender = await renderAfroOneSinging(first, {
    env: {
      AFROONE_SINGING_ENABLED: '1',
      AFROONE_SINGING_ENGINE_ORDER: 'local-score-singer,fal-ace-step',
      AFROONE_SINGING_LOCAL_URL: 'https://singer.internal/render',
      FAL_KEY: 'test-key',
    },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      calls.push(value);
      if (value === 'https://singer.internal/render') {
        return new Response('offline', { status: 503 });
      }
      if (value === 'https://queue.fal.run/fal-ai/ace-step') {
        const body = JSON.parse(String(init?.body)) as {
          seed: number;
          lyrics: string;
        };
        assert.equal(body.seed, first.seed);
        assert.equal(body.lyrics, first.lyrics);
        return jsonResponse({ request_id: 'fal-1' });
      }
      if (value.endsWith('/status')) {
        return jsonResponse({ status: 'COMPLETED' });
      }
      return jsonResponse({
        audio: { url: 'https://audio.example/full-song.wav' },
        seed: first.seed,
        lyrics: first.lyrics,
      });
    }) as typeof fetch,
    sleep: async () => undefined,
  });
  assert.equal(calls[0], 'https://singer.internal/render');
  assert.equal(falRender.engine, 'fal-ace-step');
  assert.equal(falRender.outputKind, 'full_mix');
  assert.equal(falRender.exactScoreInput, false);
  assert.deepEqual(
    falRender.attempts.map((attempt) => attempt.outcome),
    ['failed', 'succeeded']
  );
  assert.equal(falRender.cost.synthesisUsd, 0.006);
  assert.equal(falRender.cost.totalUsd, 0.006);
  const replicateCalls: string[] = [];
  const replicateRender = await renderAfroOneSinging(first, {
    env: {
      AFROONE_SINGING_ENABLED: '1',
      AFROONE_SINGING_ENGINE_ORDER: 'replicate-ace-step',
      REPLICATE_API_TOKEN: 'test-token',
      REPLICATE_SONG_VERSION: 'version-1',
    },
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      replicateCalls.push(value);
      if (value.endsWith('/predictions')) {
        const body = JSON.parse(String(init?.body)) as {
          input: { lyrics: string; seed: number };
        };
        assert.equal(body.input.lyrics, first.lyrics);
        assert.equal(body.input.seed, first.seed);
        return jsonResponse({ id: 'replicate-1', status: 'starting' });
      }
      return jsonResponse({
        id: 'replicate-1',
        status: 'succeeded',
        output: ['https://audio.example/replicate-song.wav'],
      });
    }) as typeof fetch,
    sleep: async () => undefined,
  });
  assert.equal(replicateRender.engine, 'replicate-ace-step');
  assert.equal(replicateRender.outputKind, 'full_mix');
  assert.equal(replicateRender.cost.synthesisUsd, 0.1);
  assert.equal(replicateCalls.length, 2);
  assert.deepEqual(
    combineAfroOneSingingCost({
      synthesisUsd: 0.006,
      voiceConversionUsd: 0.15,
      verificationUsd: 0.003,
      estimated: true,
    }),
    {
      currency: 'USD',
      synthesisUsd: 0.006,
      voiceConversionUsd: 0.15,
      verificationUsd: 0.003,
      totalUsd: 0.159,
      estimated: true,
    }
  );

  // Personalized singing reuses the established voice-consent law. Revocation
  // and tenant mismatch are hard failures before RVC/SVC may run.
  const modelUrl = 'https://models.internal/artist-a.pth';
  const authorized = {
    id: 'voice-a',
    workspaceId: 'workspace-a',
    artistId: 'artist-a',
    consentId: 'consent-a',
    status: 'READY',
    trainedVersion: modelUrl,
    trainingMeta: { artistId: 'artist-a', consentId: 'consent-a' },
    voiceDatasetId: null,
    voiceDataset: null,
    consent: {
      id: 'consent-a',
      workspaceId: 'workspace-a',
      artistId: 'artist-a',
      revokedAt: null,
    },
  };
  assert.equal(
    singVoiceAuthorizationFailure(authorized, 'workspace-a'),
    null
  );
  assert.equal(
    singVoiceAuthorizationFailure(
      {
        ...authorized,
        consent: { ...authorized.consent, revokedAt: new Date() },
      },
      'workspace-a'
    ),
    'voice_consent_revoked'
  );
  assert.equal(
    singVoiceAuthorizationFailure(authorized, 'workspace-b'),
    'voice_workspace_mismatch'
  );

  const repo = join(process.cwd(), '..', '..');
  const worker = readFileSync(
    join(repo, 'apps/worker/src/processors/afroone-singing.ts'),
    'utf8'
  );
  const dispatcher = readFileSync(
    join(repo, 'apps/worker/src/index.ts'),
    'utf8'
  );
  const ownEngine = readFileSync(
    join(repo, 'apps/worker/src/processors/own-engine.ts'),
    'utf8'
  );
  assert.match(worker, /singVoiceAuthorizationFailure/);
  assert.match(worker, /const invocationVoice = await loadPersonalVoice/);
  assert.match(worker, /const persistenceVoice = voice/);
  assert.match(worker, /assetKind: 'isolated_vocal'/);
  assert.match(worker, /performanceKind: 'sung_vocal'/);
  assert.match(worker, /alignmentRequired: true/);
  assert.match(worker, /afroone_singing_lyric_alignment_unverified/);
  assert.match(worker, /cost: totalCost\.totalUsd\.toFixed\(6\)/);
  assert.match(worker, /mixdown/);
  assert.match(worker, /instrumentalBeatId/);
  assert.doesNotMatch(worker, /import\s+\{[^}]*voiceAdapter/);
  assert.doesNotMatch(worker, /voiceAdapter\s*\(/);
  assert.doesNotMatch(worker, /ALLOW_STUB_AUDIO/);
  assert.match(dispatcher, /job\.name === "afroone-sing"/);
  assert.match(ownEngine, /processAfroOneSinging/);
  assert.match(ownEngine, /genuine vocal generated/);
  assert.match(ownEngine, /singingOutput\.approved !== true/);

  console.log('AfroOne genuine singing contracts: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
