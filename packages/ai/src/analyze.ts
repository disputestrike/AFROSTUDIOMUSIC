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
  // DEEP PRODUCTION — the "learn the beats/drums/flow" fields (the actual craft).
  drums: string | null; // kick/snare/hats pattern + feel
  percussion: string | null; // shakers/congas/log-drum/talking-drum + fills
  bass: string | null; // bass character + movement
  groove: string | null; // pocket/swing/timing feel
  arrangement: string | null; // how it builds — intro/verse/hook dynamics, drops, fills
  flow: string | null; // vocal cadence/rhythm/ad-lib style
  complexity: string | null; // how layered/produced it is
  vibe: string; // one-line summary of what it sounds like
  suggestedVibePrompt: string; // vivid prompt to make a FRESH original in this style
  learnedRecipe: string; // full production recipe text, ready to inject into generation
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
    'You are a top Afrobeats producer analyzing this record so it can be recreated in the same STYLE (not copied). Describe precisely and specifically: ' +
    '1) tempo BPM, musical key, genre/subgenre, mood, energy. ' +
    '2) DRUMS — the kick/snare/clap/hi-hat pattern and feel (four-on-floor? off-beat? backbeat?). ' +
    '3) PERCUSSION — shakers, congas, log drum, talking drum, and any rolls/fills before the hook or sections. ' +
    '4) BASS — its character and how it moves. ' +
    '5) GROOVE — the pocket/swing/timing feel. ' +
    '6) ARRANGEMENT — how it builds (intro, verse, pre-hook, hook, bridge), where it strips back or drops, the dynamics. ' +
    '7) INSTRUMENTS — the melodic instruments and textures. ' +
    '8) VOCAL — male/female/group/instrumental, the tone & delivery, the flow/cadence & ad-lib style, and language(s). ' +
    'Be concrete and detailed — a producer must be able to rebuild the sound from your description.';
  // Run the model, retrying transient Replicate failures (CUDA OOM / capacity on
  // the shared GPU) so a blip doesn't kill the listen. Up to 3 attempts.
  const isTransient = (e: string) => /out of memory|cuda|capacity|timeout|503|429|unavailable|please try again|processing|starting/i.test(e);
  let pred: ReplicatePred | null = null;
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 5000));
    const create = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', prefer: 'wait' },
      body: JSON.stringify({ version, input: { prompt: question, audio: url } }),
    });
    if (!create.ok) {
      lastErr = `create ${create.status}: ${(await create.text()).slice(0, 160)}`;
      if (isTransient(lastErr)) continue;
      throw new Error(`audio analyze ${lastErr}`);
    }
    let p = (await create.json()) as ReplicatePred;
    // Poll up to ~180s per attempt — Qwen cold-starts run 90-120s.
    for (let i = 0; i < 45 && (p.status === 'starting' || p.status === 'processing'); i++) {
      await new Promise((r) => setTimeout(r, 4000));
      p = (await (await fetch(`https://api.replicate.com/v1/predictions/${p.id}`, { headers: auth })).json()) as ReplicatePred;
    }
    if (p.status === 'succeeded') { pred = p; break; }
    lastErr = String(p.error ?? p.status);
    if (!isTransient(lastErr)) throw new Error(`audio analyze ${p.status}: ${lastErr}`);
  }
  if (!pred) throw new Error(`audio analyze failed after retries: ${lastErr}`);

  const raw = extractText(pred.output);

  // Structure the free-text description into a clean, usable profile. If the
  // structuring model is unavailable, still return the raw description so the
  // "listen" feature works and you can create from it.
  try {
    const structured = await responsesJson<Omit<AudioProfile, 'raw'>>({
      system:
        'Turn a producer\'s music analysis into strict JSON. Fields: bpm (number|null), key (string|null), genre (string|null), mood (string|null), energy (string|null), instruments (string[]), vocalGender ("male"|"female"|"group"|"instrumental"|null), vocalStyle (string|null), language (string|null), drums (string|null: the kick/snare/hat pattern & feel), percussion (string|null: shakers/congas/log-drum/talking-drum + fills), bass (string|null), groove (string|null: pocket/swing), arrangement (string|null: how it builds/drops), flow (string|null: vocal cadence & ad-lib style), complexity (string|null: how layered/produced), vibe (one-line), suggestedVibePrompt (vivid prompt to make a FRESH ORIGINAL in this style, matching the vocal + groove, never copying/naming the source), learnedRecipe (a detailed multi-line production recipe combining the drums/percussion/bass/groove/arrangement/flow so a generator can rebuild this SOUND). Return only JSON.',
      user: `Producer analysis: ${raw}`,
      temperature: 0.3,
      maxOutputTokens: 1400,
    });
    return { ...structured, raw };
  } catch {
    return {
      bpm: null, key: null, genre: null, mood: null, energy: null, instruments: [],
      vocalGender: null, vocalStyle: null, language: null,
      drums: null, percussion: null, bass: null, groove: null, arrangement: null, flow: null, complexity: null,
      vibe: raw.slice(0, 200),
      suggestedVibePrompt: `Fresh original song in the style of: ${raw.slice(0, 300)}`,
      learnedRecipe: raw.slice(0, 1200),
      raw,
    };
  }
}
