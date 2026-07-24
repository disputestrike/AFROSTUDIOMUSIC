# AfroOne Training and AfroVision Plan

Status date: 2026-07-23

## Objective

AfroOne must become one connected system that can:

1. understand a creator brief and write culturally credible lyrics;
2. compose melody, harmony, rhythm, and arrangement;
3. create beats, instrument parts, loops, and sound effects;
4. sing approved lyrics in a genuine singing voice;
5. personalize the result with an explicitly consented artist voice;
6. export a playable song, stems, receipts, and repeatable render seed;
7. improve from every legally usable asset without silently discarding data;
8. build an equivalent consented learning flywheel for video.

## Current Truth

### Material shelf

The production shelf contained forged and code-synthesized loops rather than
song-derived material. Worker deployment also scheduled a lake reset, purge,
and refill cycle. This made AfroOne forget and recreate the wrong shelf.

The corrected policy is:

- source songs and their audio are never deleted;
- only derived material rows are purged;
- a surviving material must be `artist_stem` or `self_stem`;
- it must carry `meta.fromSongId`;
- new material is separated and cut from a rights-clean catalog song;
- provider-generated, opaque, seeded, and synth material cannot silently
  re-enter the production shelf.

### Replicate models already trained

- A MusicGen-family candidate completed with a strong internal score, but its
  base license does not permit the commercial production lane. It remains a
  development artifact and is not proof that production AfroOne uses training.
- Another MusicGen candidate was correctly promoted only to the development
  lane because it is CC-BY-NC.
- ACE-Step trainer runs reached Replicate, conformed the audio, and built the
  Hugging Face dataset, but failed before training because the Cog runtime
  loaded Torch 2.3 while current ACE-Step expects `torch.nn.RMSNorm`.
- The trainer image now supplies a compatible RMSNorm implementation. A new
  image push and clean-corpus run are required before claiming a successful
  commercial candidate.
- No model is considered active merely because training completed. It must
  return a runnable artifact, pass audio evaluation, beat the incumbent by the
  configured margin, carry a commercial-compatible base license, and appear in
  the render receipt as the mixed trained layer.

## Every Asset Reaches Weights Legally

Nothing is thrown away, ignored, or permanently classified as "facts only."
Every asset stays in the learning ledger. Rights-clean assets enter weights now;
the others move through consent, explicit licensing, provenance repair, or an
owned AfroOne recreation until their legal weight path is complete.

| Asset                      | Learning now                                                           | Legal path into weights                                                                                               |
| -------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Owned catalog song         | Audio, arrangement, lyrics, evaluation, material separation            | General song model immediately                                                                                        |
| Learn upload               | Analysis, evaluation, writing and production labels                    | General song model after creator training consent                                                                     |
| Material loop              | Role, groove, timbre, tempo and key behavior                           | Unified adapter now; dedicated loop/instrument adapter as the corpus grows                                            |
| Isolated vocal             | Diction, phrasing, melody and timbre                                   | Unified adapter plus consent-bound singing/voice model                                                                |
| Zap reference              | Tempo, groove, structure, instrumentation, trend and preference labels | Explicit source/model-training license, or an originality-checked AfroOne recreation rendered from owned materials    |
| MiniMax/provider render    | Measured labels, benchmark pair, preference and failure analysis       | Asset-level provider model-training license, or an originality-checked owned AfroOne recreation                       |
| Opaque old AfroOne render  | Analysis and lineage reconstruction                                    | Provenance repair; if lineage cannot be proven, recreate through the current owned engine and train on the recreation |
| Licensed catalog recording | Analysis and every contractually allowed use                           | Attach the agreement receipt with explicit commercial model-training scope                                            |

Provider audio is not abandoned, but generic commercial-use permission is not
silently treated as model-training permission. Its legal weight routes are:

1. negotiate an explicit commercial model-training license;
2. use provider outputs as blind benchmarks and preference labels;
3. extract non-audio facts such as BPM, key, structure, density, and role maps;
4. have AfroOne create a new, originality-checked realization of the high-level
   musical facts using owned/consented instruments and performances;
5. train on that owned recreation while retaining both provenance and
   similarity-check receipts.

The admin license endpoint is `POST /admin/training/assets/license`. It requires
asset type/id, licensor, agreement id, HTTPS evidence URL, grant date, territory,
and explicit `commercial-model-training` scope. There is no global legal bypass.

## Training Flywheel

### Nightly inputs

1. Scan songs, Learn/Zap references, materials, vocals, and provider renders.
2. Resolve current training consent by workspace.
3. classify provenance and rights.
4. assign every asset to train-now, consent, license, provenance-repair, or
   owned-recreation status.
5. persist `music.training.learningLanes.v1` with lane counts.
6. freeze evaluation holdouts so training never sees test audio.
7. hash exact audio bytes, prompts, lyrics, consent snapshot, and source family.

### General song model

The first production-capable base is ACE-Step under its commercial-compatible
license. The current unified archive includes every rights-cleared song, Learn
upload, material loop, and isolated vocal. Each archive item includes:

- conformed song audio;
- genre and sub-lane;
- BPM and key;
- title and instrumentation tags when known;
- structured lyrics for vocal full mixes;
- `[instrumental]` for instrumental audio;
- source song ID, content hash, and consent receipt.

Replicate returns a LoRA candidate. That candidate remains inactive until:

1. the artifact is runnable;
2. legal lane is `production`;
3. frozen holdout quality is measured;
4. lane compliance and audio QC pass;
5. producer evaluation beats the incumbent;
6. a production render proves `trainedLayer` was mixed, not skipped.

### Loop and instrument model

Song-derived stems are segmented by downbeat and role. A dedicated adapter
learns drums, bass/log-drum relationships, percussion hierarchy, harmony,
melody, fills, and sound effects. It must produce role-isolated, tempo-locked,
key-aware assets with a deterministic seed.

Clean loops enter the current unified ACE-Step run now with an explicit
`loop-instrument-adapter` prompt tag. Clips below 25 seconds are tempo-preserving
repetitions to the trainer's 30-second floor rather than being skipped. A
dedicated adapter becomes the promotion target when the loop corpus can support
independent evaluation.

### Singing and personal voice

AfroOne composes a deterministic melody score and validates one lyric syllable
per score note. The genuine singing ladder is:

1. local score singer when configured;
2. FAL ACE-Step;
3. Replicate ACE-Step.

The generated performance is measured for lyric alignment and isolated from a
full mix when necessary. Personal timbre conversion runs only when:

- the voice profile is READY;
- workspace, artist, consent, and dataset lineage agree;
- consent is active;
- the trained artifact is present.

Legacy profiles are repaired only when one consent unambiguously maps to one
artist. Authorization is never weakened to make a broken profile pass.

### Writing model

Writing learns from permissioned lyrics as structured craft, not copied lines:

- section purpose and energy;
- hook-cell repetition;
- rhyme and syllable patterns;
- multilingual code-switch ratios;
- topic, image, and emotional progression;
- pronunciation and native-review feedback.

Provider/reference lyrics remain in the learning ledger. They enter writing
weights through explicit permission, public-domain status, creator consent, or
new owned examples generated from non-protectable craft measurements and
cleared by similarity checks.

## Evidence Required Per Release

Every AfroOne proof must include:

- input song/material IDs and rights bases;
- model and adapter versions;
- dataset hash and consent snapshot hash;
- ontology and render-spec versions;
- seed and variation parameters;
- generated lyrics and melody-score hashes;
- selected material IDs and source song IDs;
- trained-layer mixed/skipped receipt;
- voice profile and consent lineage;
- audio QC, lyric alignment, lane score, cost, and wall-clock time;
- stem import check in FL Studio or Ableton;
- producer rating and `feels Western` flag.

## Execution Order

1. Deploy the song-only shelf and remove automatic resets.
2. Run the explicit shelf rebuild and verify every material has `fromSongId`.
3. Repair unambiguous legacy voice lineage and verify authorization.
4. Push the corrected Replicate trainer image.
5. run a clean corpus training candidate immediately.
6. evaluate and promote only on a measured win.
7. render one instrumental and one sung song through AfroOne.
8. prove the trained layer, genuine singing, voice conversion, costs, and
   provenance in the final receipts.
9. repeat nightly when the exact corpus hash changes.

## AfroVision: Equivalent Video Flywheel

AfroVision should mirror the same architecture rather than train one opaque
video model on everything.

### Video learning lanes

- Owned footage: shot planning, motion, editing, and generation.
- Consented likeness footage: private per-artist identity adapter.
- Licensed stock: only the uses allowed by its license.
- Provider-generated video: benchmark, prompt/shot evaluation, edit input, and
  a license-or-owned-recreation queue for eventual weight training.
- Public trends: facts such as shot duration, camera move, framing, palette,
  transition type, and platform performance.
- Movie references: scene-language analysis and evaluation, never copied frames
  in commercial weights without a license.

### Pipeline

1. Verify ownership, consent, likeness scope, territory, duration, and
   revocation terms.
2. Split footage into shots and measure subject, action, camera, lens, lighting,
   wardrobe, location, palette, continuity, and beat synchronization.
3. Train separate adapters for likeness, visual style, motion, and editing.
4. Generate a deterministic storyboard and continuity graph before rendering.
5. Render shots through owned/local or licensed providers.
6. apply face/wardrobe/location continuity, lip sync, compositing, color, and
   edit timing.
7. evaluate identity consistency, temporal stability, prompt adherence, lip
   sync, cultural accuracy, originality, cost, and seconds per scene.
8. Promote only measured winners and keep rollback pointers.
9. Attach a per-shot provenance receipt and enforce consent revocation.

### Video proof gate

AfroVision is not complete until one music-video job proves:

- the same artist remains identifiable across shots;
- no unauthorized likeness or training source was used;
- lip sync and beat cuts pass measured thresholds;
- scene prompts and continuity are reproducible;
- all final scenes are playable and exportable;
- cost per scene and provider spend are recorded;
- the user can replace one shot without re-rendering the whole video.
