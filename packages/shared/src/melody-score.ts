/**
 * MELODY SCORE — the studio COMPOSES the vocal melody itself. Explicit notes
 * per syllable, from the lane's measured DNA, instead of a black-box engine
 * guessing. Pure TS, zero deps, fully deterministic per seed — the same brief
 * composes the same score twice, and every law below ships with a validator
 * so the gate MEASURES the melody instead of trusting it.
 *
 * The laws (owner-approved Own Singer program, piece 3):
 *  - SCALE LAW: every pitch lives in the key (natural minor / major); Afro
 *    lanes bias PENTATONIC subsets — the melodic language of the lane, and
 *    hooks are STRICTLY pentatonic there.
 *  - CONTOUR LAW: verse = narrow mid-register (degrees 1-5), conversational,
 *    phrase arcs falling to the tonic/third; PRE-HOOK rises into the hook;
 *    HOOK = higher tessitura (3-8) built on ONE repeated melodic CELL (the
 *    hook cell law — a repeated lyric line keeps its exact pitches) with
 *    open-vowel long notes on line ends; BRIDGE contrasts (starts on 6 or 4).
 *  - PROSODY LAW (the studio's standing lyric law, now in pitch-time): anchor
 *    words land ON strong beats — 1 and 3 in 4/4, or the off-beat push when
 *    syncopation > 0.6 (the Afro pocket). Target ≥ 70% of anchors on strong.
 *  - SWING LAW: swing ≥ 0.54 offsets every second 8th by +(swing-0.5)*0.5
 *    beats — the lilt, applied AFTER placement so the grid stays honest.
 *  - FIT LAW: a section's notes never overflow bars*4 beats, and every phrase
 *    end breathes (≥ 0.25 beat gap — we leave 0.5 so the swing can't eat it).
 *  - SINGABILITY LAW: total span ≤ 14 semitones; leaps are capped at 7
 *    semitones and any leap ≥ 6 resolves by stepwise CONTRARY motion.
 *  - MELISMA LAW: the Singing Brain's hyphen-stretch notation ("ni-i-ight")
 *    is honored — one syllable held across 2-3 notes stepping down.
 */

import type { SectionKind } from './lyric-scorecard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MelodyNote {
  /** Beats from the START OF THE SECTION (4/4; beat 0 = the section downbeat). */
  startBeat: number;
  durBeats: number;
  midi: number;
  syllable: string;
  /** True on the first note of an anchor word — the prosody law's receipts. */
  anchor?: boolean;
}

export interface MelodySection {
  name: string;
  kind: SectionKind;
  bars: number;
  notes: MelodyNote[];
}

export interface MelodyScore {
  bpm: number;
  key: string;
  sections: MelodySection[];
  seed: number;
}

export type MelodyContour = 'rise' | 'fall' | 'arch' | 'wave';
export type MelodyDensity = 'sparse' | 'flowing' | 'dense';

export interface MelodySectionInput {
  name: string;
  kind: SectionKind;
  lines: string[];
  /** Anchor words (prosody law) — matched per word, melisma-folded, case-blind. */
  anchors?: string[];
  /** Taste-layer phrasing (melodyBrain) — parameters only; CODE stays the composer. */
  contour?: MelodyContour;
  density?: MelodyDensity;
  /** Scale degree 1..8 the section's first note aims for. */
  startDegree?: number;
  /** Preferred pitch-class for the hook cell's first note (e.g. "F#") — ignored unless it's in key. */
  motifNote?: string;
  /** Explicit bar count; default = 2 bars per line, clamped 2..32. */
  bars?: number;
}

export interface ComposeMelodyOpts {
  genre: string;
  bpm: number;
  key: string;
  sections: MelodySectionInput[];
  /** 0.5 = straight; ≥ 0.54 engages the lilt. Clamped to 0.8. */
  swing?: number;
  /** > 0.6 = anchors target the off-beat push (the Afro pocket). */
  syncopation?: number;
  seed: number;
}

// ---------------------------------------------------------------------------
// Key + scale
// ---------------------------------------------------------------------------

const LETTER_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR = [0, 2, 3, 5, 7, 8, 10] as const; // natural minor — the Afro staple
/** Scale-degree members (mod 7) of the lane's pentatonic language. */
const PENTA_DEGREES: Record<'major' | 'minor', ReadonlySet<number>> = {
  major: new Set([1, 2, 3, 5, 6]),
  minor: new Set([1, 3, 4, 5, 7]),
};

export interface ParsedKey {
  tonicPc: number;
  mode: 'major' | 'minor';
  /** Tonic placed in a singable octave (midi 55-66) — the tessitura's floor. */
  tonicMidi: number;
  intervals: readonly number[];
}

/** Parse "B minor" / "Bm" / "Eb major" / "F#" (bare letter = major). Unparseable → A minor (the lane fallback). */
export function parseKey(key: string): ParsedKey {
  const m = /^\s*([a-gA-G])\s*([#b])?\s*(.*)$/.exec(key ?? '');
  let pc = 9; // A
  let mode: 'major' | 'minor' = 'minor';
  if (m) {
    pc = LETTER_PC[m[1]!.toLowerCase()]!;
    if (m[2] === '#') pc = (pc + 1) % 12;
    if (m[2] === 'b') pc = (pc + 11) % 12;
    const rest = (m[3] ?? '').trim().toLowerCase();
    mode = rest === '' ? 'major' : /maj/.test(rest) ? 'major' : 'minor'; // "m"/"min"/"minor" all read minor
  }
  let tonicMidi = 48 + pc;
  if (tonicMidi < 55) tonicMidi += 12; // G3..F#4 — center the tessitura near middle C
  return { tonicPc: pc, mode, tonicMidi, intervals: mode === 'major' ? MAJOR : MINOR };
}

/** Scale degree (1 = tonic, 8 = tonic an octave up) → midi note in the parsed key. */
export function degreeToMidi(k: ParsedKey, degree: number): number {
  const d = degree - 1;
  const oct = Math.floor(d / 7);
  const idx = ((d % 7) + 7) % 7;
  return k.tonicMidi + 12 * oct + k.intervals[idx]!;
}

/** "B4"-style name for logs and the demo printout. */
export function midiNoteName(midi: number): string {
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

// ---------------------------------------------------------------------------
// Lanes + feel
// ---------------------------------------------------------------------------

const AFRO_LANE_RX = /afro|amapiano|highlife|street_pop|azonto|fuji|juju|apala|ndombolo|soukous|coupe_decale|bongo_flava|gqom|kwaito|alte|praise|naija/i;
export const isAfroLane = (genre: string): boolean => AFRO_LANE_RX.test(genre ?? '');

/** Default groove feel per lane — Afro lanes carry the lilt + the off-beat pocket. */
export function laneFeel(genre: string): { swing: number; syncopation: number } {
  return isAfroLane(genre) ? { swing: 0.56, syncopation: 0.7 } : { swing: 0.5, syncopation: 0.4 };
}

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) + seed derivation
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable seed from ids/numbers (FNV-1a) — the own-engine derives per-song seeds with this. */
export function seedFrom(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    for (const c of String(p)) {
      h ^= c.charCodeAt(0);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Syllabification — naive but CONSISTENT (vowel-group split)
// ---------------------------------------------------------------------------

const VOWEL_RX = /[aeiouy]/;

/**
 * Split a word on vowel groups: one syllable per group; between two groups the
 * LAST consonant of the cluster onsets the next syllable ("thinking" →
 * thin·king, "melody" → me·lo·dy). Never perfect — always the same.
 */
export function syllabify(word: string): string[] {
  const lower = word.toLowerCase();
  const starts: number[] = [];
  const ends: number[] = [];
  let inV = false;
  for (let i = 0; i < lower.length; i++) {
    const v = VOWEL_RX.test(lower[i]!);
    if (v && !inV) { starts.push(i); inV = true; }
    if (!v && inV) { ends.push(i); inV = false; }
  }
  if (inV) ends.push(lower.length);
  if (starts.length <= 1) return [word];
  const out: string[] = [];
  let prev = 0;
  for (let g = 0; g < starts.length - 1; g++) {
    const clusterStart = ends[g]!;
    const nextVowel = starts[g + 1]!;
    const cut = clusterStart === nextVowel ? nextVowel : nextVowel - 1;
    out.push(word.slice(prev, cut));
    prev = cut;
  }
  out.push(word.slice(prev));
  return out.filter((s) => s.length > 0);
}

/** The Singing Brain's hyphen-stretch notation ("ni-i-ight", "o-o-oh"). */
const MELISMA_STRETCH_RX = /([aeiouy])-\1/i;
export function isMelismaToken(token: string): boolean {
  return token.includes('-') && MELISMA_STRETCH_RX.test(token);
}

/** Fold a sung token back to its comparable word: melisma collapses, punctuation goes. */
function foldWord(token: string): string {
  return token
    .toLowerCase()
    .replace(/([aeiouy])(?:-\1)+/g, '$1')
    .replace(/[^a-z]/g, '');
}

function tokensOf(line: string): string[] {
  return line
    .replace(/\([^)]*\)/g, ' ') // parentheticals are the backing layer, not the lead melody
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-zA-Z']+/, '').replace(/[^a-zA-Z']+$/, ''))
    .filter((t) => /[a-zA-Z]/.test(t));
}

interface SylUnit {
  syllable: string;
  /** Notes this syllable holds — 1, or 2-3 for a melisma stepping down. */
  notes: number;
  anchor: boolean;
}

function lineUnits(line: string, anchorSet: Set<string>): SylUnit[] {
  const units: SylUnit[] = [];
  for (const tok of tokensOf(line)) {
    const anchored = anchorSet.size > 0 && anchorSet.has(foldWord(tok));
    if (isMelismaToken(tok)) {
      // ONE syllable held across 2-3 notes — the whole token rides every note
      // so the render engine (and the gate) can see the hold.
      const n = Math.min(3, Math.max(2, tok.split('-').length));
      units.push({ syllable: tok, notes: n, anchor: anchored });
    } else {
      syllabify(tok).forEach((s, i) => units.push({ syllable: s, notes: 1, anchor: anchored && i === 0 }));
    }
  }
  return units;
}

// ---------------------------------------------------------------------------
// Contour templates — the music-theory engine per section kind
// ---------------------------------------------------------------------------

interface KindTemplate {
  lo: number;
  hi: number;
  contour: MelodyContour;
  density: MelodyDensity;
  /** Line-final resolution degrees (verse arcs fall to the tonic/third). */
  endOn?: number[];
}

const KIND_TEMPLATE: Record<SectionKind, KindTemplate> = {
  verse: { lo: 1, hi: 5, contour: 'fall', density: 'flowing', endOn: [1, 3] },
  prehook: { lo: 2, hi: 6, contour: 'rise', density: 'flowing' },
  hook: { lo: 3, hi: 8, contour: 'arch', density: 'flowing' },
  bridge: { lo: 4, hi: 7, contour: 'wave', density: 'sparse' },
  intro: { lo: 1, hi: 5, contour: 'wave', density: 'sparse' },
  outro: { lo: 1, hi: 5, contour: 'fall', density: 'sparse', endOn: [1] },
  other: { lo: 1, hi: 5, contour: 'wave', density: 'flowing' },
};

const DENSITY_DURS: Record<MelodyDensity, number[]> = {
  sparse: [1, 0.5, 1, 1.5],
  flowing: [0.5, 0.5, 0.25, 1],
  dense: [0.25, 0.5, 0.25, 0.5],
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

// ---------------------------------------------------------------------------
// Pitch — a contour-guided walk over the allowed degrees
// ---------------------------------------------------------------------------

function linePitches(o: {
  units: SylUnit[];
  key: ParsedKey;
  rng: () => number;
  afro: boolean;
  kind: SectionKind;
  contour: MelodyContour;
  lo: number;
  hi: number;
  startDegree?: number;
  motifDegree?: number;
  endOn?: number[];
  firstLineOfSection: boolean;
}): number[] {
  const penta = PENTA_DEGREES[o.key.mode];
  const isPenta = (d: number) => penta.has((((d - 1) % 7) + 7) % 7 + 1);
  // Afro hooks live STRICTLY in the pentatonic; other Afro sections are biased
  // toward it (a soft penalty), everything else walks the full scale.
  const strictPenta = o.afro && o.kind === 'hook';
  const allowed: number[] = [];
  for (let d = o.lo; d <= o.hi; d++) if (!strictPenta || isPenta(d)) allowed.push(d);
  if (!allowed.length) for (let d = o.lo; d <= o.hi; d++) allowed.push(d); // never an empty palette
  const pentaPenalty = o.afro && !strictPenta ? 0.75 : 0;
  const midiOf = (d: number) => degreeToMidi(o.key, d);
  const nearest = (target: number): number =>
    allowed.reduce((best, d) => {
      const cost = Math.abs(d - target) + (isPenta(d) ? 0 : pentaPenalty);
      const bestCost = Math.abs(best - target) + (isPenta(best) ? 0 : pentaPenalty);
      return cost < bestCost ? d : best;
    });

  const total = o.units.reduce((a, u) => a + u.notes, 0);
  const center = (o.lo + o.hi) / 2;
  const phase = o.rng() * Math.PI * 2; // wave entropy — different seeds, different lines
  const peakAt = 0.5 + (o.rng() - 0.5) * 0.3; // arch entropy
  const f = (t: number): number => {
    switch (o.contour) {
      case 'rise': return o.lo + (o.hi - o.lo) * (0.2 + 0.8 * t);
      case 'fall': return o.hi - (o.hi - o.lo) * (0.35 + 0.65 * t);
      case 'arch': return t <= peakAt ? o.lo + 1 + (o.hi - o.lo - 1) * (t / Math.max(0.01, peakAt)) : o.hi - (o.hi - o.lo - 1) * ((t - peakAt) / Math.max(0.01, 1 - peakAt));
      case 'wave': return center + Math.sin(phase + t * Math.PI * 2) * (o.hi - o.lo) * 0.35;
    }
  };

  const degrees: number[] = [];
  let prev: number | null = null;
  let lastLeapSemis = 0;
  let lastLeapDir = 0;
  let noteIdx = 0;
  for (const u of o.units) {
    for (let k = 0; k < u.notes; k++) {
      let deg: number;
      if (k > 0 && prev != null) {
        // MELISMA LAW: the held vowel steps DOWN through the allowed set.
        const below = [...allowed].reverse().find((d) => d < prev!);
        deg = below ?? prev;
      } else if (noteIdx === 0 && o.motifDegree != null) {
        deg = o.motifDegree; // hook cell opens on the motif pitch-class
      } else if (noteIdx === 0 && o.firstLineOfSection && o.startDegree != null) {
        deg = nearest(clamp(Math.round(o.startDegree), o.lo, o.hi));
      } else if (noteIdx === 0 && o.kind === 'bridge' && o.firstLineOfSection) {
        deg = nearest(o.rng() < 0.5 ? 6 : 4); // CONTRAST LAW: the bridge opens off-home
      } else {
        const target = f(total <= 1 ? 0 : noteIdx / (total - 1)) + (o.rng() - 0.5) * 1.6;
        deg = nearest(target);
        if (prev != null) {
          // SINGABILITY: cap any leap at 7 semitones…
          if (Math.abs(midiOf(deg) - midiOf(prev)) > 7) {
            const fit = allowed.filter((d) => Math.abs(midiOf(d) - midiOf(prev!)) <= 7);
            deg = fit.length ? fit.reduce((b, d) => (Math.abs(d - target) < Math.abs(b - target) ? d : b)) : prev;
          }
          // …and resolve a leap ≥ 6 by stepwise CONTRARY motion.
          if (lastLeapSemis >= 6 && lastLeapDir !== 0) {
            const contrary = allowed.filter((d) => (lastLeapDir > 0 ? d < prev! : d > prev!) && Math.abs(midiOf(d) - midiOf(prev!)) <= 3);
            if (contrary.length) deg = lastLeapDir > 0 ? Math.max(...contrary) : Math.min(...contrary);
          }
        }
      }
      const isFinal = noteIdx === total - 1;
      if (isFinal && k === 0 && o.endOn?.length) {
        // Phrase arcs FALL HOME: the line lands on the tonic/third (nearest to where we are).
        const cands = o.endOn.map((e) => nearest(e));
        deg = prev == null ? cands[0]! : cands.reduce((b, d) => (Math.abs(midiOf(d) - midiOf(prev!)) < Math.abs(midiOf(b) - midiOf(prev!)) ? d : b));
      }
      if (isFinal && k === 0 && o.contour === 'rise' && prev != null && deg <= prev) {
        const above = allowed.find((d) => d > prev!);
        if (above != null) deg = above; // the pre-hook RISES into the hook, always
      }
      if (prev != null) {
        lastLeapSemis = Math.abs(midiOf(deg) - midiOf(prev));
        lastLeapDir = Math.sign(midiOf(deg) - midiOf(prev));
      }
      degrees.push(deg);
      prev = deg;
      noteIdx++;
    }
  }
  return degrees;
}

// ---------------------------------------------------------------------------
// Rhythm — anchor-first placement on the strong grid, fit-guarded
// ---------------------------------------------------------------------------

const MIN_STEP = 0.25;
const END_GAP = 0.5; // breath law is ≥ 0.25 — we leave 0.5 so the swing can't eat it

function lineRhythm(o: {
  units: SylUnit[];
  lineStart: number;
  lineEnd: number;
  kind: SectionKind;
  density: MelodyDensity;
  rng: () => number;
  /** 0 = beats 1/3; 0.5 = the off-beat push (syncopation > 0.6, the Afro pocket). */
  strongOffset: 0 | 0.5;
}): Array<{ start: number; dur: number }> {
  const total = o.units.reduce((a, u) => a + u.notes, 0);
  const usableEnd = o.lineEnd - END_GAP;
  const window = usableEnd - o.lineStart;
  const out: Array<{ start: number; dur: number }> = [];
  if (total <= 0) return out;
  if (total * MIN_STEP > window) {
    // Crowded line — honest uniform compression. Prosody suffers, the FIT LAW never does.
    const step = window / total;
    let cur = o.lineStart;
    for (let i = 0; i < total; i++) {
      out.push({ start: cur, dur: Math.max(0.05, step * 0.9) });
      cur += step;
    }
    return out;
  }
  const durChoices = DENSITY_DURS[o.density];
  let cur = o.lineStart;
  let placed = 0;
  for (const u of o.units) {
    for (let k = 0; k < u.notes; k++) {
      const remainingAfter = total - placed - 1;
      if (u.anchor && k === 0) {
        // PROSODY LAW: jump the anchor forward to the next strong position —
        // only when every remaining syllable still fits (fit law outranks it).
        const s = Math.ceil((cur - o.strongOffset) / 2 - 1e-9) * 2 + o.strongOffset;
        if (s >= cur - 1e-9 && s + (remainingAfter + 1) * MIN_STEP <= usableEnd + 1e-9) cur = Math.max(cur, s);
      }
      const isLineFinal = placed === total - 1;
      let dur: number;
      if (isLineFinal && o.kind === 'hook') dur = clamp(usableEnd - cur, 0.5, 2); // open-vowel long note on the hook line end
      else if (isLineFinal) dur = clamp(usableEnd - cur, 0.5, 1.5); // every phrase tail rings a little
      else if (u.notes > 1) dur = 0.5; // melisma holds in even 8th steps
      else if (u.anchor && k === 0) dur = 1; // anchors carry weight
      else dur = durChoices[Math.floor(o.rng() * durChoices.length)]!;
      const maxDur = usableEnd - cur - remainingAfter * MIN_STEP;
      if (dur > maxDur) dur = Math.max(MIN_STEP, maxDur);
      out.push({ start: cur, dur });
      cur += dur;
      placed++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

function motifDegreeOf(motifNote: string | undefined, key: ParsedKey, lo: number, hi: number, afro: boolean): number | undefined {
  if (!motifNote) return undefined;
  const m = /^\s*([a-gA-G])\s*([#b])?\s*$/.exec(motifNote);
  if (!m) return undefined;
  let pc = LETTER_PC[m[1]!.toLowerCase()]!;
  if (m[2] === '#') pc = (pc + 1) % 12;
  if (m[2] === 'b') pc = (pc + 11) % 12;
  const penta = PENTA_DEGREES[key.mode];
  for (let d = lo; d <= hi; d++) {
    if (afro && !penta.has((((d - 1) % 7) + 7) % 7 + 1)) continue; // hook stays pentatonic
    if (((degreeToMidi(key, d) % 12) + 12) % 12 === pc) return d;
  }
  return undefined; // out of key/palette → ignored (grounding: taste never breaks the scale law)
}

/**
 * Compose the vocal melody — explicit notes per syllable, deterministic per
 * seed. This is the WHOLE composer: the taste layer (melodyBrain) only hands
 * it phrasing parameters; no model ever emits a note.
 */
export function composeMelody(opts: ComposeMelodyOpts): MelodyScore {
  const key = parseKey(opts.key);
  const afro = isAfroLane(opts.genre);
  const feel = laneFeel(opts.genre);
  const swing = clamp(opts.swing ?? feel.swing, 0, 0.8);
  const sync = clamp(opts.syncopation ?? feel.syncopation, 0, 1);
  const strongOffset: 0 | 0.5 = sync > 0.6 ? 0.5 : 0;
  const rng = mulberry32(opts.seed >>> 0);
  // THE HOOK CELL LAW spans the whole score: hook and hook2 share the cell.
  const cellCache = new Map<string, number[]>();

  const sections: MelodySection[] = [];
  for (const sIn of opts.sections) {
    const tpl = KIND_TEMPLATE[sIn.kind] ?? KIND_TEMPLATE.other;
    const lines = sIn.lines.map((l) => l.trim()).filter(Boolean);
    const bars = Math.round(clamp(sIn.bars ?? lines.length * 2, 2, 32));
    const totalBeats = bars * 4;
    const notes: MelodyNote[] = [];
    if (lines.length) {
      // Line starts quantized to the 2-beat STRONG grid (falls back to 0.5 when
      // the section is crowded) — repeated hook lines land on the same grid
      // phase, so their cached rhythm reads identically.
      const rawSpan = totalBeats / lines.length;
      const grid = rawSpan >= 2 ? 2 : 0.5;
      const starts: number[] = lines.map((_, i) => Math.round((i * rawSpan) / grid) * grid);
      for (let i = 1; i < starts.length; i++) if (starts[i]! <= starts[i - 1]!) starts[i] = starts[i - 1]! + grid;
      const anchorSet = new Set((sIn.anchors ?? []).map(foldWord).filter(Boolean));
      const density = sIn.density ?? tpl.density;
      const contour = sIn.contour ?? tpl.contour;
      const motifDegree = sIn.kind === 'hook' ? motifDegreeOf(sIn.motifNote, key, tpl.lo, tpl.hi, afro) : undefined;
      for (let li = 0; li < lines.length; li++) {
        const lineStart = Math.min(starts[li]!, totalBeats - 1);
        const lineEnd = li + 1 < lines.length ? Math.min(starts[li + 1]!, totalBeats) : totalBeats;
        if (lineEnd - lineStart < MIN_STEP + END_GAP) continue; // no room — skip rather than overflow
        const units = lineUnits(lines[li]!, anchorSet);
        if (!units.length) continue;
        const cellKey = sIn.kind === 'hook' ? tokensOf(lines[li]!).map(foldWord).join(' ') : '';
        let degrees: number[];
        const cached = cellKey ? cellCache.get(cellKey) : undefined;
        if (cached) {
          degrees = cached; // the repeated lyric line keeps its EXACT pitches
        } else {
          degrees = linePitches({
            units, key, rng, afro, kind: sIn.kind, contour, lo: tpl.lo, hi: tpl.hi,
            startDegree: sIn.startDegree, motifDegree, endOn: tpl.endOn, firstLineOfSection: li === 0,
          });
          if (cellKey) cellCache.set(cellKey, degrees);
        }
        const rhythm = lineRhythm({ units, lineStart, lineEnd, kind: sIn.kind, density, rng, strongOffset });
        let ni = 0;
        for (const u of units) {
          for (let k = 0; k < u.notes; k++) {
            const r = rhythm[ni]!;
            notes.push({
              startBeat: r4(r.start),
              durBeats: r4(r.dur),
              midi: degreeToMidi(key, degrees[ni]!),
              syllable: u.syllable,
              ...(u.anchor && k === 0 ? { anchor: true } : {}),
            });
            ni++;
          }
        }
      }
      // SWING LAW — the lilt: every second 8th (the x.5 positions) slides late.
      if (swing >= 0.54) {
        const lilt = (swing - 0.5) * 0.5;
        for (const n of notes) {
          const frac = ((n.startBeat % 1) + 1) % 1;
          if (Math.abs(frac - 0.5) < 1e-6) n.startBeat = r4(n.startBeat + lilt);
        }
        for (let i = 0; i + 1 < notes.length; i++) {
          const nx = notes[i + 1]!;
          if (notes[i]!.startBeat + notes[i]!.durBeats > nx.startBeat) {
            notes[i]!.durBeats = r4(Math.max(0.125, nx.startBeat - notes[i]!.startBeat));
          }
        }
        const last = notes[notes.length - 1];
        if (last && last.startBeat + last.durBeats > totalBeats - 0.25) {
          last.durBeats = r4(Math.max(0.125, totalBeats - 0.25 - last.startBeat));
        }
      }
    }
    sections.push({ name: sIn.name, kind: sIn.kind, bars, notes });
  }
  return { bpm: opts.bpm, key: opts.key, sections, seed: opts.seed };
}

// ---------------------------------------------------------------------------
// Validators — the gate MEASURES, never trusts
// ---------------------------------------------------------------------------

/** Ratio of notes whose pitch-class lives in the score's key (1 = 100% in key). */
export function scoreInKey(score: MelodyScore): number {
  const k = parseKey(score.key);
  const pcs = new Set(k.intervals.map((i) => (k.tonicPc + i) % 12));
  let total = 0;
  let ok = 0;
  for (const s of score.sections) {
    for (const n of s.notes) {
      total++;
      if (pcs.has(((n.midi % 12) + 12) % 12)) ok++;
    }
  }
  return total === 0 ? 1 : ok / total;
}

/**
 * Ratio of anchor notes sitting on a strong position: beats 1/3 (startBeat mod
 * 2 ≈ 0) or the off-beat push (mod 2 ≈ 0.5). Tolerance ±0.15 absorbs the swing
 * lilt (max +0.125). No anchors → 1 (nothing to violate).
 */
export function anchorsOnStrongBeats(score: MelodyScore): number {
  let total = 0;
  let strong = 0;
  for (const s of score.sections) {
    for (const n of s.notes) {
      if (!n.anchor) continue;
      total++;
      const pos = ((n.startBeat % 2) + 2) % 2;
      if (pos <= 0.15 || pos >= 1.85 || Math.abs(pos - 0.5) <= 0.15) strong++;
    }
  }
  return total === 0 ? 1 : strong / total;
}

/** Split a section's notes into phrases at breath gaps (≥ 0.2 beat of silence). */
function phrasesOf(notes: MelodyNote[]): MelodyNote[][] {
  const out: MelodyNote[][] = [];
  let cur: MelodyNote[] = [];
  for (let i = 0; i < notes.length; i++) {
    cur.push(notes[i]!);
    const next = notes[i + 1];
    if (!next || next.startBeat - (notes[i]!.startBeat + notes[i]!.durBeats) >= 0.2) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * THE HOOK CELL LAW, measured: across every hook section, phrases singing the
 * same words (≥ 2 notes, melisma-folded) must carry the SAME pitch sequence.
 * True when no repeated lyric fragment drifts (vacuously true with no repeats).
 */
export function hookCellRepeats(score: MelodyScore): boolean {
  const seen = new Map<string, string>();
  for (const s of score.sections) {
    if (s.kind !== 'hook') continue;
    for (const ph of phrasesOf(s.notes)) {
      if (ph.length < 2) continue; // cells, not stray syllables
      const key = ph.map((n) => foldWord(n.syllable)).join(' ').trim();
      if (!key) continue;
      const midis = ph.map((n) => n.midi).join(',');
      const prior = seen.get(key);
      if (prior !== undefined && prior !== midis) return false;
      if (prior === undefined) seen.set(key, midis);
    }
  }
  return true;
}

/** FIT LAW: every note inside its section's bars, starts monotonic, durations sane, sum ≤ bars*4. */
export function sectionsFitBars(score: MelodyScore): boolean {
  for (const s of score.sections) {
    const cap = s.bars * 4 + 1e-6;
    let sum = 0;
    let prevStart = -Infinity;
    for (const n of s.notes) {
      if (n.startBeat < -1e-6 || n.durBeats <= 0) return false;
      if (n.startBeat + n.durBeats > cap) return false;
      if (n.startBeat < prevStart - 1e-6) return false;
      prevStart = n.startBeat;
      sum += n.durBeats;
    }
    if (sum > cap) return false;
  }
  return true;
}

/** Total melodic span in semitones (singability law caps it at 14). */
export function melodySpanSemitones(score: MelodyScore): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of score.sections) {
    for (const n of s.notes) {
      if (n.midi < lo) lo = n.midi;
      if (n.midi > hi) hi = n.midi;
    }
  }
  return hi < lo ? 0 : hi - lo;
}
