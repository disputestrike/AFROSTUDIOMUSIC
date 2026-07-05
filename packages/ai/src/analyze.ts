/**
 * Listen to a track and UNDERSTAND it (Shazam-style "it hears the song").
 *
 * RESILIENT, LAYERED design — no single contended GPU model can break the listen:
 *   1. Transcription (Whisper) — the single most reliable Replicate model. Gives
 *      the lyrics, the language, and whether there's a vocal at all. Always warm.
 *   2. Rich audio description (Qwen-Omni etc.) — OPT-IN enrichment. It reads the
 *      drums/groove when available, but it OOMs on Replicate's shared GPUs, so it
 *      is attempted only when explicitly configured and NEVER fatal.
 *   3. Objective ffmpeg metrics (duration/loudness/dynamics) — passed in by the
 *      worker (which has ffmpeg). Free, deterministic, always available.
 *   4. Claude synthesis — combines the above (+ the user's genre) into a producer
 *      recipe you can create FROM. Never a copy.
 *
 * If the rich model is down, the listen still works from transcript + metrics +
 * genre. It degrades; it does not fail.
 */
import { responsesJson } from './providers/text';
import { generateJson } from './generate';
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
  raw: string; // the source signals we heard (transcript + any rich description)
}

/** Objective metrics computed by the worker (ffmpeg) and handed to the analyzer. */
export interface AnalyzeMetrics {
  durationS?: number | null;
  integratedLufs?: number | null;
  loudnessRangeLra?: number | null;
  crestFactorDb?: number | null;
}

export interface AnalyzeContext {
  genreHint?: string | null; // the genre the user says this is (their own upload)
  metrics?: AnalyzeMetrics | null;
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
    const o = output as { text?: string; transcription?: string };
    return o.transcription ?? o.text ?? JSON.stringify(output);
  }
  return String(output ?? '');
}

/** Resolve a community model's latest version id at runtime (no hardcoded hash). */
async function latestVersion(slug: string, auth: Record<string, string>): Promise<string> {
  const m = await fetch(`https://api.replicate.com/v1/models/${slug}`, { headers: auth });
  if (!m.ok) throw new Error(`model lookup ${slug} ${m.status}: ${(await m.text()).slice(0, 120)}`);
  const v = ((await m.json()) as { latest_version?: { id?: string } }).latest_version?.id;
  if (!v) throw new Error(`model ${slug} has no version`);
  return v;
}

/** Run a Replicate prediction to completion. Throws on failure (caller decides fatality). */
async function runPrediction(
  version: string,
  input: Record<string, unknown>,
  auth: Record<string, string>,
  maxPolls: number
): Promise<unknown> {
  const create = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', prefer: 'wait' },
    body: JSON.stringify({ version, input }),
  });
  if (!create.ok) throw new Error(`create ${create.status}: ${(await create.text()).slice(0, 160)}`);
  let p = (await create.json()) as ReplicatePred;
  for (let i = 0; i < maxPolls && (p.status === 'starting' || p.status === 'processing'); i++) {
    await new Promise((r) => setTimeout(r, 4000));
    p = (await (await fetch(`https://api.replicate.com/v1/predictions/${p.id}`, { headers: auth })).json()) as ReplicatePred;
  }
  if (p.status !== 'succeeded') throw new Error(`${p.status}: ${String(p.error ?? 'no output')}`);
  return p.output;
}

/**
 * LAYER 1 — Transcribe (Whisper). Reliable + always warm. Returns the lyrics,
 * detected language, and vocal-presence. Non-fatal: null on any failure.
 */
async function transcribe(url: string, auth: Record<string, string>): Promise<{ text: string; language: string | null } | null> {
  try {
    const slug = process.env.REPLICATE_TRANSCRIBE_MODEL ?? 'openai/whisper';
    const version = process.env.REPLICATE_TRANSCRIBE_VERSION ?? (await latestVersion(slug, auth));
    // Minimal input — every whisper version accepts `audio`; extra fields risk a
    // 422 that would silently null the transcript. Wider poll for GPU cold starts.
    const output = await runPrediction(version, { audio: url }, auth, 45);
    const text = extractText(output).trim();
    let language: string | null = null;
    if (output && typeof output === 'object') {
      const o = output as { detected_language?: string; language?: string };
      language = o.detected_language ?? o.language ?? null;
    }
    return { text, language };
  } catch {
    return null;
  }
}

/**
 * LAYER 2 — Rich audio description (the drums/groove reader). OPT-IN only: set
 * REPLICATE_AUDIO_UNDERSTAND_MODEL to a reliable deployment to enable it. It is
 * skipped by default because the 7B omni model OOMs on Replicate's shared GPUs.
 * Always non-fatal.
 */
async function richDescribe(url: string, auth: Record<string, string>): Promise<string | null> {
  const slug = process.env.REPLICATE_AUDIO_UNDERSTAND_MODEL;
  if (!slug) return null; // disabled unless an operator wires a working model
  try {
    const version = process.env.REPLICATE_AUDIO_UNDERSTAND_VERSION ?? (await latestVersion(slug, auth));
    const question =
      'You are a top Afrobeats producer. Describe this record precisely so it can be recreated in the same STYLE (not copied): ' +
      'tempo BPM, key, genre/subgenre, mood, energy; DRUMS (kick/snare/clap/hi-hat pattern & feel); ' +
      'PERCUSSION (shakers, congas, log drum, talking drum, rolls/fills before sections); BASS (character & movement); ' +
      'GROOVE (pocket/swing/timing); ARRANGEMENT (how it builds, where it drops/strips back); INSTRUMENTS; ' +
      'VOCAL (male/female/group/instrumental, tone & delivery, flow/cadence & ad-libs, language). Be concrete.';
    const output = await runPrediction(version, { prompt: question, audio: url }, auth, 30);
    const text = extractText(output).trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function analyzeAudio(url: string, apiKey?: string, ctx?: AnalyzeContext): Promise<AudioProfile> {
  const token = apiKey || replicateToken();
  if (!token) throw new Error('REPLICATE_API_TOKEN missing — connect your music engine first');
  const auth = { authorization: `Bearer ${token}` };

  // Run the two listening layers in parallel; both are non-fatal.
  const [transcript, richText] = await Promise.all([transcribe(url, auth), richDescribe(url, auth)]);

  const m = ctx?.metrics ?? {};
  const hasVocal = !!(transcript && transcript.text && transcript.text.replace(/\s/g, '').length > 8);

  // Assemble every objective signal we actually observed — this is the honest
  // evidence Claude reasons from (it never invents what it couldn't hear).
  const signals: string[] = [];
  if (ctx?.genreHint) signals.push(`Stated genre (from the uploader): ${ctx.genreHint}`);
  if (m.durationS) signals.push(`Duration: ${m.durationS}s`);
  if (m.integratedLufs != null) signals.push(`Integrated loudness: ${m.integratedLufs} LUFS`);
  if (m.loudnessRangeLra != null) signals.push(`Loudness range (dynamics): ${m.loudnessRangeLra} LU (low = flat/steady, high = dynamic arrangement)`);
  if (m.crestFactorDb != null) signals.push(`Crest factor: ${m.crestFactorDb} dB (low = squashed, high = punchy/dynamic)`);
  signals.push(`Vocal present: ${hasVocal ? 'yes' : 'no (likely instrumental)'}`);
  if (transcript?.language) signals.push(`Detected language: ${transcript.language}`);
  if (transcript?.text) signals.push(`Transcript (lyrics heard):\n${transcript.text.slice(0, 1500)}`);
  if (richText) signals.push(`Producer's ear (audio model description):\n${richText.slice(0, 2000)}`);

  const raw = signals.join('\n');
  if (!transcript && !richText && !m.durationS && !ctx?.genreHint) {
    throw new Error('audio analyze failed: no signal (transcription, audio model, and metrics all unavailable)');
  }

  const system =
    'You are a world-class Afro/global music producer turning observed evidence about a record into a strict-JSON production profile ' +
    'that a generator can build a FRESH ORIGINAL from (never a copy, never naming the source). ' +
    'Reason from the evidence: the transcript tells you language, flow and theme; loudness range/crest tell you how dynamic vs flat it is; ' +
    'the stated genre anchors typical BPM, drums, percussion, bass and arrangement; the audio-model description (if present) is your most direct read of the drums/groove. ' +
    'Where you must estimate (e.g. BPM/key with no detector), give the typical value for that genre and keep it plausible — do not fabricate specifics you have no basis for. ' +
    'Return ONLY JSON with fields: bpm (number|null), key (string|null), genre (string|null), mood (string|null), energy (string|null), ' +
    'instruments (string[]), vocalGender ("male"|"female"|"group"|"instrumental"|null), vocalStyle (string|null), language (string|null), ' +
    'drums (string|null), percussion (string|null), bass (string|null), groove (string|null), arrangement (string|null), flow (string|null), complexity (string|null), ' +
    'vibe (one line), suggestedVibePrompt (vivid prompt for a fresh original in this style, matching the vocal + groove, never naming/copying the source), ' +
    'learnedRecipe (a detailed multi-line production recipe combining drums/percussion/bass/groove/arrangement/flow so a generator can rebuild this SOUND).';

  try {
    const structured = await generateJson<Omit<AudioProfile, 'raw'>>({
      system,
      user: `Observed evidence about the record:\n${raw}`,
      temperature: 0.3,
      maxTokens: 1500,
    });
    return { ...structured, raw };
  } catch {
    // Last-resort structuring via the OpenAI JSON path, then a plain fallback.
    try {
      const structured = await responsesJson<Omit<AudioProfile, 'raw'>>({
        system,
        user: `Observed evidence about the record:\n${raw}`,
        temperature: 0.3,
        maxOutputTokens: 1400,
      });
      return { ...structured, raw };
    } catch {
      return {
        bpm: null, key: null, genre: ctx?.genreHint ?? null, mood: null, energy: null, instruments: [],
        vocalGender: hasVocal ? null : 'instrumental', vocalStyle: null, language: transcript?.language ?? null,
        drums: null, percussion: null, bass: null, groove: null, arrangement: null, flow: null, complexity: null,
        vibe: (richText ?? transcript?.text ?? ctx?.genreHint ?? 'analyzed reference').slice(0, 200),
        suggestedVibePrompt: `Fresh original ${ctx?.genreHint ?? ''} song in the style heard: ${(richText ?? transcript?.text ?? '').slice(0, 280)}`.trim(),
        learnedRecipe: raw.slice(0, 1500),
        raw,
      };
    }
  }
}
