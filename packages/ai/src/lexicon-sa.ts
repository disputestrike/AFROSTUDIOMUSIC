import type { SeedLexRow } from './lexicon-seed';

/**
 * SOUTH AFRICAN starter lexicon — isiZulu (zu), isiXhosa (xh), Sesotho (st),
 * Setswana (tn) and tsotsitaal (SA township slang). The amapiano Sound-DNA prescribes
 * these languages, and the bank had ZERO — so the lyric engine pulled Naija vernacular
 * into Pretoria records (§11).
 *
 * HONESTY: this is a small, HIGH-CONFIDENCE starter of widely-documented common words —
 * NOT Yoruba-parity, and NOT a substitute for a native speaker. Every entry is tagged
 * 'needs_native_review', and a song in these languages stays BLOCKED from release until
 * a native reviewer signs off (REVIEW_LANGS gate). Seed the rest with a native speaker.
 */
const R = (term: string, language: string, category: string, meaning: string, register = 'casual'): SeedLexRow =>
  ({ term, language, category, register, meaning, tags: ['needs_native_review', 'sa_seed'] });

export const SA_LEXICON: SeedLexRow[] = [
  // ---- isiZulu ----
  R('sawubona', 'zu', 'slang', 'hello (to one)'), R('sanibonani', 'zu', 'slang', 'hello (to many)'),
  R('unjani', 'zu', 'slang', 'how are you'), R('ngiyabonga', 'zu', 'faith', 'thank you'),
  R('ngiyakuthanda', 'zu', 'love', 'I love you'), R('sthandwa', 'zu', 'love', 'darling / beloved'),
  R('uthando', 'zu', 'love', 'love'), R('inhliziyo', 'zu', 'love', 'heart'),
  R('baba', 'zu', 'faith', 'father'), R('mama', 'zu', 'faith', 'mother'),
  R('yebo', 'zu', 'adlib', 'yes'), R('eish', 'zu', 'adlib', 'expression of surprise/frustration'),
  R('amandla', 'zu', 'street', 'power / strength'), R('ubuntu', 'zu', 'proverb', 'humanity / I am because we are'),
  R('umoya', 'zu', 'faith', 'spirit / wind'), R('impilo', 'zu', 'street', 'life'),
  R('phambili', 'zu', 'party', 'forward / onward'), R('woza', 'zu', 'party', 'come'),
  // ---- isiXhosa ----
  R('molo', 'xh', 'slang', 'hello (to one)'), R('molweni', 'xh', 'slang', 'hello (to many)'),
  R('unjani', 'xh', 'slang', 'how are you'), R('enkosi', 'xh', 'faith', 'thank you'),
  R('ndiyakuthanda', 'xh', 'love', 'I love you'), R('sithandwa', 'xh', 'love', 'beloved'),
  R('uthando', 'xh', 'love', 'love'), R('intliziyo', 'xh', 'love', 'heart'),
  R('tata', 'xh', 'faith', 'father'), R('mama', 'xh', 'faith', 'mother'),
  R('ewe', 'xh', 'adlib', 'yes'), R('hayi', 'xh', 'adlib', 'no'),
  R('ubomi', 'xh', 'street', 'life'), R('camagu', 'xh', 'proverb', 'expression of thanks / blessing'),
  // ---- Sesotho ----
  R('dumela', 'st', 'slang', 'hello'), R('o kae', 'st', 'slang', 'how are you'),
  R('kea leboha', 'st', 'faith', 'thank you'), R('kea u rata', 'st', 'love', 'I love you'),
  R('moratuoa', 'st', 'love', 'beloved'), R('lerato', 'st', 'love', 'love'),
  R('pelo', 'st', 'love', 'heart'), R('ntate', 'st', 'faith', 'father'),
  R('mme', 'st', 'faith', 'mother'), R('bophelo', 'st', 'street', 'life'),
  R('matla', 'st', 'street', 'power'), R('hle', 'st', 'adlib', 'please (softener)'),
  // ---- Setswana ----
  R('dumela', 'tn', 'slang', 'hello'), R('ke a leboga', 'tn', 'faith', 'thank you'),
  R('ke a go rata', 'tn', 'love', 'I love you'), R('lorato', 'tn', 'love', 'love'),
  R('pelo', 'tn', 'love', 'heart'), R('rre', 'tn', 'faith', 'father / sir'),
  R('mme', 'tn', 'faith', 'mother'), R('botshelo', 'tn', 'street', 'life'),
  R('maatla', 'tn', 'street', 'power'), R('ee', 'tn', 'adlib', 'yes'),
  // ---- tsotsitaal (SA township slang; mixed roots) ----
  R('heita', 'tsotsitaal', 'slang', 'hi / hey'), R('aweh', 'tsotsitaal', 'slang', 'yes / hi / agreed'),
  R('sharp', 'tsotsitaal', 'adlib', 'ok / cool / all good'), R('sharp sharp', 'tsotsitaal', 'adlib', 'all good, quickly'),
  R('lekker', 'tsotsitaal', 'party', 'nice / great'), R('jol', 'tsotsitaal', 'party', 'party / fun / have a good time'),
  R('mzansi', 'tsotsitaal', 'street', 'South Africa'), R('grootman', 'tsotsitaal', 'street', 'big man / boss / elder'),
  R('eish', 'tsotsitaal', 'adlib', 'expression of dismay / surprise'), R('yebo', 'tsotsitaal', 'adlib', 'yes'),
  R('zol', 'tsotsitaal', 'party', 'roll-up / joint'), R('skhotheni', 'tsotsitaal', 'street', 'thug / streetwise guy'),
];
