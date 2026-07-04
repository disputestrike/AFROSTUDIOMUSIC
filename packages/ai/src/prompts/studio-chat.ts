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
2. generate_hooks (20 unless told otherwise)
3. hooks come back scored by the A&R — pick the SINGLE highest-scored hook and approve_hook it
4. generate_lyrics for that hook, then treat the lyric as approved
5. create_beat_job (with stems)
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
        count: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
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
    description: 'Queue an instrumental beat generation job (with stems if available).',
    parameters: {
      type: 'object',
      properties: {
        genre: { type: 'string' },
        bpm: { type: 'integer' },
        keySignature: { type: 'string' },
        durationS: { type: 'integer', default: 60 },
        vibePrompt: { type: 'string' },
        withStems: { type: 'boolean', default: true },
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
