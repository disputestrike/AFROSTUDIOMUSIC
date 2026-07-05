/**
 * Listen to a track and UNDERSTAND it (Shazam-style "it hears the song").
 *
 * Uses a Replicate audio-language model (Qwen2.5-Omni) to actually listen to
 * the audio, then structures what it heard into a vibe profile you can create
 * FROM — never a copy. Runs on the same Replicate key as the beat/vocal models.
 */
import { responsesJson } from './providers/text';
import { replicateToken } from './providers/music';

export interface AudioProfile {
  bpm: number | null;
  key: string | null;
  genre: string | null;
  mood: string | null;
  energy: string | null;
  instruments: string[];
  // VOICE — so a created song matches the vocal it heard, not just the tempo.
  vocalGender: string | null; // "male" | "female" | "group" | "instrumental" | null
  vocalStyle: string | null; // tone/delivery, e.g. "smooth melodic tenor, laid-back"
  language: string | null; // language(s) heard, e.g. "pidgin/yoruba"
  vibe: string; // one-line summary of what it sounds like
  suggestedVibePrompt: string; // vivid prompt to make a FRESH original in this style
  raw: string; // the model's raw description
}

interface ReplicatePred {
  id: string;
  status: string;
  output?: unknown;
  error?: string | null;
}

function extractText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.map((o) => (typeof o === 'string' ? o : '')).join(' ').trim();
  if (output && typeof output === 'object') {
    const o = output as { text?: string };
    return o.text ?? JSON.stringify(output);
  }
  return String(output ?? '');
}

export async function analyzeAudio(url: string, apiKey?: string): Promise<AudioProfile> {
  const token = apiKey || replicateToken();
  if (!token) throw new Error('REPLICATE_API_TOKEN missing — connect your music engine first');
  const auth = { authorization: `Bearer ${token}` };

  // Resolve the audio-understanding model version (community model).
  const slug = process.env.REPLICATE_AUDIO_UNDERSTAND_MODEL ?? 'lucataco/qwen2.5-omni-7b';
  let version = process.env.REPLICATE_AUDIO_UNDERSTAND_VERSION;
  if (!version) {
    const m = await fetch(`https://api.replicate.com/v1/models/${slug}`, { headers: auth });
    if (!m.ok) throw new Error(`audio model lookup ${m.status}: ${(await m.text()).slice(0, 160)}`);
    version = ((await m.json()) as { latest_version?: { id?: string } }).latest_version?.id;
    if (!version) throw new Error('audio model has no version');
  }

  const question =
    'Listen to this music and describe it precisely for a producer: tempo in BPM, musical key, genre/subgenre, mood, energy level (low/medium/high), and the main instruments you hear. ALSO describe the VOCAL: is the lead voice male, female, a group, or is it instrumental? Describe the vocal tone and delivery (e.g. smooth melodic tenor, raspy, chant, auto-tuned), and what language(s) are sung. Be concise and specific.';
  const create = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', prefer: 'wait' },
    body: JSON.stringify({ version, input: { prompt: question, audio: url } }),
  });
  if (!create.ok) throw new Error(`audio analyze ${create.status}: ${(await create.text()).slice(0, 200)}`);

  let pred = (await create.json()) as ReplicatePred;
  for (let i = 0; i < 15 && (pred.status === 'starting' || pred.status === 'processing'); i++) {
    await new Promise((r) => setTimeout(r, 4000));
    pred = (await (await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, { headers: auth })).json()) as ReplicatePred;
  }
  if (pred.status !== 'succeeded') throw new Error(`audio analyze ${pred.status}: ${pred.error ?? ''}`);

  const raw = extractText(pred.output);

  // Structure the free-text description into a clean, usable profile. If the
  // structuring model is unavailable, still return the raw description so the
  // "listen" feature works and you can create from it.
  try {
    const structured = await responsesJson<Omit<AudioProfile, 'raw'>>({
      system:
        'Turn a music description into strict JSON. Fields: bpm (number or null), key (string or null), genre (string or null), mood (string or null), energy (string or null), instruments (string[]), vocalGender ("male"|"female"|"group"|"instrumental"|null), vocalStyle (tone/delivery string or null), language (language(s) sung, string or null), vibe (one-line summary), suggestedVibePrompt (a vivid prompt to generate a FRESH, ORIGINAL song in this style that MATCHES the vocal character described — same voice type/tone/energy/language — but never copies or names the source track). Return only JSON.',
      user: `Music description: ${raw}`,
      temperature: 0.3,
      maxOutputTokens: 800,
    });
    return { ...structured, raw };
  } catch {
    return {
      bpm: null,
      key: null,
      genre: null,
      mood: null,
      energy: null,
      instruments: [],
      vocalGender: null,
      vocalStyle: null,
      language: null,
      vibe: raw.slice(0, 200),
      suggestedVibePrompt: `Fresh original song in the style of: ${raw.slice(0, 300)}`,
      raw,
    };
  }
}
