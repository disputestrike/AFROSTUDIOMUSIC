/**
 * CONCEPT EXEMPLARS — the training corpus for the Hit Concept & Artist Identity
 * gate (owner directive 2026-07-13). The root cause of the danfo / pepper-soup /
 * "sip am bam" / "gbe body" failures is UPSTREAM of the lyricist: the concept
 * engine starts from "what Nigerian object can this mention?" instead of "what
 * does a human feel?". A record is not Nigerian because a danfo is in it.
 *
 * The teachable signal is the CONCEPT layer (human engine + title + why), not the
 * full lyric sheets — so this file stores the emotion-first pattern compactly:
 * POSITIVE exemplars to few-shot from, NEGATIVE exemplars to reject against, the
 * human-engine menu to generate from, and the object-removal test in code.
 */
import { ENVIRONMENT_NOUNS } from './lyric-qa';

/** The emotional starting points a concept MUST begin from — never a prop. */
export const HUMAN_ENGINES = [
  'love', 'desire', 'rejection', 'confidence', 'jealousy', 'freedom', 'celebration',
  'spiritual gratitude', 'regret', 'seduction', 'ambition', 'betrayal', 'playfulness',
  'status', 'longing', 'defiance', 'reconciliation', 'escape', 'intimacy', 'personal transformation',
] as const;

export interface ConceptExemplar {
  title: string;
  engine: string; // the one-sentence human engine — NO scenery
  lane?: string;
}

/** 50 emotion-first exemplars (owner-authored). None survive on scenery; every
 *  one starts from a feeling and yields a compact, chantable title. */
export const POSITIVE_CONCEPT_EXEMPLARS: ConceptExemplar[] = [
  { title: 'No Permission', engine: 'defiance and self-belief — I move without waiting for anyone to approve me' },
  { title: 'Call My Bluff', engine: 'two lovers each pretending they are ready to walk away' },
  { title: 'My Turn', engine: 'finally receiving recognition after years of being overlooked' },
  { title: 'Outside, Inside', engine: 'pretending to enjoy a party while still missing someone' },
  { title: 'Say Less', engine: 'mutual attraction that needs no explanation', lane: 'afro-r&b' },
  { title: 'No Be Today', engine: 'finally admitting a love hidden for years' },
  { title: 'Who Be That', engine: 'playful jealousy inside a relationship' },
  { title: 'Where My Power Stop', engine: 'faith after reaching the limit of personal strength' },
  { title: 'Too Late To Form', engine: 'an ex returns only after the singer becomes successful' },
  { title: 'Leave The Light On', engine: 'returning to repair a relationship after pride caused distance' },
  { title: 'Slow Poison', engine: 'knowing someone is dangerous but wanting them anyway', lane: 'dark afropop' },
  { title: 'Half Awake', engine: 'emotional numbness after a breakup', lane: 'afro-r&b' },
  { title: 'Only You Know', engine: 'a confident person becoming vulnerable with one lover' },
  { title: 'No Be Luck', engine: 'rejecting the idea that success happened by accident', lane: 'street-pop' },
  { title: 'Heavy Crown', engine: 'the loneliness and responsibility that come with success', lane: 'afrofusion' },
  { title: 'Come Around', engine: 'inviting a guarded lover to loosen up', lane: 'amapiano-pop' },
  { title: 'Fine By Me', engine: 'peaceful commitment rather than dramatic obsession', lane: 'highlife-pop' },
  { title: 'Encore', engine: 'wanting one more moment with someone before separation', lane: 'francophone afropop' },
  { title: 'Stay Till Morning', engine: 'asking someone not to leave during an emotionally hard night', lane: 'sa soul-pop' },
  { title: "Don't Wake The Feeling", engine: 'two exes trying not to restart an unhealthy relationship', lane: 'alt-afropop' },
  { title: 'Bend The Rules', engine: 'a disciplined person wanting one reckless night', lane: 'dancehall-pop' },
  { title: 'Dime Otra Vez', engine: 'needing reassurance from an inconsistent lover', lane: 'latin crossover' },
  { title: 'Move Like Water', engine: 'freedom from self-consciousness', lane: 'brazilian dance-pop' },
  { title: 'Red-Light Heart', engine: 'unable to stop pursuing someone despite the warning signs', lane: 'global dance-pop' },
  { title: 'Late Reply', engine: 'pretending not to care while waiting for a message', lane: 'uk afro-swing' },
  { title: 'Room For Two', engine: 'asking a guarded person to make space for intimacy', lane: 'global r&b' },
  { title: 'Front-Porch Light', engine: 'leaving a visible sign that someone is still welcome home', lane: 'country-pop' },
  { title: 'Habibi Slow', engine: 'asking an intense lover not to rush the connection', lane: 'arabic crossover' },
  { title: 'Dil No Hide', engine: 'a heart revealing attraction despite verbal denial', lane: 'indian crossover' },
  { title: 'Alive Again', engine: 'recovering the ability to feel after a difficult period', lane: 'global dance' },
  { title: 'My Side', engine: 'asking a guarded person to stop hiding a mutual attraction' },
  { title: 'One Condition', engine: 'playful boundaries before beginning a romance' },
  { title: 'Easy Baby', engine: 'attraction that grows stronger when neither person rushes', lane: 'afro-r&b' },
  { title: 'No Dey Hide', engine: 'calling out someone whose behavior already reveals attraction' },
  { title: 'Carry Me Go', engine: 'wanting temporary escape with someone you trust' },
  { title: 'Again Again', engine: 'repeatedly returning to a relationship you know is unstable' },
  { title: 'Ma Lo', engine: 'asking a lover to stay long enough for an honest conversation', lane: 'yoruba' },
  { title: 'Mo Feran Re', engine: 'finally saying the love that pride concealed', lane: 'yoruba' },
  { title: 'Je Ka Jo', engine: 'using movement to interrupt anxiety and overthinking', lane: 'yoruba amapiano' },
  { title: 'Okan Mi', engine: 'entrusting your vulnerability to someone who could hurt you', lane: 'yoruba afro-soul' },
  { title: 'Bia Nso', engine: 'closing emotional distance without demanding commitment', lane: 'igbo' },
  { title: 'Obi M', engine: 'a heart reacting before the mind can control it', lane: 'igbo afro-r&b' },
  { title: 'Nkem', engine: 'finding emotional home in a person without treating them as property', lane: 'igbo highlife' },
  { title: 'Acho M Gi', engine: 'wanting the whole real person, not one exciting night', lane: 'igbo' },
  { title: 'Receipts', engine: 'proving progress through evidence instead of empty boasting', lane: 'afro-drill rap' },
  { title: 'Pressure Introduced Me', engine: 'discovering who you are through adversity', lane: 'rap' },
  { title: 'No Caption', engine: 'letting visible progress speak without self-promotion', lane: 'afro-swing rap' },
  { title: 'Leh-Yo', engine: 'inviting someone circling you to finally approach', lane: 'afro-latin (vocable hook)' },
  { title: 'Na-Reh-Na', engine: 'wanting to stay inside a dreamlike romantic moment', lane: 'dreamy afro-r&b (vocable)' },
  { title: 'Eh-Ya-Eh', engine: 'releasing self-consciousness through collective movement', lane: 'afro-house (vocable)' },
];

/** The failures — stored as negative training with the reason each was rejected. */
export const NEGATIVE_CONCEPT_EXEMPLARS: Array<{ title: string; why: string }> = [
  { title: 'Sip Am Bam (Mama Titi pepper soup)', why: 'scenery-first: an inventory of streetlight/danfo/pepper/broth; the hook is a food-vendor advert; "sip am bam" is a meaningless manufactured chant; no emotional center.' },
  { title: 'Gbe Body (Danfo Lane)', why: 'a generic party record that chose "danfo" because it is Nigerian, not because it means anything; manufactured crowd ("everybody wan go viral"); "boom" is filler; decorative named characters (Kemi, Uncle Tunde).' },
  { title: 'CATALOGUE TEMPLATE', why: 'Nigerian object -> detailed scene -> crowd gathers -> invented chant -> everyone dances -> DJ will not stop -> explained outro. Reject on sight.' },
];

/** The distilled principles the concept gate injects into the prompt. */
export const CONCEPT_LAW_BRIEF = `HIT CONCEPT LAW (this decides whether a song should exist):
- Begin with a HUMAN ENGINE (an emotion, desire, conflict, attitude, vulnerability, or victory), NEVER a Nigerian object, place, food, vehicle, instrument, or crowd scene.
- OBJECT-REMOVAL TEST: remove every place/food/transport/instrument/cultural prop. If the concept dies, it was scenery, not a song — REJECT it. (Kept only when a location IS the artist's real story/metaphor, like Ojuelegba.)
- The concept must be one sentence with NO production terms, locations, foods, or artist names. Good: "A shy person keeps denying an attraction their body already revealed." Bad: "A lively song about people dancing beside a danfo."
- The title is a compact emotional phrase (1-4 words, open vowels, chantable) that survives with all setting words removed. The canon this session authored: No Permission, Call My Bluff, Only You Know, My Side, No Dey Hide, Again Again, Say Less.
- Local language/detail may ONLY enter later, where the character naturally speaks that way — never to "prove" the song is African.`;

/** Pure OBJECT-REMOVAL TEST: is a concept/premise scenery-dependent — i.e. does
 *  its meaning collapse to environment nouns? True when, after removing setting
 *  words and stopwords, almost nothing emotional remains, OR setting nouns are
 *  the majority of the content words. */
const CONCEPT_STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'with', 'about', 'song', 'record', 'lively', 'people', 'dancing', 'dance', 'party', 'night', 'vibe', 'beat', 'afrobeats', 'amapiano']);
export function conceptSceneryDependent(concept: string): boolean {
  const words = (concept ?? '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !CONCEPT_STOP.has(w));
  if (words.length < 2) return true; // no real content
  const env = words.filter((w) => ENVIRONMENT_NOUNS.has(w)).length;
  const content = words.filter((w) => !ENVIRONMENT_NOUNS.has(w));
  // Scenery-dependent when setting nouns dominate OR nothing emotional survives
  // their removal (the object-removal test: strip props -> concept collapses).
  return env >= content.length || content.length < 2;
}
