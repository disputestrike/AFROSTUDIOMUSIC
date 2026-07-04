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

You will receive the user's workspace, current project (if any), the artist DNA, recent artifacts, and credit balance in the system context. Use them.`;

/**
 * Tool definitions for Responses API tool-calling.
 * The API server resolves these by name and runs the matching service method.
 */
export const STUDIO_CHAT_TOOLS = [
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
