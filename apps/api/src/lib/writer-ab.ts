/**
 * WRITER A/B — settle "which brain writes better" with the EAR, not the brand.
 *
 * Runs the identical writing chain twice — same hook, same fused brief, same
 * HIT-ENGINE system prompt, same craft-polish pass — once on the Claude path,
 * once on the OpenAI path (OPENAI_TEXT_MODEL decides which GPT). Returns the
 * two lyrics BLIND (shuffled A/B) plus a base64 reveal the judge opens only
 * after picking. Doctrine §1.5: the owner's ear outranks — this is its bench.
 */
import { generateJson, prompts } from '@afrohit/ai';
import { laneDnaBrief } from './lane-pipeline';
import { lexiconPalette } from './lexicon';
import { fuseSoundDna } from './fuse';

interface AbInput {
  workspaceId: string;
  genre: string;
  mood?: string;
  languages?: string[];
  theme?: string;
  hookText?: string;
}

interface LyricOut { title: string; body: string; cleanVersion?: string }

async function writeOnBrain(brain: 'claude' | 'openai', input: AbInput, hookText: string, soundDna: string): Promise<LyricOut | null> {
  const artist = { stageName: 'BENXP', languages: input.languages ?? ['pcm', 'en'], vocalTone: ['smooth'], laneSummary: `${input.genre} lane` };
  const user = prompts.lyricUserPrompt({
    artist: artist as never,
    brief: { mood: input.mood ?? 'love', rawIdea: input.theme ?? '' } as never,
    hookText,
    cleanVersion: true,
    languages: input.languages ?? ['pcm', 'en'],
    soundDna,
  });
  const draft = await generateJson<LyricOut>({
    system: prompts.LYRIC_SYSTEM,
    user,
    temperature: 0.8,
    maxTokens: 4_500,
    timeoutMs: 90_000,
    brain,
    task: `ab-draft-${brain}`,
  }).catch(() => null);
  if (!draft?.body || draft.body.trim().length < 100) return draft;
  // Same polish stage each side runs in production — the model is the ONLY variable.
  const polished = await generateJson<LyricOut>({
    system: prompts.LYRIC_POLISH_SYSTEM,
    user: prompts.lyricPolishPrompt({ draftTitle: draft.title, draftBody: draft.body, genre: input.genre, mood: input.mood, languages: input.languages }),
    temperature: 0.7,
    maxTokens: 4_500,
    timeoutMs: 90_000,
    brain,
    task: `ab-polish-${brain}`,
  }).catch(() => null);
  return polished?.body && polished.body.length > 200 ? { ...draft, ...polished } : draft;
}

export async function runWriterAb(input: AbInput): Promise<{ blind: Array<{ label: 'A' | 'B'; title: string; body: string }>; reveal: string; hookText: string } | { error: string }> {
  // ONE shared hook so both sides write the SAME song — bulk tier (owner's cost
  // law: hook DRAFTS are heavy lifting); the bench measures the WRITERS, not the hook.
  const hookText = input.hookText?.trim() || (
    await generateJson<{ hooks?: Array<{ text: string }> }>({
      tier: 'bulk',
      system: prompts.HOOK_SYSTEM,
      user: `Write 1 hook for a ${input.genre} song. Mood: ${input.mood ?? 'love'}. Languages: ${(input.languages ?? ['pcm', 'en']).join(' + ')}. Theme: ${input.theme ?? 'a fresh original'}. Return {"hooks":[{"text"}]}.`,
      maxTokens: 600,
      task: 'ab-hook',
    }).catch(() => null)
  )?.hooks?.[0]?.text;
  if (!hookText) return { error: 'hook_generation_failed' };

  const soundDna = fuseSoundDna({
    palette: await lexiconPalette({ workspaceId: input.workspaceId, languages: input.languages, mood: input.mood, rotate: 7 }),
    dna: laneDnaBrief(input.genre),
    hitCraft: prompts.hitCraftBrief('lyric', input.mood),
  }, 6000);

  const [claude, openai] = await Promise.all([
    writeOnBrain('claude', input, hookText, soundDna),
    writeOnBrain('openai', input, hookText, soundDna),
  ]);
  if (!claude?.body && !openai?.body) return { error: 'both_writers_failed — check ANTHROPIC + OPENAI billing/keys' };
  if (!claude?.body) return { error: 'claude_writer_failed — its side is empty; fix before judging' };
  if (!openai?.body) return { error: 'openai_writer_failed — check OPENAI_API_KEY billing + OPENAI_TEXT_MODEL' };

  // Blind shuffle — the judge must not know whose is whose until after picking.
  const flip = (claude.body.length + openai.body.length) % 2 === 0;
  const a = flip ? claude : openai;
  const b = flip ? openai : claude;
  return {
    hookText,
    blind: [
      { label: 'A', title: a.title, body: a.body },
      { label: 'B', title: b.title, body: b.body },
    ],
    reveal: Buffer.from(`A=${flip ? 'claude' : 'openai'}, B=${flip ? 'openai' : 'claude'}`).toString('base64'),
  };
}
