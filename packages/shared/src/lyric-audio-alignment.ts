export interface LyricAudioAlignmentScore {
  pass: boolean;
  overall: number;
  tokenRecall: number;
  uniqueRecall: number;
  precision: number;
  orderRecall: number;
  expectedTokens: number;
  heardTokens: number;
  matchedTokens: number;
  failures: string[];
  warnings: string[];
}

const SECTION_WORDS = new Set([
  'intro', 'verse', 'prechorus', 'pre', 'chorus', 'hook', 'postchorus', 'post',
  'bridge', 'refrain', 'outro', 'interlude', 'breakdown', 'rap', 'spoken',
]);

/** Normalize Latin diacritics (including Yoruba tone marks) without flattening
 * non-Latin scripts. Section labels and repeat notation are instructions, not
 * words the singer is expected to perform. */
export function lyricAlignmentTokens(value: string): string[] {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/^[ \t]*(?:intro|verse|pre[- ]?chorus|chorus|hook|post[- ]?chorus|bridge|refrain|outro|interlude|breakdown|rap|spoken)(?:\s+\d+)?\s*:\s*/gimu, '')
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => !SECTION_WORDS.has(token) && !/^x\d+$/.test(token)) ?? [];
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.max(a.length, b.length) < 5) return false;
  if (a.length === b.length) {
    let differences = 0;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i] && ++differences > 1) return false;
    }
    return true;
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      j += 1;
    }
  }
  return true;
}

function fuzzyOverlap(expected: string[], heard: string[]): number {
  const used = new Set<number>();
  let matched = 0;
  for (const token of expected) {
    let index = heard.findIndex((candidate, i) => !used.has(i) && candidate === token);
    if (index < 0) {
      index = heard.findIndex((candidate, i) => !used.has(i) && editDistanceAtMostOne(candidate, token));
    }
    if (index >= 0) {
      used.add(index);
      matched += 1;
    }
  }
  return matched;
}

function lcsLength(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  // Song lyrics are normally well below this cap. Two rolling rows avoid an
  // unbounded matrix if a provider returns pathological transcript text.
  const left = a.slice(0, 2500);
  const right = b.slice(0, 2500);
  let previous = new Uint16Array(right.length + 1);
  let current = new Uint16Array(right.length + 1);
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = left[i - 1] === right[j - 1]
        ? previous[j - 1]! + 1
        : Math.max(previous[j]!, current[j - 1]!);
    }
    [previous, current] = [current, previous];
    current.fill(0);
  }
  return previous[right.length]!;
}

const ratio = (numerator: number, denominator: number): number =>
  denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : 0;

/** Compare an independent ASR transcript with the approved lyric. This is a
 * conservative identity gate, not a pronunciation grader: one-character ASR
 * misses are tolerated, while invented/reordered songs still score poorly. */
export function scoreLyricAudioAlignment(expectedLyric: string, transcript: string): LyricAudioAlignmentScore {
  const expected = lyricAlignmentTokens(expectedLyric);
  const heard = lyricAlignmentTokens(transcript);
  const matchedTokens = fuzzyOverlap(expected, heard);
  const expectedUnique = [...new Set(expected)];
  const heardUnique = [...new Set(heard)];
  const matchedUnique = fuzzyOverlap(expectedUnique, heardUnique);
  const tokenRecall = ratio(matchedTokens, expected.length);
  const uniqueRecall = ratio(matchedUnique, expectedUnique.length);
  const precision = ratio(matchedTokens, heard.length);
  const orderRecall = ratio(lcsLength(expected, heard), Math.min(expected.length, heard.length));
  const overall = Math.round((tokenRecall * 0.35 + uniqueRecall * 0.35 + precision * 0.2 + orderRecall * 0.1) * 10_000) / 10_000;

  const failures: string[] = [];
  if (expected.length < 6) failures.push('expected_lyric_too_short');
  if (heard.length < 6) failures.push('no_reliable_sung_words_detected');
  if (tokenRecall < 0.28) failures.push('too_few_expected_words_heard');
  if (uniqueRecall < 0.45) failures.push('lyric_identity_mismatch');
  if (precision < 0.35) failures.push('too_many_unexpected_words');
  if (orderRecall < 0.18) failures.push('lyric_order_mismatch');
  if (overall < 0.42) failures.push('alignment_score_below_gate');

  const warnings: string[] = [];
  if (!failures.length && tokenRecall < 0.5) warnings.push('partial_lyric_recall');
  if (!failures.length && orderRecall < 0.4) warnings.push('weak_sequence_evidence');
  return {
    pass: failures.length === 0,
    overall,
    tokenRecall,
    uniqueRecall,
    precision,
    orderRecall,
    expectedTokens: expected.length,
    heardTokens: heard.length,
    matchedTokens,
    failures,
    warnings,
  };
}
