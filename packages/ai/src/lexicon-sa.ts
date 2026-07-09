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
  // ---- isiZulu (expansion — common documented vocabulary) ----
  R('hamba', 'zu', 'street', 'go / leave'), R('hamba kahle', 'zu', 'slang', 'go well / goodbye'),
  R('sala kahle', 'zu', 'slang', 'stay well / goodbye'), R('kahle', 'zu', 'adlib', 'well / nicely / slowly'),
  R('manje', 'zu', 'party', 'now'), R('namhlanje', 'zu', 'street', 'today'),
  R('ntombi', 'zu', 'love', 'girl / young woman'), R('nsizwa', 'zu', 'street', 'young man'),
  R('umfana', 'zu', 'street', 'boy'), R('indoda', 'zu', 'street', 'man'),
  R('umfazi', 'zu', 'street', 'woman / wife'), R('ikhaya', 'zu', 'love', 'home'),
  R('imali', 'zu', 'street', 'money'), R('umsebenzi', 'zu', 'street', 'work / job'),
  R('ubusuku', 'zu', 'party', 'night'), R('ilanga', 'zu', 'party', 'sun / day'),
  R('inyanga', 'zu', 'love', 'moon / month'), R('izulu', 'zu', 'faith', 'heaven / sky'),
  R('inkosi', 'zu', 'faith', 'king / lord'), R('nkulunkulu', 'zu', 'faith', 'God'),
  R('siyabonga', 'zu', 'faith', 'we give thanks'), R('gida', 'zu', 'party', 'dance'),
  R('cula', 'zu', 'party', 'sing'), R('ingoma', 'zu', 'party', 'song'),
  R('phuza', 'zu', 'party', 'drink'), R('jabula', 'zu', 'party', 'be happy / rejoice'),
  R('ubumnandi', 'zu', 'party', 'sweetness / enjoyment'), R('kanjani', 'zu', 'slang', 'how'),

  // ---- isiXhosa (expansion) ----
  R('hamba kakuhle', 'xh', 'slang', 'go well / goodbye'), R('sala kakuhle', 'xh', 'slang', 'stay well'),
  R('ewe', 'xh', 'adlib', 'yes'), R('hayi', 'xh', 'adlib', 'no'),
  R('intombi', 'xh', 'love', 'girl / young woman'), R('umfana', 'xh', 'street', 'boy / young man'),
  R('indoda', 'xh', 'street', 'man'), R('umfazi', 'xh', 'street', 'woman / wife'),
  R('ikhaya', 'xh', 'love', 'home'), R('imali', 'xh', 'street', 'money'),
  R('umsebenzi', 'xh', 'street', 'work'), R('ubusuku', 'xh', 'party', 'night'),
  R('ilanga', 'xh', 'party', 'sun / day'), R('inyanga', 'xh', 'love', 'moon'),
  R('izulu', 'xh', 'faith', 'sky / heaven'), R('inkosi', 'xh', 'faith', 'chief / lord'),
  R('uthixo', 'xh', 'faith', 'God'), R('camagu', 'xh', 'faith', 'blessing / it is honored (ancestral)'),
  R('xola', 'xh', 'love', 'be at peace / calm'), R('ngxatsho', 'xh', 'adlib', 'well done / right on'),
  R('duduza', 'xh', 'love', 'comfort / console'), R('vuya', 'xh', 'party', 'rejoice'),
  R('ingoma', 'xh', 'party', 'song'), R('dansa', 'xh', 'party', 'dance'),
  R('ubomi', 'xh', 'street', 'life'), R('kanjani', 'xh', 'slang', 'how'),

  // ---- Sesotho (expansion) ----
  R('dumela', 'st', 'slang', 'hello'), R('kea leboha', 'st', 'faith', 'thank you'),
  R('kea u rata', 'st', 'love', 'I love you'), R('lerato', 'st', 'love', 'love'),
  R('pelo', 'st', 'love', 'heart'), R('ngwanana', 'st', 'love', 'girl'),
  R('moshanyana', 'st', 'street', 'boy'), R('monna', 'st', 'street', 'man'),
  R('mosadi', 'st', 'street', 'woman'), R('lehae', 'st', 'love', 'home'),
  R('chelete', 'st', 'street', 'money'), R('mosebetsi', 'st', 'street', 'work'),
  R('bosiu', 'st', 'party', 'night'), R('letsatsi', 'st', 'party', 'sun / day'),
  R('kgwedi', 'st', 'love', 'moon / month'), R('lehodimo', 'st', 'faith', 'heaven'),
  R('morena', 'st', 'faith', 'lord / chief'), R('modimo', 'st', 'faith', 'God'),
  R('bina', 'st', 'party', 'sing / dance'), R('pina', 'st', 'party', 'song'),
  R('thabile', 'st', 'party', 'happy'), R('bophelo', 'st', 'street', 'life'),
  R('tsamaya hantle', 'st', 'slang', 'go well / goodbye'), R('sala hantle', 'st', 'slang', 'stay well'),
  R('ee', 'st', 'adlib', 'yes'), R('tjhe', 'st', 'adlib', 'no'),
  R('matla', 'st', 'street', 'power / strength'),

  // ---- Setswana (expansion) ----
  R('dumela', 'tn', 'slang', 'hello'), R('ke a leboga', 'tn', 'faith', 'thank you'),
  R('ke a go rata', 'tn', 'love', 'I love you'), R('lorato', 'tn', 'love', 'love'),
  R('pelo', 'tn', 'love', 'heart'), R('mosetsana', 'tn', 'love', 'girl'),
  R('mosimane', 'tn', 'street', 'boy'), R('monna', 'tn', 'street', 'man'),
  R('mosadi', 'tn', 'street', 'woman'), R('legae', 'tn', 'love', 'home'),
  R('madi', 'tn', 'street', 'money'), R('tiro', 'tn', 'street', 'work'),
  R('bosigo', 'tn', 'party', 'night'), R('letsatsi', 'tn', 'party', 'sun / day'),
  R('kgwedi', 'tn', 'love', 'moon / month'), R('legodimo', 'tn', 'faith', 'heaven'),
  R('morena', 'tn', 'faith', 'lord'), R('modimo', 'tn', 'faith', 'God'),
  R('bina', 'tn', 'party', 'dance / sing'), R('pina', 'tn', 'party', 'song'),
  R('itumetse', 'tn', 'party', 'happy'), R('botshelo', 'tn', 'street', 'life'),
  R('tsamaya sentle', 'tn', 'slang', 'go well'), R('sala sentle', 'tn', 'slang', 'stay well'),
  R('ee', 'tn', 'adlib', 'yes'), R('nnyaa', 'tn', 'adlib', 'no'),
  R('maatla', 'tn', 'street', 'power'),

  // ---- tsotsitaal / township (expansion — long-documented SA slang) ----
  R('eita', 'tsotsitaal', 'slang', 'hey / hello'), R('heita', 'tsotsitaal', 'slang', 'hello (greeting)'),
  R('hola', 'tsotsitaal', 'slang', 'hi (township greeting)'), R('sho', 'tsotsitaal', 'adlib', 'sure / okay / respect'),
  R('sharp sharp', 'tsotsitaal', 'adlib', 'all good / goodbye'), R('aweh', 'tsotsitaal', 'adlib', 'hey / acknowledged'),
  R('bra', 'tsotsitaal', 'street', 'brother / friend'), R('majita', 'tsotsitaal', 'street', 'the guys / homies'),
  R('cherrie', 'tsotsitaal', 'love', 'girlfriend'), R('gents', 'tsotsitaal', 'street', 'the gentlemen / crew'),
  R('spaza', 'tsotsitaal', 'street', 'township corner shop'), R('kasi', 'tsotsitaal', 'street', 'township / the hood'),
  R('ekasi', 'tsotsitaal', 'street', 'in the township'), R('mzansi', 'tsotsitaal', 'street', 'South Africa'),
  R('groove', 'tsotsitaal', 'party', 'a party / night out'), R('jol', 'tsotsitaal', 'party', 'party / have fun'),
  R('vibe', 'tsotsitaal', 'party', 'atmosphere / energy'), R('zaka', 'tsotsitaal', 'street', 'money'),
  R('moola', 'tsotsitaal', 'street', 'money'), R('skhokho', 'tsotsitaal', 'street', 'boss / top achiever'),
  R('grootman', 'tsotsitaal', 'street', 'elder / big man (respect)'), R('laaitie', 'tsotsitaal', 'street', 'youngster'),
  R('gwara gwara', 'tsotsitaal', 'party', 'popular SA dance move'), R('phanda', 'tsotsitaal', 'street', 'hustle / make a plan'),
  R('shisanyama', 'tsotsitaal', 'party', 'braai spot / grilled-meat hangout'), R('stokvel', 'tsotsitaal', 'street', 'community savings club'),
  R('yebo yes', 'tsotsitaal', 'adlib', 'emphatic yes'), R('ayoba', 'tsotsitaal', 'party', 'cool / exciting'),
];
