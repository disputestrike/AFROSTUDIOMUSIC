/**
 * FORGE PROMPT LIBRARY — one isolated-loop prompt for EVERY material role.
 *
 * The Executive-Summary spec: each role (conga ≠ shekere ≠ cowbell ≠ talking
 * drum) is forged as its OWN isolated loop with character (swing, human timing,
 * warmth) — never a generic "percussion" blob — melodic roles in the target KEY,
 * so separately-forged loops fit together. Curated descriptors for the roles
 * that define Afro genres; a family-template fallback makes EVERY taxonomy role
 * forgeable so a genre kit can always self-provision (no manual gaps).
 */
import { familyOf, isKeyedRole, isMaterialRole, type MaterialRole } from '@afrohit/shared';
export { isKeyedRole } from '@afrohit/shared';

const ISO = 'no other instruments, no vocals, seamless loop';
const g2 = (g: string) => g.replace(/_/g, ' ');

/** Curated role descriptors — the sound that makes each role ITSELF. */
const DESCRIPTORS: Partial<Record<MaterialRole, (g: string, b: number, k?: string) => string>> = {
  // --- drum kit ---
  kick: (g, b) => `solo ${g2(g)} kick drum pattern, ${b} bpm — deep tuned punchy kick with warm sub weight, human pocket; kick only, ${ISO}`,
  kick_808: (g, b) => `solo 808 kick pattern for ${g2(g)}, ${b} bpm — saturated booming 808 kick, tight transient; kick only, ${ISO}`,
  soft_kick: (g, b) => `solo soft deep-house kick for ${g2(g)}, ${b} bpm — rounded soft kick, warm and unobtrusive; kick only, ${ISO}`,
  snare: (g, b) => `solo ${g2(g)} snare pattern, ${b} bpm — crisp snare with ghost notes and human timing; snare only, ${ISO}`,
  rimshot: (g, b) => `solo rimshot pattern for ${g2(g)}, ${b} bpm — woody clicky rimshots on the backbeat with syncopated accents; rimshot only, ${ISO}`,
  clap: (g, b) => `solo clap pattern for ${g2(g)}, ${b} bpm — layered organic handclaps with room, on the backbeat; claps only, ${ISO}`,
  closed_hat: (g, b) => `solo closed hi-hat groove for ${g2(g)}, ${b} bpm — crisp swung 16th hats with velocity variation and ghost accents; hats only, ${ISO}`,
  open_hat: (g, b) => `solo open hi-hat offbeat pattern for ${g2(g)}, ${b} bpm — sizzling open hats on the offbeats; hats only, ${ISO}`,
  tom_fill: (g, b) => `solo tom fill for ${g2(g)}, ${b} bpm — descending tom roll building into a downbeat; toms only, one fill, not a loop, ${ISO}`,
  drum_roll: (g, b) => `solo snare roll build-up for ${g2(g)}, ${b} bpm — accelerating snare roll crescendo into the drop; snare only, one build, ${ISO}`,
  trap_hat_roll: (g, b) => `solo trap hi-hat rolls, ${b} bpm — stuttered 32nd-note hat ratchets with pitch drops; hats only, ${ISO}`,
  // --- modern Afro drum programming (owner's "missing drums and snares") ---
  military_snare: (g, b) => `solo military marching snare pattern for ${g2(g)}, ${b} bpm — tight parade-style snare with press rolls, flams and crisp accents, human timing; snare only, ${ISO}`,
  snare_rush: (g, b) => `solo snare rush build for ${g2(g)}, ${b} bpm — rapid programmed snare rush accelerating into the drop, rising velocity; snare only, one build, ${ISO}`,
  afro_tom_roll: (g, b) => `solo melodic tom roll pattern for ${g2(g)}, ${b} bpm — tuned toms playing the rolling syncopated melodic tom line that answers an implied vocal, warm and bouncy, human timing; toms only, ${ISO}`,
  triplet_hat_roll: (g, b) => `solo triplet hi-hat rolls for ${g2(g)}, ${b} bpm — swung triplet-feel hat rolls with accent bursts and velocity movement; hats only, ${ISO}`,
  '808_roll': (g, b) => `solo 808 kick roll for ${g2(g)}, ${b} bpm — rolled 16th and 32nd 808 kick bursts building into downbeats, saturated and punchy; 808 kick only, ${ISO}`,
  gqom_drums: (g, b) => `solo gqom broken-beat drum pattern, ${b} bpm — sparse heavy off-grid kick pattern with rolling dark toms, raw and hypnotic South African gqom drums; drums only, ${ISO}`,
  percussion_break: (g, b) => `solo full percussion break for ${g2(g)}, ${b} bpm — an all-drums breakdown groove of interlocking kit and hand percussion, high energy, no melodic instruments; drums and percussion only, ${ISO}`,
  // --- African percussion (the signature layer) ---
  talking_drum: (g, b) => `solo Nigerian talking drum (gángan/dùndún) groove for ${g2(g)}, ${b} bpm — expressive pitch-bending phrases, call-and-response, warm hand-played skin; talking drum only, ${ISO}`,
  dundun: (g, b) => `solo dùndún talking drum groove for ${g2(g)}, ${b} bpm — the large deep Yoruba dùndún, slow commanding pitch-bent phrases, warm skin tone; dundun only, ${ISO}`,
  gangan: (g, b) => `solo gángan talking drum groove for ${g2(g)}, ${b} bpm — small Yoruba squeeze drum, quick bright conversational pitch-bent phrases; gangan only, ${ISO}`,
  omele: (g, b) => `solo omele drum pattern for ${g2(g)}, ${b} bpm — small high-pitched Yoruba support drum playing a rapid steady interlocking timeline; omele only, ${ISO}`,
  gbedu: (g, b) => `solo gbedu drum groove for ${g2(g)}, ${b} bpm — deep majestic Yoruba gbedu drum, huge booming low hits in a sparse commanding pattern; gbedu only, ${ISO}`,
  sakara: (g, b) => `solo sakara drum groove for ${g2(g)}, ${b} bpm — Yoruba sakara frame drum, dry earthen tone with rolling stick-and-finger phrases; sakara only, ${ISO}`,
  ogene: (g, b) => `solo ogene twin-bell pattern for ${g2(g)}, ${b} bpm — Igbo ogene double bell, two-pitch interlocking timeline figure, bright forged-metal tone; ogene only, ${ISO}`,
  ekwe: (g, b) => `solo ekwe slit-drum pattern for ${g2(g)}, ${b} bpm — Igbo ekwe wooden slit drum, hollow woody two-tone timeline phrases; ekwe only, ${ISO}`,
  igba: (g, b) => `solo igba drum groove for ${g2(g)}, ${b} bpm — Igbo igba membrane drum, sharp hand-struck open tones and slaps in call-and-response phrasing; igba only, ${ISO}`,
  kpanlogo: (g, b) => `solo kpanlogo drum groove for ${g2(g)}, ${b} bpm — Ghanaian kpanlogo peg drum, warm open tones and muted slaps in an interlocking pattern; kpanlogo only, ${ISO}`,
  fontomfrom: (g, b) => `solo fontomfrom ensemble groove for ${g2(g)}, ${b} bpm — Akan fontomfrom royal drums, deep majestic talking phrases over a steady pulse; fontomfrom drums only, ${ISO}`,
  agidigbo: (g, b) => `solo agidigbo groove for ${g2(g)}, ${b} bpm — Yoruba agidigbo bass lamellophone (giant thumb piano), plucked buzzing bass-register ostinato; agidigbo only, ${ISO}`,
  shaker_offbeat: (g, b) => `solo offbeat shaker groove for ${g2(g)}, ${b} bpm — shaker accenting the offbeats with push-pull swing and space between hits, never a continuous 16th wash; shaker only, ${ISO}`,
  conga: (g, b) => `solo conga groove for ${g2(g)}, ${b} bpm — warm hand-played congas in an interlocking clave-feel pattern, open and slap tones, human timing; congas only, ${ISO}`,
  bongo: (g, b) => `solo bongo groove for ${g2(g)}, ${b} bpm — bright fast bongo fills and martillo-style pattern, hand-played; bongos only, ${ISO}`,
  shekere: (g, b) => `solo shekere groove for ${g2(g)}, ${b} bpm — beaded gourd shaker, crisp bright 16th pattern with accents and swing; shekere only, ${ISO}`,
  shaker: (g, b) => `solo shaker groove for ${g2(g)}, ${b} bpm — continuous swung 16th shaker with breathing accents, organic and human; shaker only, ${ISO}`,
  cowbell: (g, b) => `solo cowbell pattern for ${g2(g)}, ${b} bpm — dry metallic cowbell accents in a syncopated off-beat pattern; cowbell only, ${ISO}`,
  agogo: (g, b) => `solo agogo bell pattern for ${g2(g)}, ${b} bpm — two-pitch agogo bells in an interlocking clave-style figure; agogo only, ${ISO}`,
  djembe: (g, b) => `solo djembe groove for ${g2(g)}, ${b} bpm — West African djembe with deep bass strokes and sharp slaps, polyrhythmic; djembe only, ${ISO}`,
  udu: (g, b) => `solo udu clay-pot drum groove for ${g2(g)}, ${b} bpm — deep airy udu tones with finger taps, earthy and hypnotic; udu only, ${ISO}`,
  bata: (g, b) => `solo bata drum ensemble groove for ${g2(g)}, ${b} bpm — Yoruba bata conversation, layered tones; bata only, ${ISO}`,
  woodblock: (g, b) => `solo woodblock pattern for ${g2(g)}, ${b} bpm — dry clicky woodblock accents; woodblock only, ${ISO}`,
  claves: (g, b) => `solo claves pattern for ${g2(g)}, ${b} bpm — bright wooden claves playing a syncopated off-beat figure; claves only, ${ISO}`,
  cabasa: (g, b) => `solo cabasa groove for ${g2(g)}, ${b} bpm — textured cabasa scrapes in a steady 16th pattern; cabasa only, ${ISO}`,
  kalimba: (g, b, k) => `solo kalimba melody${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — plucked thumb-piano motif, bright and gentle; kalimba only, ${ISO}`,
  marimba: (g, b, k) => `solo marimba line${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — warm wooden marimba motif, rhythmic and melodic; marimba only, ${ISO}`,
  balafon: (g, b, k) => `solo balafon groove${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — West African balafon with buzzing resonators, cyclical pattern; balafon only, ${ISO}`,
  kora: (g, b, k) => `solo kora phrase${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — cascading West African harp arpeggios, warm and flowing; kora only, ${ISO}`,
  // --- bass ---
  log_drum: (g, b, k) => `solo amapiano log drum bassline${k ? ` in ${k}` : ''}, ${b} bpm — deep round woody log drum with punch, bounce and tuneful glides; log drum only, ${ISO}`,
  log_drum_lead: (g, b, k) => `solo lead log drum melody${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — higher-pitched melodic log drum line answering an implied bassline, tuneful glides and bounce; log drum only, ${ISO}`,
  bass_guitar: (g, b, k) => `solo ${g2(g)} bass guitar line${k ? ` in ${k}` : ''}, ${b} bpm — warm fingered electric bass with groove and movement, call-and-response with an implied kick; bass only, ${ISO}`,
  synth_bass: (g, b, k) => `solo ${g2(g)} synth bassline${k ? ` in ${k}` : ''}, ${b} bpm — round analog-style synth bass in the pocket; bass only, ${ISO}`,
  sub_bass: (g, b, k) => `solo sub-bass line${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — deep clean sine sub holding roots with occasional slides; sub only, ${ISO}`,
  bass_808: (g, b, k) => `solo 808 bassline${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — saturated gliding 808 sub pattern; 808 only, ${ISO}`,
  sliding_808: (g, b, k) => `solo sliding 808 bassline${k ? ` in ${k}` : ''}, ${b} bpm — long portamento 808 glides between roots, drill style; 808 only, ${ISO}`,
  upright_bass: (g, b, k) => `solo upright bass walking line${k ? ` in ${k}` : ''}, ${b} bpm — woody acoustic double bass, live feel; bass only, ${ISO}`,
  // --- harmony ---
  piano: (g, b, k) => `solo piano chords${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — warm grand piano comping with jazzy 7th/9th voicings, percussive stabs and space; piano only, ${ISO}`,
  rhodes: (g, b, k) => `solo Rhodes electric piano chords${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — soulful Rhodes comping, jazzy extensions, gentle tremolo; Rhodes only, ${ISO}`,
  organ: (g, b, k) => `solo organ chords${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — warm drawbar organ pads and stabs; organ only, ${ISO}`,
  gospel_organ: (g, b, k) => `solo gospel Hammond organ${k ? ` in ${k}` : ''}, ${b} bpm — rich gospel organ swells, runs and shout-chords with leslie; organ only, ${ISO}`,
  guitar_chords: (g, b, k) => `solo rhythm guitar chords${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — clean chopped guitar comping with muted strums; guitar only, ${ISO}`,
  highlife_guitar: (g, b, k) => `solo highlife guitar${k ? ` in ${k}` : ''}, ${b} bpm — bright clean interlocking West African highlife guitar picking, melodic cyclical riffs with light chorus; guitar only, ${ISO}`,
  palmwine_guitar: (g, b, k) => `solo palm-wine acoustic guitar${k ? ` in ${k}` : ''}, ${b} bpm — gentle fingerpicked West African acoustic guitar, warm and nostalgic; guitar only, ${ISO}`,
  reggae_skank: (g, b, k) => `solo reggae skank guitar${k ? ` in ${k}` : ''}, ${b} bpm — clean offbeat skank chops with short muted upstrokes; guitar only, ${ISO}`,
  house_piano_stab: (g, b, k) => `solo house piano stabs${k ? ` in ${k}` : ''}, ${b} bpm — classic bright piano stab chords on the offbeats; piano only, ${ISO}`,
  synth_pad: (g, b, k) => `solo warm synth pad${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — airy sustained analog pad, slow attack, wide and soft; pad only, ${ISO}`,
  warm_pad: (g, b, k) => `solo warm ambient pad${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — lush enveloping pad bed, gentle movement; pad only, ${ISO}`,
  choir_pad: (g, b, k) => `solo choir pad${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — soft vocal "aah" choir sustains, wide and warm; choir pad only, no lead vocals, no lyrics, seamless loop`,
  string_pad: (g, b, k) => `solo string ensemble pad${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — warm legato strings sustaining chords; strings only, ${ISO}`,
  // --- melody / color ---
  flute: (g, b, k) => `solo flute melody${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — light airy flute hook with grace notes, catchy and rhythmic; flute only, ${ISO}`,
  sax: (g, b, k) => `solo saxophone riff${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — smooth expressive sax phrase with soul; sax only, ${ISO}`,
  trumpet: (g, b, k) => `solo trumpet line${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — bright punchy trumpet phrase; trumpet only, ${ISO}`,
  brass_section: (g, b, k) => `solo brass section stabs${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — tight punchy horn-section hits and short riffs, afrobeat lineage; brass only, ${ISO}`,
  lead_guitar: (g, b, k) => `solo lead guitar licks${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — melodic clean electric guitar licks answering an implied vocal; guitar only, ${ISO}`,
  clean_guitar_riff: (g, b, k) => `solo clean guitar riff${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — bright single-note guitar riff with light chorus; guitar only, ${ISO}`,
  synth_lead: (g, b, k) => `solo synth lead hook${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — catchy analog synth lead motif; lead only, ${ISO}`,
  synth_pluck: (g, b, k) => `solo synth pluck pattern${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — short bouncy plucks in a syncopated melodic figure; plucks only, ${ISO}`,
  bell_lead: (g, b, k) => `solo bell melody${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — dark bell/music-box motif, minor and moody; bells only, ${ISO}`,
  vocal_chop: (g, b, k) => `solo vocal chop hook${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — pitched chopped vocal syllables as a melodic hook, no words, no lyrics; vocal chops only, seamless loop`,
  // --- vocals (non-lyrical textures) ---
  chant: (g, b) => `solo group chant for ${g2(g)}, ${b} bpm — energetic rhythmic gang chants and "eh eh / oh oh" call-outs, no lyrics, no lead vocal; chants only, seamless loop`,
  crowd_chant: (g, b) => `solo crowd chant for ${g2(g)}, ${b} bpm — stadium-style crowd "ohhh" chants in rhythm, no lyrics; crowd only, seamless loop`,
  humming: (g, b, k) => `solo warm humming melody${k ? ` in ${k}` : ''}, ${b} bpm — soulful wordless hums, intimate; humming only, no lyrics, seamless loop`,
  // --- fx / transitions ---
  riser: (g, b) => `solo riser FX, ${b} bpm — tension-building white-noise and pitch riser sweeping up into a drop; FX only, one riser, ${ISO}`,
  downlifter: (g, b) => `solo downlifter FX, ${b} bpm — falling sweep releasing tension after a drop; FX only, ${ISO}`,
  impact: () => `solo impact hit FX — deep cinematic boom impact with short tail; one hit, ${ISO}`,
  reverse_cymbal: (g, b) => `solo reverse cymbal swell, ${b} bpm — rising reversed crash into a downbeat; one swell, ${ISO}`,
  sweep: (g, b) => `solo noise sweep FX, ${b} bpm — smooth filtered noise sweep; FX only, ${ISO}`,
};

/** Family fallback templates so EVERY taxonomy role is forgeable. */
const FAMILY_FALLBACK: Record<string, (role: string, g: string, b: number, k?: string) => string> = {
  drumkit: (r, g, b) => `solo ${r.replace(/_/g, ' ')} pattern for ${g2(g)}, ${b} bpm — characterful, human timing; ${r.replace(/_/g, ' ')} only, ${ISO}`,
  african_perc: (r, g, b) => `solo ${r.replace(/_/g, ' ')} groove for ${g2(g)}, ${b} bpm — hand-played African percussion with swing and human timing; ${r.replace(/_/g, ' ')} only, ${ISO}`,
  global_perc: (r, g, b) => `solo ${r.replace(/_/g, ' ')} groove for ${g2(g)}, ${b} bpm — world percussion, organic; ${r.replace(/_/g, ' ')} only, ${ISO}`,
  mallets: (r, g, b, k) => `solo ${r.replace(/_/g, ' ')} melody${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm; ${r.replace(/_/g, ' ')} only, ${ISO}`,
  bass: (r, g, b, k) => `solo ${r.replace(/_/g, ' ')} bassline${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — in the pocket; bass only, ${ISO}`,
  harmony: (r, g, b, k) => `solo ${r.replace(/_/g, ' ')} chords${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — warm musical comping; ${r.replace(/_/g, ' ')} only, ${ISO}`,
  melody: (r, g, b, k) => `solo ${r.replace(/_/g, ' ')} melody${k ? ` in ${k}` : ''} for ${g2(g)}, ${b} bpm — catchy motif; ${r.replace(/_/g, ' ')} only, ${ISO}`,
  vocals: (r, g, b) => `solo ${r.replace(/_/g, ' ')} vocal texture for ${g2(g)}, ${b} bpm — wordless, rhythmic, no lyrics; vocals only, seamless loop`,
  fx: (r, g, b) => `solo ${r.replace(/_/g, ' ')} FX for ${g2(g)}, ${b} bpm; FX only, ${ISO}`,
};

/** Families whose roles are pitched — forged IN KEY so loops fit together. */
/**
 * The prompt for forging one isolated loop of `role`. Covers the ENTIRE
 * taxonomy: curated descriptor first, family template as fallback. Legacy
 * coarse roles (drums/percussion/chords/bass/fill) keep working.
 *
 * `variant` (VARIANT DEPTH — the "one loop per role forever" fix): variant ≥ 2
 * appends a variation direction HERE — one call site instead of 60 descriptors —
 * so the engine renders a genuinely different phrase in the same lane and
 * character, never a re-render of the same idea. variant 2 = B, 3 = C, …
 */
export function forgePromptFor(role: string, genre: string, bpm: number, key?: string, variant?: number): string | null {
  const k = isKeyedRole(role) ? key : undefined;
  const withVariant = (base: string) =>
    variant && variant >= 2
      ? `${base} — variation ${String.fromCharCode(64 + Math.min(variant, 26))}: a DIFFERENT pattern/phrase in the same lane and character (new rhythm placement or melodic contour), never a re-render of the same idea`
      : base;
  const curated = DESCRIPTORS[role as MaterialRole];
  if (curated) return withVariant(curated(genre, bpm, k));
  // Legacy coarse roles used by the synth bridge + old shelf entries.
  const LEGACY: Record<string, (g: string, b: number, k?: string) => string> = {
    drums: (g, b) => `solo ${g2(g)} drum groove, ${b} bpm — punchy tuned kick, crisp snare and rimshots, lively swung hi-hats with ghost notes, human pocket; drums only, ${ISO}`,
    percussion: (g, b) => `solo African percussion bed for ${g2(g)}, ${b} bpm — interlocking shekere, agogo, congas and shaker with organic groove; percussion only, no kick, no snare, ${ISO}`,
    chords: (g, b, kk) => `solo ${g2(g)} chord bed${kk ? ` in ${kk}` : ''}, ${b} bpm — warm rich keys or clean guitar chords with movement; chords only, ${ISO}`,
    bass: (g, b, kk) => `solo ${g2(g)} bassline${kk ? ` in ${kk}` : ''}, ${b} bpm — warm round bass with groove; bass only, ${ISO}`,
    fill: (g, b) => `solo ${g2(g)} DRUM FILL, ${b} bpm — a short 1-2 bar rising tom/snare fill landing on the downbeat; drums only, one fill, not a loop, ${ISO}`,
  };
  if (LEGACY[role]) return withVariant(LEGACY[role](genre, bpm, k));
  if (isMaterialRole(role)) {
    const fam = familyOf(role);
    const fb = FAMILY_FALLBACK[fam];
    if (fb) return withVariant(fb(role, genre, bpm, k));
  }
  return null;
}
