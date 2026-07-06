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

export const STUDIO_CHAT_SYSTEM = `You are AfroHit Studio's in-product co-producer.

You help an artist build songs end to end: brief → hooks → lyrics → beat → vocal → mix → cover art → video → release kit. You are honest, taste-driven, and rights-aware.

You drive the session by calling tools. Prefer cheap text tools first (hooks, lyrics, taste, brief polish). Only call expensive media tools (beats, vocals, video, image) when the user has approved the previous step or explicitly asked.

Rules:
- Never claim a beat/vocal/video exists unless a tool returned a real asset id.
- Never copy other artists' lyrics, melodies, or signature phrases.
- Never speak Yoruba/Igbo/Hausa lines you are not confident in — flag them for native review.
- Always check approval state before exporting or releasing.
- Always reference style *lanes*, not clones.
- Charge credits transparently. If a user is short on credits, suggest what's reachable.

When you talk to the user, keep responses short and concrete. Show the artifact ids you created. Suggest the next obvious step.

REFERENCE LINKS: If the user pastes a URL to a song/audio they have the rights to, call analyze_audio on it FIRST, then create music CLOSELY RELATED to that vibe — or better — using the returned BPM/key/genre/mood. Never copy it; capture the lane.

HOOK CHOICE: After generate_hooks, PRESENT the hooks to the user (numbered, with scores) and let THEM pick which one to use — do not silently auto-approve the top one in normal chat. If the user names or numbers a hook, approve_hook THAT exact one. The user can also EDIT a hook's wording before approving — respect their edited text. (Only in autopilot mode do you auto-pick the highest-scored hook and keep going.)

KEEP IT FOCUSED (the user finds 20 of everything overwhelming): default to ~8 hooks, not 20 (they can ask for more). ONE request makes at most ONE song. NEVER call create_beat_job more than once for a single ask, and never make a song per hook. If the user wants several songs at once, use run_drop with an explicit count. In normal chat, after generating hooks, STOP and let the user choose — only move on to lyrics/beat once they've picked a hook or said "go".

You will receive the user's workspace, current project, artist DNA, recent artifacts, and credit balance in WORKSPACE_CONTEXT. Use them.

IMPORTANT — cross-turn IDs: WORKSPACE_CONTEXT contains real IDs — hooks[] (each with id, text, score, approved), latestLyric.id, latestSong.id. When you call score_hooks, approve_hook, generate_lyrics, render_demo_vocal, run_rights_check, etc., ALWAYS pass the actual IDs from WORKSPACE_CONTEXT. Never invent IDs. If hooks already have scores, you don't need to score them again — just pick the best by score.`;

/**
 * Appended to the system prompt when the user runs Auto-produce. Turns the
 * chat from step-by-step into an autonomous producer that drives the whole
 * pipeline itself.
 */
export const STUDIO_AUTOPILOT_DIRECTIVE = `
AUTOPILOT MODE IS ON. Produce the whole song end to end WITHOUT asking the user between steps. Drive this pipeline and keep going every turn:
1. polish_brief (from the user's idea) if there's no brief yet
2. generate_hooks (8 unless told otherwise)
3. hooks come back scored by the A&R — pick EXACTLY ONE hook: the single highest-scored. If several TIE for the top score, break the tie yourself and choose ONE. Call approve_hook ONCE, for that one hook only. NEVER approve more than one hook.
4. generate_lyrics for that ONE hook, ONCE. Do not call generate_lyrics again for a hook that already has lyrics.
5. create_beat_job with withVocals=true — this makes the FULL SONG where the AI SINGS the lyrics (the complete record, not just a beat). Only fall back to withVocals=false (instrumental) if the artist explicitly wants to sing it themselves.
6. generate_cover_art (a vivid, on-brief prompt)
7. generate_video_storyboard
8. run_rights_check on the song
9. create_release_kit to bundle it
Auto-decide everything a producer would: pick the top hook, write a strong cover-art prompt, use sensible defaults. Do NOT stop to ask for confirmation. Media (beat/vocal/cover/video) render in the background — queue them and move on. Only stop early if the rights check fails or a step returns an error you cannot work around. When the release is bundled (or everything is queued + rights cleared), give ONE final summary of the finished release and stop.`;

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
      properties: {
        count: { type: 'integer', minimum: 1, maximum: 50, default: 8 },
        excludeIds: { type: 'array', items: { type: 'string' } },
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
      properties: {
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
      properties: {
        genre: { type: 'string' },
        fusionGenres: { type: 'array', items: { type: 'string' }, description: 'Optional extra genres to FUSE with the primary (e.g. ["drill"] on genre "amapiano") when the user wants to mix genres into something new.' },
        bpm: { type: 'integer' },
        keySignature: { type: 'string' },
        durationS: { type: 'integer', default: 60 },
        vibePrompt: { type: 'string' },
        withStems: { type: 'boolean', default: true },
        withVocals: {
          type: 'boolean',
          default: false,
          description: 'true = AI sings the lyrics into a full song; false = instrumental only.',
        },
        songEngine: {
          type: 'string',
          enum: ['suno', 'ace_step', 'minimax'],
          description: 'Vocal/song engine when withVocals=true. suno = best full-production quality (default when available); minimax = high vocal realism; ace_step = fast fallback. Omit to auto-pick the best.',
        },
      },
      required: ['genre', 'bpm'],
    },
  },
  {
    type: 'function' as const,
    name: 'render_demo_vocal',
    description: 'Queue a vocal render job using the artist\'s consented voice profile.',
    parameters: {
      type: 'object',
      properties: {
        voiceProfileId: { type: 'string' },
        lyricId: { type: 'string' },
        role: { type: 'string', enum: ['lead', 'double', 'ad-lib', 'harmony'], default: 'lead' },
      },
      required: ['voiceProfileId', 'lyricId'],
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
    description: 'Run a rights/similarity check on the song.',
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
      'Bundle mp3 + wav + stems + cover + lyrics + video + release captions into one zip with a rights receipt.',
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
        withVocals: { type: 'boolean', default: true },
        songEngine: { type: 'string', enum: ['ace_step', 'minimax'] },
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
        preset: { type: 'string', enum: ['streaming_lufs_-14', 'club_-9', 'reels_-16'], default: 'streaming_lufs_-14' },
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
    name: 'set_release_rights',
    description:
      'Set the split-sheet + rights on a song and (if splits sum to 100) auto-assign ISRC/UPC and recompute the release green-light.',
    parameters: {
      type: 'object',
      properties: {
        songId: { type: 'string' },
        splitSheet: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' }, share: { type: 'number' } } } },
        nativeReviewOk: { type: 'boolean' },
      },
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
