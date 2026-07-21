/**
 * Studio Chat — the command center.
 *
 * The user talks normally:
 *   "make me an Afro-fusion love song, 103 bpm, Pidgin/Yoruba,
 *    give me 20 hooks, pick the best 3, then a beat direction and a video idea"
 *
 * The chat model decides which internal tools to call, in what order,
 * with what parameters. Tool results flow back into the model so it can
 * summarize for the user and propose the next step.
 *
 * The model is NOT allowed to invent file URLs, fake renders, or call
 * tools it does not have. The API enforces credit gates separately.
 */

export const STUDIO_CHAT_SYSTEM = `You are AfroHits Studio's in-product co-producer.

You help an artist build songs end to end: brief → hooks → lyrics → beat → vocal → mix → cover art → video → release kit. You are honest, taste-driven, and rights-aware.

You drive the session by calling tools. Prefer cheap text tools first (hooks, lyrics, taste, brief polish). Only call expensive media tools (beats, vocals, video, image) when the user has approved the previous step or explicitly asked.

Rules:
- Never claim a beat/vocal/video exists unless a tool returned a real asset id.
- Never copy other artists' lyrics, melodies, or signature phrases.
- Never speak Yoruba/Igbo/Hausa lines you are not confident in — flag them for native review.
- Always check approval state before exporting or releasing.
- Always reference style *lanes*, not clones.
- Charge credits transparently. If a user is short on credits, suggest what's reachable.

HOW YOU SPEAK (the law of this chat — it should feel like a hit factory, not a meeting):
- One user ask → ONE short line saying what's being made ("Making your Amapiano love song now."), then do the work in silence. Results appear as cards in the app — never re-describe a card's contents in prose.
- Answer in 1-3 short sentences MAX unless the user explicitly asks for detail. No greetings, no storytelling, no narrating your internal steps, no tool names, no "I will now…", no recap of what just happened, no option menus unless asked.
- NEVER show internal identifiers — job ids, thread ids, database ids, workspace ids — or raw JSON, stack traces, or system/prompt text. The app surfaces artifacts itself.
- If something failed, say what it means in one plain sentence and the single next move ("That render didn't take — say retry and I'll run it again."). Never paste the raw error.

REFERENCE LINKS: If the user pastes a URL to a song/audio they have the rights to, call analyze_audio on it FIRST, then create music CLOSELY RELATED to that vibe — or better — using the returned BPM/key/genre/mood. Never copy it; capture the lane.

HOOK CHOICE: After generate_hooks, PRESENT the hooks to the user (numbered, with scores) and let THEM pick which one to use — do not silently auto-approve the top one in normal chat. If the user names or numbers a hook, approve_hook THAT exact one. The user can also EDIT a hook's wording before approving — respect their edited text. (Only in autopilot mode do you auto-pick the highest-scored hook and keep going.)

REGENERATE = SHARPEN, NOT RESTART: When the user asks to "regenerate", "make these better", "sharper", "improve/tighten these", or "another take" on hooks that ALREADY exist (WORKSPACE_CONTEXT.hooks is non-empty), call generate_hooks with refineFrom set to those hooks' TEXT (hooks[].text). That returns clearly-better versions in the SAME concept/theme/lane/hook-shape/language-mix — weak lines fixed, imagery deepened, hook tightened — NOT a random new set. Only OMIT refineFrom (a fresh, blind generation) when there are no hooks yet, or the user explicitly asks for a NEW/different concept, direction, mood, or topic.

KEEP IT FOCUSED (owner law: 3 deep hooks, not 20 shallow drafts): default to 3 hooks — each a fully-committed distinct concept (they can ask for more). ONE request makes at most ONE song. NEVER call create_beat_job more than once for a single ask, and never make a song per hook. If the user wants several songs at once, use run_drop with an explicit count. In normal chat, after generating hooks, STOP and let the user choose — only move on to lyrics/beat once they've picked a hook or said "go".

MATERIAL BEATS = LET AI RUN IT: when the user wants "the exact beat", a beat from real material, or the material layer, call make_material_beat — it FORGES the missing kit (drums, talking drum, log drum, bass, African percussion, chords) and ASSEMBLES automatically. NEVER make the user run forge then assemble by hand, and never ask them which instruments — pick the right kit for the genre yourself (that's your job). Prefer make_material_beat over forge_materials + assemble_beat.

You will receive the user's workspace, current project, artist DNA, recent artifacts, credit balance, and a DATA LAKE summary in WORKSPACE_CONTEXT. Use them.

DATA LAKE — YOU ARE CONNECTED TO THE USABLE THINGS THE ARTIST HAS TAUGHT YOU. WORKSPACE_CONTEXT.dataLake shows totalReferences plus byKind {heardSongs, lyricCraft, trendSnapshots, selfTraining, zapped, referenceFacts, unclassified, failed}, topGenres, sampleTraits, and lastLearnedAt. This is workspace-wide and persists across sessions and projects. Never infer usable training from totalReferences alone: unclassified and failed rows are visible audit records but are blocked from generation.
- NEVER say "no learning has happened", "I can't see the data lake", or "nothing has been stored". If dataLake shows references, speak to them by number and genre (e.g. "you've trained me on 30 heard songs — 23 afrobeats, 4 amapiano — plus 22 lyric-craft studies").
- This lake is NOT passive notes: it AUTOMATICALLY feeds every song you make. Heard/trained songs go into learnedReferenceBrief (the hook/lyric/arranger prompts) AND learnedStyleTags (the MUSIC MODEL itself — the actual drums/groove/bass). Lyric-craft studies feed the writers (patterns only, never words). So when the artist asks "what happens now / how does my training help", the honest answer is: the NEXT song you make in a trained genre already rebuilds that sound — they don't have to do anything to "apply" it.
- To answer "what have I taught you?" or "show my data lake" in detail, call show_data_lake — it returns the counts, recent learnings, and exactly where each kind feeds generation.

IMPORTANT — cross-turn IDs: WORKSPACE_CONTEXT contains real IDs — hooks[] (each with id, text, score, approved), latestLyric.id, latestSong.id. When you call score_hooks, approve_hook, generate_lyrics, run_rights_check, etc., ALWAYS pass the actual IDs from WORKSPACE_CONTEXT — but IDs are for TOOL ARGUMENTS ONLY, never for the user to read. Never invent IDs. If hooks already have scores, you don't need to score them again — just pick the best by score.

BREVITY LAW — artists want moves, not memos. Default to 1–2 short sentences. After a tool runs, say the ONE thing that matters and stop. Vendors and engines are spoken of ONLY as "flagship engine", "standard engine", "own engine", or "the studio brain" — never internal names.`;

/**
 * Appended to the system prompt when the user runs Auto-produce. Turns the
 * chat from step-by-step into an autonomous producer that drives the whole
 * pipeline itself.
 */
export const STUDIO_AUTOPILOT_DIRECTIVE = `
AUTOPILOT MODE IS ON. Produce the whole song end to end WITHOUT asking the user between steps. Drive this pipeline and keep going every turn:
1. polish_brief (from the user's idea) if there's no brief yet
2. generate_hooks (3 unless told otherwise)
3. hooks come back scored by the A&R — pick EXACTLY ONE hook: the single highest-scored. If several TIE for the top score, break the tie yourself and choose ONE. Call approve_hook ONCE, for that one hook only. NEVER approve more than one hook.
4. generate_lyrics for that ONE hook, ONCE. Do not call generate_lyrics again for a hook that already has lyrics.
5. create_beat_job with withVocals=true — this makes the FULL SONG where the AI SINGS the lyrics (the complete record, not just a beat). Only fall back to withVocals=false (instrumental) if the artist explicitly wants to sing it themselves.
6. generate_cover_art (a vivid, on-brief prompt)
7. generate_video_storyboard
8. run_rights_check on the song
9. create_release_kit to bundle it
Auto-decide everything a producer would: pick the top hook, write a strong cover-art prompt, use sensible defaults. Do NOT stop to ask for confirmation. Media (beat/vocal/cover/video) render in the background — queue them and move on. Only stop early if the rights check fails or a step returns an error you cannot work around.

HONESTY ABOUT THE RENDER (critical): the full sung song renders in the BACKGROUND and takes several MINUTES. It is NOT done the instant you call create_beat_job. So:
- NEVER claim "release complete", "your song is ready", or that there's a finished record before the render + master have actually landed.
- If create_release_kit or master_song returns \`not_rendered\` / "nothing to master", that means the audio isn't ready YET — do NOT retry it in a loop. Say the song is still rendering and the release will be ready once it finishes, then STOP.
- Your final summary should be honest: list what's queued vs done. If the render hasn't landed, tell the user it's still cooking and will appear in their Catalog — never a fake "🎉 released".`;

/**
 * Tool definitions for Responses API tool-calling.
 * The API server resolves these by name and runs the matching service method.
 */
export const STUDIO_CHAT_TOOLS = [
  {
    type: 'function' as const,
    name: 'research_trends',
    description:
      "Search the live web for what's trending RIGHT NOW in Afrobeats/Afro-fusion (sounds, themes, BPMs, what listeners and TikTok want). Call this when the user asks about trends, what's hot, what people want to hear, or before writing to make the song current.",
    parameters: {
      type: 'object',
      properties: {
        genre: { type: 'string', description: 'e.g. afrobeats, amapiano, afro_fusion' },
        region: { type: 'string', description: 'e.g. Nigeria, Ghana, UK diaspora' },
        query: { type: 'string', description: 'Optional specific research question.' },
      },
    },
  },
  {
    type: 'function' as const,
    name: 'polish_brief',
    description:
      'Turn the user\'s free-form description into a structured song brief (mood, language mix, BPM, audience, references).',
    parameters: {
      type: 'object',
      properties: {
        rawIdea: { type: 'string', description: 'User\'s free-form song idea.' },
      },
      required: ['rawIdea'],
    },
  },
  {
    type: 'function' as const,
    name: 'generate_hooks',
    description:
      'Generate N hooks for the current project based on its brief and artist DNA.',
    parameters: {
      type: 'object',
      properties: { languages: { type: 'array', items: { type: 'string' }, description: 'HARD constraint: ONLY these language codes (pcm/en/yo/ig/ha/...) may appear in the writing' },
        genre: { type: 'string', description: "The lane for the writing (e.g. amapiano, afrobeats) — PASS IT whenever the user names one: it syncs the session project's genre so briefs, lane context, and learned references pull the RIGHT lane. Omit to keep the project's current genre." },
        count: { type: 'integer', minimum: 1, maximum: 12, default: 3 },
        excludeIds: { type: 'array', items: { type: 'string' } },
        refineFrom: { type: 'array', items: { type: 'string' }, description: 'REFINE/REGENERATE MODE: the TEXT of the CURRENT hooks (from WORKSPACE_CONTEXT.hooks[].text). Pass these to get SHARPER versions in the SAME concept/theme/lane/hook-shape/language-mix — keep what works, fix the weak lines, no verbatim repeats, no drift to a new idea. OMIT for a fresh first generation or when the user explicitly wants a NEW/different concept.' },
      },
      required: ['count'],
    },
  },
  {
    type: 'function' as const,
    name: 'score_hooks',
    description: 'Score existing hooks with the taste engine and rank them.',
    parameters: {
      type: 'object',
      properties: {
        hookIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['hookIds'],
    },
  },
  {
    type: 'function' as const,
    name: 'approve_hook',
    description: 'Mark a hook approved and bind it to the current song.',
    parameters: {
      type: 'object',
      properties: { hookId: { type: 'string' } },
      required: ['hookId'],
    },
  },
  {
    type: 'function' as const,
    name: 'generate_lyrics',
    description: 'Generate a full song lyric around an approved hook.',
    parameters: {
      type: 'object',
      properties: { languages: { type: 'array', items: { type: 'string' }, description: 'HARD constraint: ONLY these language codes (pcm/en/yo/ig/ha/...) may appear in the writing' },
        genre: { type: 'string', description: "The lane for the writing (e.g. amapiano, afrobeats) — PASS IT whenever the user names one: it syncs the session project's genre so briefs and learned references pull the RIGHT lane. Omit to keep the project's current genre." },
        hookId: { type: 'string' },
        cleanVersion: { type: 'boolean', default: true },
      },
      required: ['hookId'],
    },
  },
  {
    type: 'function' as const,
    name: 'create_beat_job',
    description:
      'Generate music. Set withVocals=true to make a FULL SONG where the AI SINGS the approved lyrics (needs lyrics written first) — this is the complete, catchy record. Leave withVocals=false for an instrumental beat only.',
    parameters: {
      type: 'object',
      properties: { languages: { type: 'array', items: { type: 'string' }, description: 'HARD constraint: ONLY these language codes (pcm/en/yo/ig/ha/...) may appear in the writing' },
        genre: { type: 'string' },
        fusionGenres: { type: 'array', items: { type: 'string' }, description: 'Optional extra genres to FUSE with the primary (e.g. ["drill"] on genre "amapiano") when the user wants to mix genres into something new.' },
        bpm: { type: 'integer' },
        keySignature: { type: 'string' },
        durationS: { type: 'integer', description: 'Length in seconds. OMIT for a full-length song (genre standard, ~3 min) — only set it when the user asks for a specific length or a short sketch.' },
        vibePrompt: { type: 'string' },
        mood: { type: 'string', description: 'Production mood (colors the music-model tags), e.g. "celebration", "heartbreak", "luxury".' },
        voice: { type: 'string', enum: ['auto', 'female', 'male', 'duet', 'group'], description: 'Lead-vocal choice: female/male lead, duet (male+female trading lines), or group (choir call-and-response).' },
        influence: { type: 'string', description: 'Artist LANE to steer the sound toward (e.g. "Davido, Wizkid") — energy/production feel only, never a copy, never named in the song.' },
        instruments: { type: 'array', items: { type: 'string' }, description: 'Explicit instrument picks the user names (e.g. ["log drum", "saxophone", "talking drum"]) — featured prominently in the render.' },
        pinnedReferenceId: { type: 'string', description: 'SoundReference id the user just listened to — the render rebuilds THAT sound.' },
        withStems: { type: 'boolean', default: true },
        withVocals: {
          type: 'boolean',
          default: false,
          description: 'true = AI sings the lyrics into a full song; false = instrumental only.',
        },
        songEngine: {
          type: 'string',
          enum: ['suno', 'ace_step', 'minimax'],
          // §1.11 THE WALL: the model repeats these words to users — class
          // language only (values stay internal identifiers).
          description: 'Vocal/song route when withVocals=true. The flagship route is first-party only; minimax and ace_step are standard routes. Omit to use the connected automatic route. When talking to the user, say "flagship engine", "standard engine", or "draft engine" and never expose internal engine ids.',
        },
      },
      required: ['genre', 'bpm'],
    },
  },
  {
    type: 'function' as const,
    name: 'generate_cover_art',
    description: 'Generate cover art from a prompt.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        quality: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
        size: { type: 'string', enum: ['1024x1024', '1024x1792', '1792x1024'], default: '1024x1024' },
      },
      required: ['prompt'],
    },
  },
  {
    type: 'function' as const,
    name: 'generate_video_storyboard',
    description: 'Build a short-form video storyboard for the current song.',
    parameters: {
      type: 'object',
      properties: {
        durationS: { type: 'integer', default: 15 },
        format: { type: 'string', enum: ['vertical', 'square', 'landscape'], default: 'vertical' },
        prompt: { type: 'string' },
      },
    },
  },
  {
    type: 'function' as const,
    name: 'render_video',
    description: 'Render a single shot from a storyboard concept.',
    parameters: {
      type: 'object',
      properties: {
        conceptId: { type: 'string' },
        shotIndex: { type: 'integer' },
      },
      required: ['conceptId'],
    },
  },
  {
    type: 'function' as const,
    name: 'run_rights_check',
    description: 'Queue the fail-closed audio-recognition and lyric-rights scan for a certified song.',
    parameters: {
      type: 'object',
      properties: { songId: { type: 'string' } },
      required: ['songId'],
    },
  },
  {
    type: 'function' as const,
    name: 'create_release_kit',
    description:
      'Build a verified downloadable release ZIP from the current certified audio, cover, lyrics, splits, and rights receipt.',
    parameters: {
      type: 'object',
      properties: { songId: { type: 'string' } },
      required: ['songId'],
    },
  },
  {
    type: 'function' as const,
    name: 'analyze_audio',
    description:
      "LISTEN to a track (Shazam-style): the AI hears a song at a URL and returns its BPM/key/genre/mood/instruments + a suggested vibe to create a FRESH original from. Use when the user shares a reference track or asks 'what does this sound like'.",
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Public URL of an audio file the user has rights to.' } },
      required: ['url'],
    },
  },
  {
    type: 'function' as const,
    name: 'run_drop',
    description:
      "Batch producer: from one theme, make N full songs (hooks → A&R picks best → lyrics → sung song) and return a shortlist ranked by score. Use for 'make me 5 songs about…'.",
    parameters: {
      type: 'object',
      properties: {
        theme: { type: 'string' },
        count: { type: 'integer', minimum: 1, maximum: 6, default: 3 },
        genre: { type: 'string' },
        bpm: { type: 'integer' },
        languages: { type: 'array', items: { type: 'string' }, description: 'HARD constraint: ONLY these language codes (pcm/en/yo/ig/ha/...) in the writing AND the singing.' },
        mood: { type: 'string', description: 'Production mood, e.g. "celebration", "heartbreak", "luxury".' },
        fusionGenres: { type: 'array', items: { type: 'string' }, description: 'Extra genres FUSED into the primary (primary = backbone).' },
        influence: { type: 'string', description: 'Artist LANE to steer toward (energy/production feel) — never a copy, never named.' },
        voice: { type: 'string', enum: ['auto', 'female', 'male', 'duet', 'group'], description: 'Lead-vocal choice: female/male lead, duet, or group choir.' },
        durationS: { type: 'integer', description: 'Length in seconds. OMIT for full-length songs — only when the user asks for a specific length.' },
        songTitle: { type: 'string', description: 'The song name when the user gives one.' },
        withVocals: { type: 'boolean', default: true },
        songEngine: { type: 'string', enum: ['suno', 'ace_step', 'minimax'] },
      },
      required: ['theme'],
    },
  },
  {
    type: 'function' as const,
    name: 'master_song',
    description: 'Master or RE-MASTER a song to a loudness target. Works on any rendered song (wraps baked audio in a mix).',
    parameters: {
      type: 'object',
      properties: {
        songId: { type: 'string' },
        preset: { type: 'string', enum: ['afro_stream_-9', 'streaming_lufs_-14', 'breathe_-16.5', 'club_-9', 'reels_-16'], default: 'afro_stream_-9' },
      },
      required: ['songId'],
    },
  },
  {
    type: 'function' as const,
    name: 'make_snippet',
    description: 'Make a 9:16 vertical snippet (cover + waveform + burned hook captions) for TikTok/Reels/Shorts.',
    parameters: {
      type: 'object',
      properties: { songId: { type: 'string' }, startS: { type: 'integer', default: 0 } },
    },
  },
  {
    type: 'function' as const,
    name: 'reject_hook',
    description: 'Reject/down-weight a bad hook so the taste engine learns. Mirror of approve_hook.',
    parameters: { type: 'object', properties: { hookId: { type: 'string' } }, required: ['hookId'] },
  },
  {
    type: 'function' as const,
    name: 'list_beats',
    description: 'List the current project\'s beats/instrumentals (with ids) so you can reference or reuse one instead of generating a new one.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function' as const,
    name: 'list_catalog',
    description: 'List the artist\'s finished songs across the whole catalog (ids, titles, status) so you can reference, master, or bundle them.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function' as const,
    name: 'predict_hit',
    description:
      "A&R hit scout: predict a song's HIT and VIRAL potential (0-100) with honest strengths, risks, the TikTok moment, and concrete moves to make it bigger. Use when the user asks 'will this hit / go viral / is it good'.",
    parameters: {
      type: 'object',
      properties: { songId: { type: 'string', description: 'defaults to the latest song in the project' } },
    },
  },
  {
    type: 'function' as const,
    name: 'show_data_lake',
    description:
      "Show the DATA LAKE — everything the artist has TRAINED/taught the studio: counts by kind (heard songs, lyric craft, trends, self-training), top genres, the most recent learnings, and exactly WHERE each kind feeds generation. Call this when the user asks 'what have I taught you / what have you learned / what's in the data lake / did my training work / how does my training help my songs'. A dataLake summary is already in WORKSPACE_CONTEXT for quick answers; call this for the detailed breakdown.",
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function' as const,
    name: 'make_material_beat',
    description:
      "AI-AUTOMATIC 'exact beat' from real, rights-classified loops: it FORGES whatever the genre's kit is missing (drums, talking drum, log drum, bass, African percussion, chords) under the connected provider's terms AND then ASSEMBLES the beat — all by itself, no manual forge-then-assemble. Use this whenever the user wants a beat from real material / 'the exact beat' / the material layer. ALWAYS prefer this over calling forge_materials and assemble_beat separately.",
    parameters: {
      type: 'object',
      properties: {
        genre: { type: 'string', description: 'defaults to the project genre' },
        bpm: { type: 'integer', description: 'defaults to the project/genre bpm' },
        vibe: { type: 'string', description: 'optional mood/energy for the arrangement' },
      },
    },
  },
  {
    type: 'function' as const,
    name: 'forge_materials',
    description:
      "MATERIAL LAYER step 1: forge ISOLATED loops (solo drums / log drum / bass / percussion / chord bed) under the connected provider's terms for a genre into the material library — melodic loops in key. Use when the user wants 'the exact beat' or real arranged material and the library is empty for that genre.",
    parameters: {
      type: 'object',
      properties: { genre: { type: 'string' }, bpm: { type: 'integer', default: 108 }, keySignature: { type: 'string', description: "e.g. 'B minor' — defaults to the genre's home key" } },
      required: ['genre'],
    },
  },
  {
    type: 'function' as const,
    name: 'assemble_beat',
    description:
      "MATERIAL LAYER step 2: ASSEMBLE the exact beat — Claude arranges real loops from the material library (key-aware picks, time-stretched, layered per section — deterministic, not hallucinated). Needs forged/harvested material for the genre first (forge_materials).",
    parameters: {
      type: 'object',
      properties: { genre: { type: 'string' }, bpm: { type: 'integer', default: 108 }, keySignature: { type: 'string' }, vibe: { type: 'string', description: 'short arrangement direction, e.g. "slow build, big drop"' } },
      required: ['genre'],
    },
  },
  {
    type: 'function' as const,
    name: 'separate_stems',
    description:
      'Split a rendered song into a downloadable INSTRUMENTAL (mode=instrumental) or full stems — vocals/drums/bass/other (mode=full) for remixing. Use when the user wants the instrumental or stems.',
    parameters: {
      type: 'object',
      properties: { songId: { type: 'string' }, mode: { type: 'string', enum: ['instrumental', 'full'], default: 'instrumental' } },
    },
  },
  {
    type: 'function' as const,
    name: 'learn_lyrics',
    description:
      'STUDY pasted lyrics into the learning library: extracts the craft (hook mechanics, flow, repetition engine, code-switching, imagery field) — never stores the words. Use when the user pastes lyrics to LEARN FROM (teach the studio a style), not to sing verbatim. Future hooks/lyrics automatically pull from what was learned. AFTER learning, offer to immediately create a song that applies the lessons and OUTDOES the studied style (create_beat_job or run_drop with the craft genre + a theme built from the lessons).',
    parameters: {
      type: 'object',
      properties: { lyrics: { type: 'string' }, genreHint: { type: 'string' } },
      required: ['lyrics'],
    },
  },
  {
    type: 'function' as const,
    name: 'set_release_rights',
    description:
      'Save a draft split-sheet. Human acceptance and native-language review must be completed by a named workspace owner on the Release screen.',
    parameters: {
      type: 'object',
      properties: {
        songId: { type: 'string' },
        splitSheet: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' }, share: { type: 'number' } } } },
      },
      required: ['songId'],
    },
  },
  {
    type: 'function' as const,
    name: 'feature_on_landing',
    description:
      'Pin a finished song onto the public landing wall so visitors can play it right there (or unpin it). House curation only; refuses songs with no playable audio.',
    parameters: {
      type: 'object',
      properties: {
        songId: { type: 'string' },
        featured: { type: 'boolean', description: 'true to pin, false to remove; omit to toggle' },
      },
      required: ['songId'],
    },
  },
  {
    type: 'function' as const,
    name: 'get_download_links',
    description:
      "List a song's downloadable files (current audio, master, mix, beat, instrumental, acapella, stems) with short-lived download URLs.",
    parameters: {
      type: 'object',
      properties: { songId: { type: 'string' } },
      required: ['songId'],
    },
  },
  {
    type: 'function' as const,
    name: 'request_approval',
    description: 'Ask the user to approve a gate (brief|hook|lyrics|beat|voice|mix|rights|release).',
    parameters: {
      type: 'object',
      properties: {
        gate: {
          type: 'string',
          enum: ['brief', 'hook', 'lyrics', 'beat', 'voice', 'mix', 'rights', 'release'],
        },
        note: { type: 'string' },
      },
      required: ['gate'],
    },
  },
] as const;

