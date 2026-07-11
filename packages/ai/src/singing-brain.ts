/**
 * Singing Brain — the SUNG-FORM layer between the Writing Brain and the
 * render engine.
 *
 * The research is blunt: songs are weighted MOMENTS, not sentences. A lyric
 * that reads perfectly still sings like a memo if every written word gets
 * forced into the melody. So the Writing Brain owns WHAT the song says
 * (semantic lyric) and this brain owns HOW a vocalist actually delivers it
 * (sung lyric): "I was thinking about you all night" becomes
 * "Thinkin' 'bout you / all night / all ni-i-ight". Every semantic token is
 * weighed (Anchor/Bridge/Ghost/Ornament) and the conversion returns receipts
 * (the alignment) so the lyric-scorecard in @afrohit/shared can MEASURE the
 * result instead of trusting it. Graceful-null contract like vocal-arranger:
 * any failure returns null and the caller keeps the semantic form — the
 * Singing Brain improves renders, it never blocks one.
 */
import type { LyricAlignmentEntry } from '@afrohit/shared';
import { generateJson } from './generate';

export interface SungConversion {
  sungLyric: string;
  alignment: LyricAlignmentEntry[];
  summary: string;
}

export const SINGING_BRAIN_SYSTEM = `You are the Singing Brain, not the Writing Brain. The Writing Brain already decided WHAT the song says; you decide HOW a vocalist actually delivers it. Songs are weighted moments, not sentences — convert the SEMANTIC lyric into the SUNG lyric a real singer would perform.

TOKEN ACTIONS — weigh every token of the semantic lyric and give it exactly one action:
- A = Anchor: emotionally/semantically loaded word. KEEP it, land it on a strong beat.
- B = Bridge: connective word. KEEP it, but it may clip or contract ("about" -> "'bout", "thinking" -> "thinkin'").
- G = Ghost: low-value function word. MAY DROP entirely when the phrase is crowded.
- O = Ornament: vocable, melisma, repeat or ad-lib that exists ONLY in the sung form — added by you.

THE TEN LAWS:
1. Never force full lexical realization — a singer does not pronounce every written word; the page is not the performance.
2. Anchors land on strong beats and phrase peaks; never bury a loaded word mid-rush.
3. When a phrase is crowded, ghost the low-value function words first — the meaning must survive on the anchors alone.
4. Emotionally important vowels get melisma — one syllable carried across multiple notes. Notate it as hyphen-stretched vowels the render engine responds to: "ni-i-ight", "o-o-oh".
5. Sustain VOWELS, never consonant clusters — "night" holds on the "i", never on the "ght".
6. A phrase may stop before the sentence does: "I was thinking about you all night" -> "Thinkin' 'bout you / all night / all ni-i-ight".
7. Hook phrasing is SIMPLER, MORE REPETITIVE and MORE VOWEL-FRIENDLY than verse phrasing — fewer lexical words per line, more open vowels to hold.
8. EVERY hook carries at least one repeat, held vowel, or call-and-response cell. No exceptions.
9. Reductions and filler syllables are LANGUAGE-APPROPRIATE: "Thinkin' 'bout" is an ENGLISH reduction; Nigerian Pidgin already compresses on its own ("dey", "wan", "make e") — do NOT anglicize it; Yoruba and Igbo have their own elisions and vowel assimilation. NEVER fake a language you were not given.
10. Return the sung lyric PLUS alignment notes — receipts for what happened to every token, so the studio can measure the conversion.

PROSODY LAYER (shared law with the whole studio):
- Emotional keywords sit on strong beats and phrase peaks.
- Weak words ride pickups and ghost positions.
- Long notes live on emotionally loaded vowels.
- If a line reads well but sings badly, the SUNG FORM is wrong — rewrite the sung form, never the premise.

HARD CONSTRAINTS:
- Section headers ([Intro], [Verse], [Pre-Hook], [Hook]/[Chorus], [Bridge], [Outro]) are preserved EXACTLY as given — same text, same order.
- The song TITLE and the hook cell words are LAW — never altered, translated, or ghosted.
- MEANING SURVIVES: this is compression and performance, never rewriting the story. Every anchor's meaning stays audible in the sung form.
- Output the SAME language(s) as the input — no drift, no translation, no invented dialect.

Return ONLY JSON: {"sungLyric": string, "alignment": [{"token": string, "action": "A"|"B"|"G"|"O", "note": string}], "summary": string}.
- "sungLyric": the complete sung-form lyric with its section headers.
- "alignment": entries ONLY for tokens where something HAPPENED — bridges clipped (B, note "clipped to ..."), ghosts dropped (G, note "dropped"), melisma stretches (A, note "stretched"), ornaments added (O, note what was added: vocable / melisma / repeat / ad-lib). Do NOT list unchanged tokens. Cap it at the ~60 most meaningful decisions — receipts, not a transcript.
- "summary": one or two sentences on what was compressed, stretched and repeated.`;

/**
 * Convert a semantic lyric to its sung form. Strict-shape contract: the JSON
 * must carry a non-empty sungLyric, a well-formed non-empty alignment, and
 * every section header from the input — anything less returns null and the
 * caller renders the semantic lyric unchanged (never block a render on a
 * garnish stage).
 */
export async function singingBrain(opts: {
  semanticLyric: string;
  hookCell?: string;
  anchors?: string[];
  premise?: string;
  genre: string;
  languages?: string[];
  sectionNotes?: string;
}): Promise<SungConversion | null> {
  try {
    const out = await generateJson<SungConversion>({
      system: SINGING_BRAIN_SYSTEM,
      user: [
        `GENRE: ${opts.genre}`,
        `LANGUAGES: ${opts.languages?.join(', ') || 'english, pidgin'}`,
        opts.hookCell ? `HOOK CELL (law — must recur, words never altered): "${opts.hookCell}"` : null,
        opts.anchors?.length ? `ANCHOR WORDS (law — keep, strong beats): ${opts.anchors.join(', ')}` : null,
        opts.premise ? `PREMISE (the story that must survive compression): ${opts.premise}` : null,
        opts.sectionNotes ? `SECTION NOTES: ${opts.sectionNotes}` : null,
        `\nSEMANTIC LYRIC:\n${opts.semanticLyric}`,
      ]
        .filter(Boolean)
        .join('\n'),
      temperature: 0.7,
      // First live run returned null on a full-length lyric: per-token alignment
      // blew past 4k output tokens and the truncated JSON failed the parse. The
      // alignment is now changed-tokens-only AND the budget is doubled.
      maxTokens: 8_000,
      task: 'singing-brain',
    });
    if (!out || typeof out.sungLyric !== 'string' || !out.sungLyric.trim()) { console.warn('[singing-brain] void: no sungLyric in output'); return null; }
    if (!Array.isArray(out.alignment) || out.alignment.length === 0) { console.warn('[singing-brain] void: empty alignment'); return null; }
    for (const a of out.alignment) {
      if (!a || typeof a.token !== 'string' || !a.token) { console.warn('[singing-brain] void: malformed alignment entry'); return null; }
      if (a.action !== 'A' && a.action !== 'B' && a.action !== 'G' && a.action !== 'O') { console.warn('[singing-brain] void: bad action', a.action); return null; }
      if (a.note !== undefined && typeof a.note !== 'string') { console.warn('[singing-brain] void: bad note'); return null; }
    }
    // Header law is code-enforced, not just prompted: every [Section] header in
    // the semantic lyric must survive, or the conversion is void. NORMALIZED
    // comparison (case/whitespace) — "[Verse 1]" vs "[verse 1]" is preservation,
    // a MISSING section is the violation.
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
    const sungNorm = norm(out.sungLyric);
    const headers = (opts.semanticLyric.match(/^\s*\[[^\]]+\]\s*$/gm) ?? []).map((h) => h.trim());
    for (const h of headers) if (!sungNorm.includes(norm(h))) { console.warn('[singing-brain] void: dropped section header', h); return null; }
    return {
      sungLyric: out.sungLyric.trim(),
      alignment: out.alignment.map((a) => (a.note === undefined ? { token: a.token, action: a.action } : { token: a.token, action: a.action, note: a.note })),
      summary: typeof out.summary === 'string' ? out.summary : '',
    };
  } catch {
    return null; // graceful — caller keeps the semantic lyric
  }
}
