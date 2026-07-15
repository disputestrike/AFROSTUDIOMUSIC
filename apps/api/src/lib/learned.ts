import { prisma } from '@afrohit/db';
import { GENRES, genreSignature, learnedGenreMatches, selectLearnedRefs } from '@afrohit/shared';

/**
 * The "listen & learn" retrieval — rebuilt for FIDELITY:
 *
 *  1. The artist's OWN material (uploads + listens) always outranks self-training
 *     rows (source:'generated') — the machine's own output can season the brief
 *     but never bury the artist's real sound.
 *  2. Genre matching is tolerant ("Afro Fusion" ≈ "afro_fusion" ≈ "afrofusion")
 *     so historical rows and free-text model genres still retrieve.
 *  3. The RICH recipe fields (drums/percussion/bass/groove/flow/arrangement/bpm/
 *     vocal) drive the brief — not just the one-line summary.
 *  4. learnedStyleTags() gives terse tokens for the MUSIC MODEL itself, so what
 *     was heard shapes the AUDIO, not only the words.
 */

export interface RecipeShape {
  source?: string;
  drums?: string | null;
  percussion?: string | null;
  bass?: string | null;
  groove?: string | null;
  flow?: string | null;
  arrangement?: string | null;
  vocalStyle?: string | null;
  vocalGender?: string | null;
  bpm?: number | null;
  key?: string | null;
  learnedRecipe?: string | null;
  title?: string | null;
  artist?: string | null;
  craft?: string[] | null;
  identitySafe?: boolean;
  /** DSP MeasuredAnalysis when the ear actually ran (engineOk=true). The
   *  genuinely reference-specific signal — distinct from the LLM prose above. */
  measured?: {
    engineOk?: boolean;
    tempoBpm?: { value?: number | null };
    key?: { value?: string | null };
    mode?: { value?: string | null };
    swingRatio?: number | { value?: number | null };
    syncopationIndex?: number | { value?: number | null };
    logDrumLikelihood?: number | { value?: number | null };
    shakerContinuity?: number | { value?: number | null };
    introLengthBars?: number | { value?: number | null };
    firstDropAtS?: number | { value?: number | null };
  } | null;
}

export interface LearnedPromptReference {
  id: string;
  title: string | null;
  summary: string | null;
  genre: string | null;
  sourceUrl: string;
  createdAt: Date;
  recipe: RecipeShape;
  generated: boolean;
  zap: boolean;
}

type RefRow = LearnedPromptReference;
type SelectedRefRow = Omit<RefRow, 'recipe' | 'generated' | 'zap'> & { recipe: unknown };

export class PinnedLearnedReferenceUnavailableError extends Error {
  readonly code = 'pinned_reference_unavailable';

  constructor(readonly referenceId: string) {
    super('The selected learned reference is unavailable or is not eligible for generation.');
    this.name = 'PinnedLearnedReferenceUnavailableError';
  }
}

// Selection law now lives in @afrohit/shared (learned-select.ts) so the worker
// gate can PROVE lane isolation + pin-first + artist-over-machine without a DB.
const genreMatches = learnedGenreMatches;

async function fetchRefs(workspaceId: string, genre: string, pinnedId?: string | null): Promise<RefRow[]> {
  // The lake holds more than SOUND now (lyric craft, trend snapshots) — those
  // are excluded IN THE QUERY, not after take:60, so a growing lake can never
  // evict the artist's real heard/uploaded references from the window.
  const eligibilityWhere = {
    workspaceId,
    active: true,
    analysisState: { not: 'failed' },
    OR: [
      { rightsBasis: { in: ['user-attested', 'self-generated'] } },
      { rightsBasis: 'facts-only', sourceUrl: { startsWith: 'zap:' } },
    ],
    // Generic facts rows shape aggregate lane profiles only. Zap is the one
    // facts-only source admitted here, through its identity-free formatter.
    NOT: [{ sourceUrl: { startsWith: 'lyric:' } }, { sourceUrl: { startsWith: 'trend:' } }, { sourceUrl: { startsWith: 'facts:' } }],
  };
  const select = {
    id: true,
    title: true,
    summary: true,
    genre: true,
    sourceUrl: true,
    createdAt: true,
    recipe: true,
  } as const;
  const [recentRows, pinnedRow] = await Promise.all([
    prisma.soundReference.findMany({
      where: eligibilityWhere,
      orderBy: { createdAt: 'desc' },
      take: 60,
      select,
    }),
    pinnedId
      ? prisma.soundReference.findFirst({
          where: { ...eligibilityWhere, id: pinnedId },
          select,
        })
      : Promise.resolve(null),
  ]) as [SelectedRefRow[], SelectedRefRow | null];
  if (pinnedId && !pinnedRow) {
    throw new PinnedLearnedReferenceUnavailableError(pinnedId);
  }
  // A pin is a direct user choice, so it is fetched outside the rolling newest
  // window. Dedupe it when it also happens to be among those newest rows.
  const rows = pinnedRow
    ? [pinnedRow, ...recentRows.filter((row) => row.id !== pinnedRow.id)]
    : recentRows;
  const all: RefRow[] = rows.map((r: SelectedRefRow) => {
    const recipe = (r.recipe ?? {}) as RecipeShape;
    const zap = r.sourceUrl.startsWith('zap:') || recipe.source === 'zap';
    return { ...r, recipe, generated: recipe.source === 'generated', zap };
  });
  // Selection law (pin-first, in-genre only, artist over machine) lives in
  // shared learned-select.ts — the worker gate proves it holds. The seed
  // ROTATES which real refs teach each render ("184 unused references": the
  // seedless pick was the newest 3 forever, the rest of the lake sat idle).
  // Minute-grained so the brief + tags + usage receipt of ONE render agree.
  const varietySeed = Math.floor(Date.now() / 60_000);
  const artistRows = all.filter((r) => !r.zap && !r.generated);
  const selfRows = all.filter((r) => !r.zap && r.generated);
  const zaps = all.filter((r) => r.zap).map((r) => ({ ...r, generated: true }));
  const offset = zaps.length ? Math.abs(varietySeed) % zaps.length : 0;
  const rotatedZaps = [...zaps.slice(offset), ...zaps.slice(0, offset)];
  return selectLearnedRefs(
    [...artistRows, ...rotatedZaps, ...selfRows],
    genre,
    pinnedId,
    { varietySeed },
  );
}

function measuredValue<T>(fact: T | { value?: T | null } | null | undefined): T | undefined {
  if (fact == null) return undefined;
  if (typeof fact === 'object' && 'value' in fact) {
    return fact.value ?? undefined;
  }
  return fact as T;
}

function measuredPromptFacts(recipe: RecipeShape): string[] {
  const measured = recipe.measured;
  if (!measured?.engineOk) return [];
  const out: string[] = [];
  const tempo = measuredValue(measured.tempoBpm);
  const key = measuredValue(measured.key);
  const mode = measuredValue(measured.mode);
  const swing = measuredValue(measured.swingRatio);
  const syncopation = measuredValue(measured.syncopationIndex);
  const logDrum = measuredValue(measured.logDrumLikelihood);
  const shaker = measuredValue(measured.shakerContinuity);
  const introBars = measuredValue(measured.introLengthBars);
  const firstDrop = measuredValue(measured.firstDropAtS);
  if (typeof tempo === 'number' && Number.isFinite(tempo)) out.push(`${Math.round(tempo)} bpm (measured)`);
  if (key) out.push(`${key}${mode ? ` ${mode}` : ''} (measured key)`);
  if (typeof swing === 'number' && swing > 0.55) out.push('laid-back swung groove (measured)');
  if (typeof syncopation === 'number' && syncopation > 0.55) out.push('high syncopation (measured)');
  if (typeof logDrum === 'number' && logDrum > 0.5) out.push('deep log-drum sub-bass (measured)');
  if (typeof shaker === 'number' && shaker > 0.65) out.push('continuous shaker bed (measured)');
  if (typeof introBars === 'number' && introBars > 0) out.push(`${Math.round(introBars)}-bar intro (measured)`);
  if (typeof firstDrop === 'number' && firstDrop > 0) out.push(`first drop near ${Math.round(firstDrop)}s (measured)`);
  return out;
}

function knownGenreSignature(rawGenre?: string | null) {
  const genre = rawGenre?.toLowerCase().trim().replace(/[\s/-]+/g, '_') ?? '';
  if (!(GENRES as readonly string[]).includes(genre)) return null;
  return { genre, signature: genreSignature(genre) };
}

export function learnedReferenceLines(refs: RefRow[]): string[] {
  return refs
    .map((r) => {
      const rec = r.recipe;
      if (r.zap) {
        const known = knownGenreSignature(r.genre);
        const measuredFacts = measuredPromptFacts(rec);
        if (!known) {
          return measuredFacts.length
            ? `• ZAP MEASURED FACTS (song and artist identity removed; lane unresolved): ${measuredFacts.join(' · ').slice(0, 900)}`
            : '';
        }
        const { genre, signature } = known;
        const lane = genre.replace(/_/g, ' ');
        const facts = [
          ...measuredFacts,
          ...signature.tags.slice(0, 3),
          `arrangement transitions and fills every ${signature.fillBars} bars`,
        ];
        return `• ZAP ${lane} FACTS (song and artist identity removed): ${facts.join(' · ').slice(0, 900)}`;
      }
      const bits = [
        ...measuredPromptFacts(rec).slice(0, 3),
        rec.bpm ? `${rec.bpm}bpm` : null,
        rec.key || null,
        rec.drums ? `DRUMS: ${rec.drums}` : null,
        rec.percussion ? `PERCUSSION: ${rec.percussion}` : null,
        rec.bass ? `BASS: ${rec.bass}` : null,
        rec.groove ? `GROOVE: ${rec.groove}` : null,
        rec.arrangement ? `ARRANGEMENT: ${rec.arrangement}` : null,
        rec.flow || rec.vocalStyle ? `VOCAL: ${[rec.vocalGender, rec.vocalStyle, rec.flow].filter(Boolean).join(', ')}` : null,
      ].filter(Boolean);
      const body = bits.length ? bits.join(' · ') : rec.learnedRecipe || r.summary || '';
      if (!body) return '';
      const tag = r.generated ? ' (from a previous strong render)' : '';
      return `• ${r.title ? r.title + tag + ': ' : ''}${body.slice(0, 900)}`;
    })
    .filter(Boolean);
}

/**
 * Rich production brief for the LLM prompts (hooks/lyrics/arranger/A&R).
 * `pinnedReferenceId` guarantees the reference the artist JUST listened to leads
 * the brief — the remake must rebuild THAT record's sound, not whatever happens
 * to be recent.
 */
export async function learnedReferenceBrief(
  workspaceId: string,
  genre?: string | null,
  pinnedReferenceId?: string | null
): Promise<string> {
  if (!genre) return '';
  const refs = await fetchRefs(workspaceId, genre, pinnedReferenceId);
  const lines = learnedReferenceLines(refs);
  if (!lines.length) return '';
  return (
    "LEARNED SOUND GUIDANCE — the artist's owned references lead. Zap contributes only identity-free " +
    'measured numbers and genre craft facts; never infer or repeat a Zapped song, title, or artist:\n' +
    lines.join('\n')
  );
}

/**
 * TRAINING USAGE (traceability) — exactly which of the artist's references a
 * render for this genre actually draws on, so "have my beats been used?" has a
 * provable answer per beat instead of a vibe. Returns the same refs the brief +
 * tags use, plus how many are MEASURED (a reference with no measured recipe
 * contributes little — that's why unmeasured training feels inert).
 */
export interface TrainingUsage {
  referenceIds: string[];
  titles: string[];
  pinnedReferenceId: string | null;
  total: number; // refs considered in-genre
  measured: number; // of the used refs, how many were REALLY DSP-measured (ear ran)
  inferredOnly: number; // carry only LLM-guessed prose, never actually heard
  genre: string;
}
export async function learnedUsage(workspaceId: string, genre?: string | null, pinnedReferenceId?: string | null): Promise<TrainingUsage> {
  const g = genre ?? '';
  if (!g) return { referenceIds: [], titles: [], pinnedReferenceId: pinnedReferenceId ?? null, total: 0, measured: 0, inferredOnly: 0, genre: g };
  const refs = await fetchRefs(workspaceId, g, pinnedReferenceId);
  // REAL measurement = the DSP ear actually ran (recipe.measured.engineOk), NOT
  // the presence of LLM-guessed drums/bass prose (which analyzeAudio fills even
  // with the audio model OFF). The old predicate reported inferred refs as
  // 'measured', manufacturing false confidence (audit FAKE_GREEN).
  const isMeasured = (r: RefRow) => !!(r.recipe.measured as { engineOk?: boolean } | undefined)?.engineOk;
  const hasProse = (r: RefRow) => !!(r.recipe.drums || r.recipe.bass || r.recipe.percussion || r.recipe.groove);
  return {
    referenceIds: refs.map((r) => r.id),
    titles: refs.map((r) =>
      r.zap ? `Zap ${(r.genre ?? 'lane').replace(/_/g, ' ')} facts` : r.title ?? '(untitled)',
    ),
    inferredOnly: refs.filter((r) => !isMeasured(r) && hasProse(r)).length,
    pinnedReferenceId: pinnedReferenceId ?? null,
    total: refs.length,
    measured: refs.filter(isMeasured).length,
    genre: g,
  };
}

/**
 * Terse learned tokens for the MUSIC MODEL (≤4, short) — the sound it heard must
 * shape the AUDIO prompt, not just the lyric prompts. Pulled from the newest
 * REAL reference in genre (or the pinned one).
 */
export async function learnedStyleTags(
  workspaceId: string,
  genre?: string | null,
  pinnedReferenceId?: string | null
): Promise<string[]> {
  if (!genre) return [];
  const refs = await fetchRefs(workspaceId, genre, pinnedReferenceId);
  const src = refs.find((r) => !r.generated && !r.zap) ?? refs[0];
  if (!src) return [];
  const rec = src.recipe;
  const shorten = (s?: string | null, max = 44) => {
    if (!s) return null;
    const clause = (s.split(/[—:;(.]/)[0] ?? s).split(',')[0] ?? s;
    const t = clause.trim();
    return t.length > 4 ? t.slice(0, max) : null;
  };
  if (src.zap) {
    const known = knownGenreSignature(src.genre);
    const safeFacts = [
      ...measuredPromptFacts(rec),
      ...(known ? known.signature.tags : []),
    ];
    return safeFacts
      .map((tag) => shorten(tag))
      .filter((tag): tag is string => !!tag)
      .slice(0, 4);
  }
  return [shorten(rec.drums), shorten(rec.percussion, 36), shorten(rec.groove, 36), shorten(rec.bass, 32)]
    .filter((t): t is string => !!t)
    .slice(0, 4);
}

/**
 * MEASURED tokens — the genuinely reference-SPECIFIC signal (audit PARTIAL: the
 * DSP-measured facts never reached the fresh-render prompt, only ranking used
 * them). Reads recipe.measured (the ear's real output) from the newest MEASURED
 * reference and emits terse, true tokens the music model can act on.
 */
export async function learnedMeasuredTags(workspaceId: string, genre?: string | null, pinnedReferenceId?: string | null): Promise<string[]> {
  if (!genre) return [];
  const refs = await fetchRefs(workspaceId, genre, pinnedReferenceId);
  const src = refs.find((r) => (r.recipe.measured as { engineOk?: boolean } | undefined)?.engineOk);
  return src ? measuredPromptFacts(src.recipe).slice(0, 3) : [];
}

/**
 * LEARNED LYRIC CRAFT — what the studio has studied from lyrics brought to it
 * (patterns/technique only, never words — see lyric-learn.ts doctrine).
 * In-genre lessons lead; craft transfers, so off-genre lessons still season.
 * Feeds the hook writer + lyric writer alongside hit-craft.
 */
export async function learnedLyricCraftBrief(workspaceId: string, genre?: string | null): Promise<string> {
  const rows: Array<{ title: string | null; summary: string | null; genre: string | null }> = await prisma.soundReference.findMany({
    where: {
      workspaceId,
      active: true,
      analysisState: { not: 'failed' },
      rightsBasis: { not: 'unknown' },
      sourceUrl: { startsWith: 'lyric:' },
    },
    orderBy: { createdAt: 'desc' },
    take: 24,
    select: { title: true, summary: true, genre: true },
  });
  if (!rows.length) return '';
  const inGenre = genre ? rows.filter((r) => genreMatches(r.genre, genre)) : [];
  const rest = rows.filter((r) => !inGenre.includes(r));
  const picked = [...inGenre.slice(0, 2), ...rest.slice(0, 1)].filter((r) => r.summary);
  if (!picked.length) return '';
  return (
    'STUDIED LYRIC CRAFT (from lyrics the artist brought to learn from — apply the TECHNIQUES to brand-new words, never reuse phrasing). ' +
    'THE LESSON IS THE FLOOR, NOT THE CEILING: outdo the studied songs — a sharper hook, a fresher angle, more original imagery than what was studied:\n' +
    picked.map((r) => `• ${r.title ? r.title + ': ' : ''}${r.summary!.slice(0, 700)}`).join('\n')
  );
}

/**
 * Shelve a trend digest into the data lake (one snapshot per genre per day) so
 * chart-awareness COMPOUNDS instead of evaporating after each request.
 * Best-effort: never throws into the caller's path.
 */
export async function snapshotTrend(
  workspaceId: string,
  genre: string | null | undefined,
  trend: { digest: string; source: string; sources?: Array<{ title: string; url: string }> } | null
): Promise<void> {
  try {
    if (!trend?.digest || !genre) return;
    const day = new Date().toISOString().slice(0, 10);
    const title = `trends:${genre}:${day}`;
    // Deterministic id = race-proof dedupe: two concurrent generations both
    // trying to snapshot the same genre+day collide on the PRIMARY KEY and the
    // second create simply throws into this catch — exactly one row per day.
    const id = `trend_${workspaceId.slice(-8)}_${genre.replace(/[^a-z0-9]/gi, '')}_${day.replace(/-/g, '')}`;
    // UPSERT (not create) — concurrent generations racing to snapshot the same
    // genre+day used to collide on the PK and log a noisy prisma P2002 error;
    // upsert makes the second one a no-op update instead. One row per day.
    await prisma.soundReference.upsert({
      where: { id },
      create: {
        id,
        workspaceId,
        genre,
        sourceUrl: `trend:${trend.source}`,
        title,
        summary: trend.digest.slice(0, 2000),
        recipe: { source: 'trend', provider: trend.source, charts: (trend.sources ?? []).slice(0, 12) } as never,
        analysisState: 'inferred',
        rightsBasis: 'facts-only',
      },
      update: {},
    });
  } catch {
    /* duplicate day-snapshot or transient DB error — never worth failing a generation */
  }
}

/**
 * VOCABULARY BREADTH — the anti-"same words every song" guardrail.
 * Mines the workspace's recent lyrics + hooks for over-used content words and
 * BANS them for the next song, plus an African-storytelling directive:
 * specific scenes over generic party filler.
 */
const STOP_WORDS = new Set(('the a an and or but if of in on at to for with from by as is are was were be been am i you he she it we they my your our their this that these those no not so do did done will would can could go come get got make made one two dey na wey abi sha oya omo eh oh ya yeah la le lo mi wa ni ti si ko ka'.split(' ')));
export async function overusedWords(workspaceId: string): Promise<string[]> {
  const [lyrics, hooks] = await Promise.all([
    prisma.lyricDraft.findMany({ where: { project: { workspaceId } }, orderBy: { createdAt: 'desc' }, take: 25, select: { body: true } }),
    prisma.hookCandidate.findMany({ where: { project: { workspaceId } }, orderBy: { createdAt: 'desc' }, take: 60, select: { text: true } }),
  ]);
  const docs: string[] = [...lyrics.map((l: { body: string }) => l.body), ...hooks.map((h: { text: string }) => h.text)].filter(Boolean);
  if (docs.length < 4) return [];
  const docFreq = new Map<string, number>();
  for (const d of docs) {
    const words = new Set(
      d.toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/[^\p{L}']/gu, ' ').split(/\s+/)
        .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
    );
    for (const w of words) docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
  }
  return [...docFreq.entries()]
    .filter(([, n]) => n / docs.length >= 0.35)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .map(([w]) => w);
}

export async function freshnessBrief(workspaceId: string): Promise<string> {
  const banned = await overusedWords(workspaceId).catch(() => [] as string[]);
  const always = ['party', 'celebrate', 'vibe', 'shine', 'alert', 'winning', 'blessings'];
  const banLine = [...new Set([...banned, ...always])].join(', ');
  return (
    'FRESHNESS — HARD RULES:\n' +
    `- BANNED THIS SONG (worn out in this catalog + generic filler): ${banLine}. Find sharper, more specific words.\n` +
    '- STORYTELLING, THE AFRICAN WAY: every song is a STORY told to somebody — name a real-feeling place, person, moment (a street, a market, a night, an aunty, a promise). Setup → turn → payoff. Proverb-flavored lines beat slogans. Talk TO the listener (call them in), not at them.\n' +
    '- Own at least 5 images/phrases that could not appear in any other song in this catalog. If a line could be in anybody\'s song, it is filler — cut it.'
  );
}
