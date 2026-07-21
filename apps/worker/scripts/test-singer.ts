/**
 * AFRICAN-SINGING WAVE GATE — proves the four cheapest-high-leverage singer wins
 * survive end to end. Exit 1 on any regression.
 *
 *   1. African tone-preserving G2P: Yoruba tone extraction from the diacritics,
 *      language detection, and the VERBATIM LAW (lyrics are never rewritten).
 *   2. Melody tone-contour directive: a relative rise/level/fall projection of a
 *      synthetic MelodyScore, with the hook-above-verse register hint.
 *   3. Per-genre swing tokens: the measured pocket token is present AND
 *      front-loaded in composeStyleTags output, per genre; verbatim mode intact.
 *   4. (config, verified by inspection in fills.ts / ffmpeg.ts) 44.1k stereo.
 *
 * Pure/offline — no engine call, no DSP, no DB. tsx-runnable.
 */
import {
  composeStyleTags,
  swingPocketToken,
  detectAfricanLanguage,
  annotateLyricsForSinging,
  yorubaSyllableTones,
} from '@afrohit/ai';
import { composeMelody, melodyContourDirective, type MelodyScore } from '@afrohit/shared';

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failures++;
  }
}

// Build the tricky Yoruba graphemes from explicit combining code points so the
// test is immune to how this source file happens to be normalized on disk.
const GRAVE = '̀'; // low tone
const ACUTE = '́'; // high tone
const DOT = '̣'; // Yoruba under-dot (ẹ/ọ/ṣ) — quality, not tone

// ---------------------------------------------------------------------------
// 1. YORUBA TONE EXTRACTION (the strong lane)
// ---------------------------------------------------------------------------
{
  const ife = 'i' + GRAVE + 'f' + 'e' + DOT + ACUTE; // ìfẹ́ "love" → Low-High
  const tones = yorubaSyllableTones(ife).map((s) => s.tone).join('-');
  check(tones === 'L-H', `Yoruba tone: "ìfẹ́" should read L-H, got ${tones}`);

  const omo = 'o' + DOT + 'm' + 'o' + DOT; // ọmọ "child" → Mid-Mid (unmarked = Mid)
  const omoTones = yorubaSyllableTones(omo).map((s) => s.tone).join('-');
  check(omoTones === 'M-M', `Yoruba tone: "ọmọ" should read M-M (unmarked=Mid), got ${omoTones}`);

  const gba = 'gb' + 'a' + GRAVE; // gbà — the gb DIGRAPH must stay one onset
  const gbaSyl = yorubaSyllableTones(gba);
  check(gbaSyl.length === 1, `Yoruba gb digraph: "gbà" should be ONE syllable, got ${gbaSyl.length}`);
  check(gbaSyl[0]?.tone === 'L', `Yoruba tone: "gbà" should read L, got ${gbaSyl[0]?.tone}`);
  check(/gb/.test(gbaSyl[0]?.syllable ?? ''), 'Yoruba gb digraph dropped from the syllable text');

  const nasal = 'n' + ACUTE; // ń — a tone-bearing SYLLABIC NASAL
  const nasalSyl = yorubaSyllableTones(nasal);
  check(
    nasalSyl.length === 1 && nasalSyl[0]?.tone === 'H',
    `Yoruba syllabic nasal "ń" should be one H syllable, got ${JSON.stringify(nasalSyl)}`,
  );
}

// ---------------------------------------------------------------------------
// 2. LANGUAGE DETECTION + VERBATIM LAW
// ---------------------------------------------------------------------------
{
  const yorubaLine = 'O' + DOT + 'mo' + DOT + ' mi, i' + GRAVE + 'fe' + DOT + ACUTE + ' mi'; // Ọmọ mi, ìfẹ́ mi
  check(detectAfricanLanguage(yorubaLine) === 'yor', 'Yoruba line not detected as yor (under-dot signal)');

  check(
    detectAfricanLanguage('Nakupenda sana, wewe ni malaika wangu') === 'swa',
    'Swahili line not detected as swa (wordlist)',
  );
  check(detectAfricanLanguage('I love you baby, dancing all night') === null, 'English wrongly tagged as African');
  check(detectAfricanLanguage('') === null, 'empty lyric must detect null');

  // VERBATIM LAW: annotated output is BYTE-FOR-BYTE the input; the directive is
  // separate and never touches the words.
  const lyrics = '[Verse]\n' + yorubaLine + '\n(oh oh)';
  const { annotated, toneNotes } = annotateLyricsForSinging(lyrics, 'yor');
  check(annotated === lyrics, 'VERBATIM LAW violated: annotated lyrics differ from the input');
  check(toneNotes.length > 0 && toneNotes !== lyrics, 'toneNotes must be a non-empty directive distinct from the lyrics');
  check(/Yoruba tonal singing/i.test(toneNotes), 'Yoruba toneNotes missing its tonal-singing directive');
  check(/relative pitch/i.test(toneNotes), 'toneNotes must ask for tone on RELATIVE pitch');
}

// ---------------------------------------------------------------------------
// 3. MELODY TONE-CONTOUR DIRECTIVE (from a synthetic score)
// ---------------------------------------------------------------------------
{
  const synth: MelodyScore = {
    bpm: 104,
    key: 'A minor',
    seed: 1,
    sections: [
      {
        name: 'Verse',
        kind: 'verse',
        bars: 2,
        notes: [
          { startBeat: 0, durBeats: 1, midi: 57, syllable: 'la' }, // A3
          { startBeat: 1, durBeats: 1, midi: 55, syllable: 'la' }, // G3
          { startBeat: 2, durBeats: 1, midi: 53, syllable: 'la' }, // F3 — net FALL
        ],
      },
      {
        name: 'Hook',
        kind: 'hook',
        bars: 2,
        notes: [
          { startBeat: 0, durBeats: 1, midi: 64, syllable: 'la' }, // E4
          { startBeat: 1, durBeats: 1, midi: 67, syllable: 'la' }, // G4
          { startBeat: 2, durBeats: 1, midi: 69, syllable: 'la' }, // A4 — net RISE, higher register
        ],
      },
    ],
  };
  const directive = melodyContourDirective(synth);
  check(directive.length > 0, 'contour directive is empty for a real score');
  check(/verse falls/i.test(directive), `contour must read the verse as falling: "${directive}"`);
  check(/hook rises/i.test(directive), `contour must read the hook as rising: "${directive}"`);
  check(/hook sits .* above the verse/i.test(directive), `contour must place the hook above the verse: "${directive}"`);
  check(/relative/i.test(directive) && /do not transpose/i.test(directive), 'contour must be RELATIVE (follow shape, do not transpose)');

  // Empty score → empty directive (callers drop it).
  check(melodyContourDirective({ bpm: 104, key: 'A minor', seed: 1, sections: [] }) === '', 'empty score must yield empty directive');

  // A real composed score projects to a non-empty directive too (integration).
  const composed = composeMelody({
    genre: 'afrobeats',
    bpm: 104,
    key: 'A minor',
    seed: 42,
    sections: [
      { name: 'Verse', kind: 'verse', lines: ['la la la la', 'la la la la'] },
      { name: 'Hook', kind: 'hook', lines: ['na na na', 'na na na'] },
    ],
  });
  check(melodyContourDirective(composed).length > 0, 'composed-score contour directive is empty');
}

// ---------------------------------------------------------------------------
// 4. PER-GENRE SWING TOKENS — present, front-loaded, verbatim-safe
// ---------------------------------------------------------------------------
{
  const SWING_EXPECT: Record<string, RegExp> = {
    amapiano: /~60%|triplet swing|log-drum bounces/i,
    afrobeats: /swung 16th-note shakers ~56%/i,
    highlife: /straight-but-lilting|~52%/i,
    gospel: /back-heavy gospel pocket/i,
  };
  for (const [genre, rx] of Object.entries(SWING_EXPECT)) {
    const token = swingPocketToken(genre);
    check(!!token && rx.test(token), `[${genre}] swingPocketToken missing/incorrect (want ${rx})`);
    const tags = composeStyleTags({ genre, bpm: 108, dnaTags: [] } as never, { fallbackLiteral: 'radio-ready' });
    const idx = tags.findIndex((t) => rx.test(t));
    check(idx >= 0, `[${genre}] swing token absent from composeStyleTags output`);
    check(idx >= 0 && idx <= 2, `[${genre}] swing token must be FRONT-LOADED (index <= 2), got ${idx}`);
  }

  // Non-mapped / non-African genre is left untouched — no groove token invented.
  check(swingPocketToken('pop') === null, 'non-African genre must get no swing token');
  const popTags = composeStyleTags({ genre: 'pop', bpm: 120, dnaTags: [] } as never, { fallbackLiteral: 'radio-ready' });
  check(!popTags.some((t) => /^groove:/i.test(t)), 'pop must not receive a groove/swing token');

  // VERBATIM early-return is intact: verbatim mode adds NO groove token.
  const verbatim = composeStyleTags(
    { genre: 'amapiano', bpm: 112, promptMode: 'verbatim', vibePrompt: 'solo shaker only' } as never,
    { fallbackLiteral: 'radio-ready' },
  );
  check(!verbatim.some((t) => /^groove:/i.test(t)), 'verbatim mode must not inject a swing token (early-return intact)');
  check(verbatim.some((t) => /solo shaker only/i.test(t)), 'verbatim mode must still pass the caller vibePrompt through');
}

// ---------------------------------------------------------------------------
// G2P + CONTOUR THREADED INTO composeStyleTags (the wiring, item 1 & 2)
// ---------------------------------------------------------------------------
{
  const yorubaLyric = '[Verse]\n' + 'O' + DOT + 'mo' + DOT + ' mi, i' + GRAVE + 'fe' + DOT + ACUTE + ' mi';
  const tags = composeStyleTags(
    { genre: 'afrobeats', bpm: 104, withVocals: true, lyrics: yorubaLyric, dnaTags: [], melodyContour: 'CONTOUR_MARKER verse falls, hook rises' } as never,
    { fallbackLiteral: 'radio-ready' },
  );
  const joined = tags.join(' , ');
  check(/Yoruba tonal singing/i.test(joined), 'G2P tone note not threaded into the style tags for a Yoruba lyric');
  check(/CONTOUR_MARKER/.test(joined), 'melodyContour directive not threaded into the style tags');
  // The lyric field is NEVER carried in the style tags — only the directive.
  check(!tags.some((t) => t.includes('[Verse]')), 'lyrics must never leak into the style tags');

  // No lyrics → no tone note (fail-open).
  const beatTags = composeStyleTags({ genre: 'afrobeats', bpm: 104, dnaTags: [] } as never, { fallbackLiteral: 'radio-ready' });
  check(!beatTags.some((t) => /Yoruba tonal singing/i.test(t)), 'instrumental (no lyrics) must not get a tone note');
}

if (failures > 0) {
  console.error(`singer wave: ${failures} failure(s)`);
  process.exit(1);
}
console.log(
  'singer wave: Yoruba tone extraction (L-H/M-M/gb-digraph/syllabic-nasal), language detection + VERBATIM law, ' +
    'melody tone-contour directive (verse-fall/hook-rise/register), per-genre front-loaded swing tokens (verbatim intact), ' +
    'and G2P+contour threaded into composeStyleTags — all green.',
);
