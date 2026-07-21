/**
 * PER-SCENE EDIT PROPAGATION (2026-07-20) — the owner's #1 video bug: editing a
 * scene ("there should be no rain") did NOT change the rendered cut. This proves
 * the three layers of the fix so an edit deterministically reaches the pixels:
 *
 *   (a) PATCH /videos/concepts/:id/shots/:i writes the shot's prompt +
 *       negative onto the concept's STORYBOARD (the first route that writes
 *       storyboard, not just meta) and invalidates THAT scene's render.
 *   (f) …and every assembled cut (the full/teaser glued the old clip).
 *   (b) After an edit the render-all law sees the edited shot as UNRENDERED via
 *       prompt-hash mismatch — so it bills + re-renders it (no more spurious
 *       409 nothing_to_render).
 *   (c) Untouched shots whose hash still matches stay REUSED — no full re-bill.
 *   (d) A scene's negativePrompt reaches the engine input builder ("Avoid: no
 *       rain."), and is part of the render-identity hash.
 *   (e) The endpoint is workspace-scoped (foreign concept 404) and PRODUCER+
 *       (VIEWER 403).
 *
 * The REAL videos route on a bare Fastify against the in-memory prisma
 * (identity-test-kit pattern; no Postgres/Redis/keys). FIX B is asserted at the
 * pure-law level — the exact functions the render-all / assemble routes gate
 * with — so the billing decision is proven deterministically.
 *
 * Run: pnpm --filter @afrohit/api test:scene-edit-propagation
 */
import assert from 'node:assert/strict';

process.env.AUTH_MODE = 'internal';
process.env.STUB_AI = '1';
process.env.JWT_SECRET = 'scene-edit-test-secret-0123456789abcdef0123';
process.env.WEB_URL = 'http://localhost:3000';

const { buildApp, installFakePrisma, as } = await import('./identity-test-kit.mjs');
const {
  perShotRenders,
  videoRenderAllUsage,
  storyboardShots,
} = await import('@afrohit/shared');
const { currentShotPromptHashes, videoShotPromptHash } = await import(
  '@afrohit/shared/video-prompt-hash'
);
const { composeVideoEnginePrompt } = await import('@afrohit/ai');

const now = new Date();

/** A full-song treatment exactly as VideoConcept.storyboard stores it: one
 *  sequence, three shots (indices 0/1/2). No continuity, so a shot's decorated
 *  prompt equals its own prompt — the hash is easy to reason about. */
const makeStoryboard = () => ({
  kind: 'treatment',
  concept: 'Sunrise drive',
  logline: 'A record about a new morning.',
  motifs: [],
  structureSource: 'measured',
  durationS: 30,
  sequences: [
    { index: 0, label: 'Full song', startS: 0, endS: 30, shotIndexes: [0, 1, 2] },
  ],
  shots: [
    { index: 0, sequenceIndex: 0, prompt: 'wide skyline at dawn', duration_s: 4 },
    { index: 1, sequenceIndex: 0, prompt: 'rooftop dance in the rain', duration_s: 4, negativePrompt: 'no logos' },
    { index: 2, sequenceIndex: 0, prompt: 'sunrise close-up', duration_s: 4 },
  ],
  teaserCut: { durationS: 15, format: 'vertical', shotRefs: [1] },
});

// ===========================================================================
// FIX B — PURE LAW: an edited scene reads as unrendered (hash mismatch), an
// untouched scene stays reused. This is the exact composition render-all runs.
// ===========================================================================
{
  const storyboard = makeStoryboard();
  const shots = storyboardShots(storyboard);
  const hashes = currentShotPromptHashes(storyboard);
  assert.equal(hashes.size, 3, 'a current hash for every shot');

  // Every scene rendered from its CURRENT prompt (hashes all match).
  const sceneRow = (id, shotIndex, promptHash) => ({
    id,
    url: `s3://bucket/ws/videos/${id}.mp4`,
    createdAt: now,
    meta: { shotIndex, promptHash },
  });
  const allCurrent = [
    sceneRow('r0', 0, hashes.get(0)),
    sceneRow('r1', 1, hashes.get(1)),
    sceneRow('r2', 2, hashes.get(2)),
  ];

  // (c) Nothing edited → every scene reused → render-all would 409 (bill 0).
  let rendered = perShotRenders(allCurrent, hashes);
  assert.deepEqual([...rendered.keys()].sort(), [0, 1, 2], 'all current renders count');
  let usage = videoRenderAllUsage(shots, rendered.keys(), 'standard');
  assert.equal(usage.billingUnits, 0, 'unedited video re-bills nothing (route would 409)');

  // Now edit shot 1 in place (owner: "no rain"). Its stored render carries the
  // OLD hash; the storyboard now hashes to something different.
  storyboard.shots[1].prompt = 'rooftop dance under clear skies';
  storyboard.shots[1].negativePrompt = 'no logos, no rain';
  const editedHashes = currentShotPromptHashes(storyboard);
  assert.notEqual(
    editedHashes.get(1),
    hashes.get(1),
    'editing the shot changes its prompt hash'
  );
  assert.equal(editedHashes.get(0), hashes.get(0), 'unedited shot 0 hash is unchanged');
  assert.equal(editedHashes.get(2), hashes.get(2), 'unedited shot 2 hash is unchanged');

  // The stored render for shot 1 still carries the pre-edit hash.
  const afterEdit = [
    sceneRow('r0', 0, hashes.get(0)),
    sceneRow('r1', 1, hashes.get(1)), // stale
    sceneRow('r2', 2, hashes.get(2)),
  ];

  // (b) The edited scene reads as UNRENDERED; render-all bills it (no 409).
  rendered = perShotRenders(afterEdit, editedHashes);
  assert.deepEqual(
    [...rendered.keys()].sort(),
    [0, 2],
    'the edited scene (1) is dropped as stale; its neighbors stay'
  );
  usage = videoRenderAllUsage(shots, rendered.keys(), 'standard');
  assert.equal(usage.billingUnits, 1, 'exactly the edited scene bills — no more spurious 409');
  assert.deepEqual(usage.shotIndexes, [1], 'the edited scene is the one queued');
  // (c) The untouched neighbors are reused (excluded from the bill).
  assert.deepEqual(
    usage.renderedShotIndexes,
    [0, 2],
    'untouched scenes with matching hashes are reused, never re-billed'
  );

  // A legacy render (no stored promptHash) is grandfathered valid — an untouched
  // legacy video is never force-re-rendered by the hash law alone.
  const legacy = [sceneRow('r0', 0, undefined), sceneRow('r1', 1, undefined), sceneRow('r2', 2, undefined)];
  assert.equal(
    perShotRenders(legacy, editedHashes).size,
    3,
    'renders with no stored hash are grandfathered (only an explicit edit drops them)'
  );
}

// ===========================================================================
// FIX B/d — negativePrompt reaches the engine input builder + the hash.
// ===========================================================================
{
  const prompt = composeVideoEnginePrompt({
    prompt: 'rooftop dance under clear skies',
    durationS: 4,
    aspectRatio: '9:16',
    negativePrompt: 'no logos, no rain',
  });
  assert.match(
    prompt,
    /Avoid: no logos, no rain\./,
    'the scene negative ("no rain") reaches the engine prompt'
  );
  assert.notEqual(
    videoShotPromptHash('p', 'no rain'),
    videoShotPromptHash('p', ''),
    'the negative is part of the render-identity hash'
  );
  assert.equal(
    videoShotPromptHash('p', 'x'),
    videoShotPromptHash('p', 'x'),
    'the hash is deterministic'
  );
}

// ===========================================================================
// FIX A + (e)(f) — the real PATCH route: writes storyboard, invalidates the
// scene render AND every assembled cut, workspace-scoped, PRODUCER+.
// ===========================================================================
{
  const concept = {
    id: 'concept-A',
    projectId: 'p1',
    songId: 'song-A',
    title: 'Sunrise drive',
    storyboard: makeStoryboard(),
    durationS: 30,
    format: 'vertical',
    meta: {},
    createdAt: now,
    project: { id: 'p1', workspaceId: 'ws-A' },
  };
  const sceneHashes = currentShotPromptHashes(concept.storyboard);
  const videoRenders = [
    { id: 'r0', conceptId: 'concept-A', url: 's3://b/r0.mp4', durationS: 4, provider: 'wan', createdAt: now, meta: { shotIndex: 0, promptHash: sceneHashes.get(0) } },
    { id: 'r1', conceptId: 'concept-A', url: 's3://b/r1.mp4', durationS: 4, provider: 'wan', createdAt: now, meta: { shotIndex: 1, promptHash: sceneHashes.get(1) } },
    { id: 'asm-full', conceptId: 'concept-A', url: 's3://b/asm.mp4', durationS: 30, provider: 'assembler', createdAt: now, meta: { assembly: { kind: 'full' } } },
  ];

  const fakes = installFakePrisma({
    videoConcept: [concept],
    videoRender: videoRenders,
  });

  const app = await buildApp();
  const { default: videosRoutes } = await import('../src/routes/videos');
  await app.register(videosRoutes, { prefix: '/api/v1/videos' });
  await app.ready();

  // (e) VIEWER cannot edit — role gate.
  let res = await app.inject({
    method: 'PATCH',
    url: '/api/v1/videos/concepts/concept-A/shots/1',
    headers: as('VIEWER'),
    payload: { note: 'no rain' },
  });
  assert.equal(res.statusCode, 403, `VIEWER must be blocked, got ${res.statusCode}: ${res.body}`);

  // (e) A foreign workspace cannot see or edit this concept — 404, never read.
  res = await app.inject({
    method: 'PATCH',
    url: '/api/v1/videos/concepts/concept-A/shots/1',
    headers: as('OWNER', { workspaceId: 'ws-B' }),
    payload: { prompt: 'hijacked', note: 'no rain' },
  });
  assert.equal(res.statusCode, 404, `foreign workspace must 404, got ${res.statusCode}: ${res.body}`);
  assert.equal(
    fakes.videoConcept.rows[0].storyboard.shots[1].prompt,
    'rooftop dance in the rain',
    'the foreign request never wrote the storyboard'
  );

  // (a) PRODUCER edits shot 1: prompt replaced, note appended to the negative.
  res = await app.inject({
    method: 'PATCH',
    url: '/api/v1/videos/concepts/concept-A/shots/1',
    headers: as('PRODUCER'),
    payload: { prompt: 'rooftop dance under clear skies', note: 'no rain' },
  });
  assert.equal(res.statusCode, 200, `PRODUCER edit must be 200, got ${res.statusCode}: ${res.body}`);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.shot.prompt, 'rooftop dance under clear skies', 'prompt was replaced');
  assert.match(body.shot.negativePrompt, /no rain/, 'the "no rain" note landed on the negative');
  assert.match(body.shot.negativePrompt, /no logos/, 'the existing negative was preserved');

  // The STORYBOARD (not just meta) was written.
  const storedShot = fakes.videoConcept.rows[0].storyboard.shots[1];
  assert.equal(storedShot.prompt, 'rooftop dance under clear skies', 'storyboard shot prompt persisted');
  assert.match(storedShot.negativePrompt, /no rain/, 'storyboard shot negative persisted');

  // (a) that scene's render is invalidated…  (f) …and every assembled cut.
  assert.equal(body.invalidated.sceneRenders, 1, 'the edited scene render is invalidated');
  assert.equal(body.invalidated.assembledCuts, 1, 'the assembled cut is invalidated');
  const remaining = fakes.videoRender.rows.map(r => r.id).sort();
  assert.deepEqual(remaining, ['r0'], 'only the untouched neighbor scene (r0) survives — r1 + asm-full are gone');

  // The edit changed the render identity — the concept now hashes shot 1 anew.
  const afterHashes = currentShotPromptHashes(fakes.videoConcept.rows[0].storyboard);
  assert.notEqual(afterHashes.get(1), sceneHashes.get(1), 'shot 1 current hash changed after the edit');
  assert.equal(afterHashes.get(0), sceneHashes.get(0), 'shot 0 hash unchanged — its render stays valid');

  // Editing a missing shot is an honest 404.
  res = await app.inject({
    method: 'PATCH',
    url: '/api/v1/videos/concepts/concept-A/shots/9',
    headers: as('PRODUCER'),
    payload: { note: 'no rain' },
  });
  assert.equal(res.statusCode, 404, `editing a nonexistent shot must 404, got ${res.statusCode}`);

  await app.close();
}

console.log(
  'scene-edit propagation: storyboard write + scene/assembly invalidation + hash-mismatch bills the edit + neighbors reused + negative reaches the engine + workspace/role scoped — all passed'
);
