/**
 * GENRE PALETTES — the FULL shelf inventory per lane, beyond the kit's
 * required/signature core. The owner's law: "you need to have everything" —
 * a commercial Afrobeats session carries congas, bongos, cowbell, agogo, udu,
 * open hats, an 808 under the bass guitar, Rhodes and pads behind the piano,
 * flute/sax/brass hooks, chants and vocal chops, risers into every drop.
 * forgeKitFor() unions these with the kit (signature + required first), then
 * fills remaining slots BREADTH-FIRST across families so no palette ever ships
 * rhythm-only. Roles must exist in material-roles.ts; unforgeable lead
 * performances are filtered by forgeKitFor, never listed here.
 *
 * Order matters: within each family, the first-listed role is forged first.
 *
 * -----------------------------------------------------------------------------
 * AFRO PERCUSSION GAP ANALYSIS (owner's report, 2026-07: "there are drums and
 * snares still missing… a lot of drums in Afro music that we don't have").
 * Authored from organology/music-theory FACTS (instrument names, roles,
 * characteristic playing styles — uncopyrightable facts); no artist recording
 * is ever a material source.
 *
 * ALREADY COVERED before this pass (verified against material-roles.ts + these
 * palettes + the 45 genre kits):
 *  - Kit backbone: kick(×5 variants), snare, rimshot, clap, snap, hats(closed/
 *    open/ride/crash), tom, tom_fill, snare_roll, drum_roll, brushes,
 *    trap_hat_roll, drill_hat_slide — snare/clap/rimshot are REQUIRED kit roles
 *    in nearly every Afro-core genre.
 *  - African perc: talking_drum, dundun, sakara, bata, djembe, ashiko, udu,
 *    shekere, agogo, cowbell, conga, bongo, cabasa, shaker, maraca, woodblock,
 *    claves, kalimba, mbira, balafon, kora, ngoni.
 *  - Amapiano low end: log_drum (bass workhorse).
 *  - 'snare_roll_build' and 'drum_roll_fill' candidates were judged ALREADY
 *    covered: snare_roll + drum_roll exist and drum_roll's forge prompt is
 *    explicitly the rising build into a drop; 'rimshot_pattern' is covered by
 *    rimshot.
 *
 * WAS MISSING → ADDED in this pass (17 new roles):
 *  - West African/Nigerian instruments (african_perc): gbedu (deep Yoruba royal
 *    drum — afrobeats/street_pop/fuji), gangan (small squeeze talking drum) +
 *    omele (small high support drum) completing the dundun/talking-drum family
 *    (fuji/juju/apala/afrobeats), ogene (Igbo twin bell), ekwe (Igbo slit
 *    drum), igba (Igbo membrane drum) — Igbo highlife/afrobeats; kpanlogo
 *    (Ghanaian peg drum — highlife/azonto), fontomfrom (Akan royal drum
 *    ensemble — highlife), agidigbo (Yoruba bass lamellophone — apala/juju),
 *    shaker_offbeat (the offbeat shaker FEEL as its own role vs the continuous
 *    16ths 'shaker' — amapiano/afro_house/afrobeats).
 *  - Modern Afrobeats drum PROGRAMMING roles (drumkit): afro_tom_roll (the
 *    signature melodic tom pattern — afrobeats/afro_pop/afro_fusion/azonto),
 *    military_snare (marching/parade snare — afrobeats/afro_gospel/praise/
 *    afro_dancehall), snare_rush (programmed rapid rush into drops — street_pop/
 *    amapiano/afrobeats), triplet_hat_roll (triplet-feel hat rolls vs the 32nd
 *    trap_hat_roll — afrobeats/afro_fusion/street_pop), 808_roll (rolled 808
 *    kick bursts — street_pop/gqom), percussion_break (all-drums breakdown —
 *    afrobeats/amapiano/street_pop).
 *  - Amapiano/SA: log_drum_lead (bass family, keyed — the melodic lead log-drum
 *    line vs the log_drum bassline), gqom_drums (gqom's broken off-grid kick
 *    pattern — gqom).
 *  - Snare-backbone presence (owner: "snares are missing"): every Afro-core
 *    palette/kit now carries >=2 distinct snare-class roles (snare/clap/rimshot/
 *    snap/military_snare/snare_rush) and >=1 tom/roll-class role — enforced by
 *    test-material-system's SNARE & TOM LAW. Genres whose kits only required
 *    ONE snare-class role gained palette entries: highlife (+rimshot),
 *    afro_dancehall (+snare/clap), afro_house (+rimshot/snap).
 * -----------------------------------------------------------------------------
 */
import { genreLookupKey } from './genre-canon';

export const GENRE_PALETTES: Record<string, readonly string[]> = {
  // ---- Afro / diaspora core -------------------------------------------------
  afrobeats: [
    'conga', 'bongo', 'gbedu', 'cowbell', 'agogo', 'gangan', 'woodblock', 'udu', 'djembe', 'shaker_offbeat', 'ogene', 'ekwe',
    'open_hat', 'tom_fill', 'afro_tom_roll', 'kick_808', 'military_snare', 'snare_rush', 'triplet_hat_roll', 'percussion_break',
    'sub_bass', 'synth_bass',
    'piano', 'rhodes', 'guitar_chords', 'synth_pad', 'warm_pad',
    'flute', 'sax', 'brass_section', 'clean_guitar_riff', 'synth_lead', 'vocal_chop',
    'chant', 'crowd_chant',
    'riser', 'reverse_cymbal', 'transition_fx',
  ],
  afro_fusion: [
    'conga', 'bongo', 'cowbell', 'agogo', 'udu', 'kalimba', 'djembe', 'gbedu', 'gangan', 'ogene',
    'open_hat', 'afro_tom_roll', 'kick_808', 'triplet_hat_roll', 'snare_rush',
    'sub_bass', 'synth_bass',
    'piano', 'rhodes', 'warm_pad', 'string_pad', 'highlife_guitar', 'guitar_chords',
    'flute', 'sax', 'strings_line', 'synth_lead', 'vocal_chop',
    'humming', 'chant',
    'riser', 'transition_fx',
  ],
  amapiano: [
    'conga', 'bongo', 'shaker_offbeat', 'cowbell', 'woodblock', 'cabasa',
    'open_hat', 'tom', 'percussion_break', 'snare_rush',
    'sub_bass', 'synth_bass', 'log_drum_lead',
    'warm_pad', 'string_pad', 'synth_pad', 'guitar_chords',
    'sax', 'flute', 'synth_lead', 'bell_lead', 'vocal_chop',
    'chant', 'humming',
    'riser', 'sweep', 'transition_fx', 'club_ambience',
  ],
  afro_dancehall: [
    'conga', 'bongo', 'cowbell', 'agogo', 'woodblock', 'gangan',
    'open_hat', 'snare', 'tom', 'clap', 'kick_808', 'military_snare',
    'sub_bass', 'bass_808',
    'piano', 'rhodes', 'guitar_chords', 'synth_pad',
    'brass_section', 'sax', 'synth_lead', 'vocal_chop',
    'chant', 'crowd_chant',
    'siren', 'riser', 'transition_fx',
  ],
  street_pop: [
    'conga', 'gbedu', 'cowbell', 'agogo', 'woodblock', 'shekere', 'gangan',
    'open_hat', 'tom_fill', 'snare_rush', 'kick_808', '808_roll', 'military_snare', 'percussion_break', 'triplet_hat_roll',
    'sub_bass', 'bass_808', 'log_drum',
    'piano', 'guitar_chords', 'synth_pad',
    'flute', 'synth_lead', 'bell_lead', 'vocal_chop',
    'chant', 'crowd_chant',
    'riser', 'drop_fx', 'transition_fx',
  ],
  afro_rnb: [
    'conga', 'bongo', 'shaker', 'udu',
    'soft_kick', 'open_hat', 'snap', 'kick_808',
    'sub_bass', 'synth_bass', 'fretless_bass',
    'rhodes', 'piano', 'wurlitzer', 'warm_pad', 'string_pad', 'guitar_chords',
    'clean_guitar_riff', 'flute', 'sax', 'strings_line', 'synth_lead', 'vocal_chop',
    'humming',
    'vinyl_noise', 'riser', 'transition_fx',
  ],
  gospel: [
    'conga', 'shaker', 'cowbell',
    'live_kick', 'tom_fill', 'ride', 'crash', 'open_hat',
    'organ_bass', 'upright_bass', 'sub_bass',
    'piano', 'upright_piano', 'hammond', 'rhodes', 'choir_pad', 'string_pad',
    'brass_section', 'trumpet', 'sax', 'strings_line',
    'gospel_choir', 'choir', 'humming',
    'riser', 'sweep',
  ],
  afro_gospel: [
    'conga', 'shekere', 'cowbell', 'agogo', 'talking_drum', 'djembe', 'gangan',
    'live_kick', 'tom_fill', 'open_hat', 'military_snare', 'drum_roll',
    'sub_bass', 'organ_bass',
    'piano', 'gospel_organ', 'hammond', 'rhodes', 'choir_pad', 'guitar_chords', 'highlife_guitar',
    'brass_section', 'trumpet', 'sax', 'flute',
    'gospel_choir', 'choir', 'chant', 'crowd_chant',
    'riser', 'transition_fx',
  ],
  worship: [
    'shaker', 'cabasa',
    'soft_kick', 'brushes', 'ride',
    'upright_bass', 'sub_bass',
    'upright_piano', 'piano', 'rhodes', 'gospel_organ', 'warm_pad', 'string_pad', 'choir_pad', 'guitar_chords',
    'clean_guitar_riff', 'strings_line', 'violin_line', 'flute',
    'choir', 'gospel_choir', 'humming',
    'sweep', 'riser',
  ],
  praise: [
    'conga', 'shekere', 'cowbell', 'agogo', 'talking_drum', 'gangan',
    'live_kick', 'tom_fill', 'open_hat', 'military_snare', 'drum_roll', 'crash',
    'organ_bass', 'sub_bass',
    'piano', 'gospel_organ', 'hammond', 'choir_pad', 'guitar_chords', 'highlife_guitar',
    'brass_section', 'trumpet', 'sax',
    'gospel_choir', 'choir', 'crowd_chant', 'chant',
    'riser', 'transition_fx',
  ],
  spiritual: [
    'udu', 'kalimba', 'mbira', 'djembe', 'shaker', 'woodblock', 'balafon', 'kora',
    'soft_kick',
    'sub_bass', 'upright_bass',
    'warm_pad', 'string_pad', 'choir_pad', 'piano',
    'flute', 'pan_flute', 'strings_line',
    'humming', 'chant', 'choir',
    'nature_ambience', 'sweep',
  ],
  afro_pop: [
    'conga', 'bongo', 'cowbell', 'agogo', 'udu', 'gbedu', 'gangan',
    'open_hat', 'tom_fill', 'afro_tom_roll', 'kick_808', 'snare_rush', 'triplet_hat_roll',
    'sub_bass', 'synth_bass',
    'piano', 'rhodes', 'guitar_chords', 'highlife_guitar', 'warm_pad', 'synth_pad',
    'flute', 'sax', 'brass_section', 'synth_lead', 'bell_lead', 'vocal_chop',
    'chant', 'humming',
    'riser', 'transition_fx',
  ],
  afro_soul: [
    'conga', 'bongo', 'shaker', 'udu',
    'soft_kick', 'brushes', 'open_hat',
    'upright_bass', 'sub_bass', 'fretless_bass',
    'piano', 'rhodes', 'wurlitzer', 'warm_pad', 'string_pad', 'guitar_chords',
    'clean_guitar_riff', 'sax', 'trumpet', 'flute', 'strings_line',
    'humming', 'choir',
    'vinyl_noise', 'sweep',
  ],
  hip_hop: [
    'conga', 'shaker', 'cowbell',
    'kick_808', 'open_hat', 'snap', 'tom_fill',
    'sub_bass', 'bass_808', 'synth_bass',
    'piano', 'rhodes', 'organ', 'synth_pad', 'string_pad', 'guitar_chords',
    'strings_line', 'synth_lead', 'bell_lead', 'flute', 'sax', 'vocal_chop',
    'chant',
    'vinyl_noise', 'riser', 'reverse_cymbal', 'beat_stop',
  ],
  highlife: [
    'conga', 'bongo', 'claves', 'agogo', 'ogene', 'woodblock', 'cowbell', 'maraca', 'ekwe', 'igba', 'kpanlogo', 'fontomfrom',
    'live_kick', 'rimshot', 'open_hat', 'tom_fill', 'ride',
    'upright_bass', 'sub_bass',
    'palmwine_guitar', 'guitar_chords', 'piano', 'organ',
    'trumpet', 'sax', 'trombone', 'flute', 'clean_guitar_riff',
    'chant', 'crowd_chant', 'humming',
    'transition_fx',
  ],
  reggae: [
    'conga', 'bongo', 'cabasa', 'guiro', 'triangle',
    'rimshot', 'tom', 'open_hat',
    'organ_bass', 'sub_bass',
    'organ', 'hammond', 'piano', 'clavinet', 'guitar_chords',
    'brass_section', 'trumpet', 'sax', 'trombone', 'harmonica',
    'chant', 'humming',
    'siren', 'sweep', 'tape_hiss',
  ],
  alte: [
    'conga', 'shaker', 'kalimba', 'udu',
    'soft_kick', 'open_hat', 'snap',
    'sub_bass', 'synth_bass', 'fretless_bass',
    'rhodes', 'wurlitzer', 'warm_pad', 'synth_pad', 'guitar_chords', 'palmwine_guitar',
    'clean_guitar_riff', 'flute', 'sax', 'synth_lead', 'vocal_chop',
    'humming', 'chant',
    'vinyl_noise', 'tape_hiss', 'sweep', 'nature_ambience',
  ],
  // ---- African continental ---------------------------------------------------
  gqom: [
    'conga', 'woodblock', 'cowbell', 'shaker', 'taiko',
    'club_kick', 'gqom_drums', 'tom', 'open_hat', '808_roll', 'percussion_break',
    'sub_bass', 'reese_bass', 'synth_bass',
    'synth_pad', 'string_pad',
    'synth_lead', 'bell_lead', 'vocal_chop',
    'chant', 'crowd_chant',
    'riser', 'impact', 'drop_fx', 'siren', 'club_ambience', 'downlifter',
  ],
  kwaito: [
    'conga', 'cowbell', 'woodblock', 'shaker', 'cabasa',
    'club_kick', 'open_hat', 'snap',
    'sub_bass', 'synth_bass', 'organ_bass',
    'piano', 'organ', 'synth_pad', 'guitar_chords', 'warm_pad',
    'synth_lead', 'bell_lead', 'vocal_chop',
    'chant', 'crowd_chant',
    'riser', 'transition_fx',
  ],
  afro_house: [
    'conga', 'bongo', 'djembe', 'shekere', 'cowbell', 'cabasa', 'shaker_offbeat',
    'club_kick', 'open_hat', 'rimshot', 'drum_roll', 'ride', 'snap',
    'sub_bass', 'synth_bass',
    'warm_pad', 'synth_pad', 'string_pad', 'house_piano_stab', 'piano',
    'kalimba', 'marimba', 'flute', 'synth_lead', 'vocal_chop',
    'chant', 'humming',
    'riser', 'sweep', 'downlifter', 'club_ambience',
  ],
  bongo_flava: [
    'bongo', 'conga', 'shaker', 'cowbell', 'cabasa',
    'open_hat', 'kick_808', 'snap',
    'sub_bass', 'synth_bass',
    'piano', 'guitar_chords', 'synth_pad', 'warm_pad',
    'strings_line', 'violin_line', 'oud', 'flute', 'sax', 'synth_lead', 'vocal_chop',
    'chant', 'humming',
    'riser', 'transition_fx',
  ],
  azonto: [
    'conga', 'kpanlogo', 'cowbell', 'agogo', 'woodblock', 'claves', 'shaker',
    'open_hat', 'kick_808', 'tom_fill', 'afro_tom_roll',
    'sub_bass', 'synth_bass',
    'piano', 'guitar_chords', 'highlife_guitar', 'synth_pad',
    'brass_section', 'synth_lead', 'bell_lead', 'vocal_chop',
    'chant', 'crowd_chant',
    'riser', 'transition_fx',
  ],
  coupe_decale: [
    'conga', 'bongo', 'cowbell', 'woodblock', 'shaker', 'maraca',
    'club_kick', 'open_hat', 'tom_fill',
    'sub_bass', 'synth_bass',
    'guitar_chords', 'clean_guitar_riff', 'piano', 'synth_pad',
    'lead_guitar', 'brass_section', 'synth_lead', 'vocal_chop',
    'chant', 'crowd_chant',
    'siren', 'riser', 'transition_fx',
  ],
  ndombolo: [
    'conga', 'bongo', 'cowbell', 'claves', 'shaker', 'maraca',
    'live_kick', 'open_hat', 'tom_fill',
    'sub_bass', 'upright_bass',
    'guitar_chords', 'clean_guitar_riff', 'piano', 'synth_pad',
    'lead_guitar', 'trumpet', 'sax', 'brass_section',
    'chant', 'crowd_chant',
    'transition_fx',
  ],
  soukous: [
    'conga', 'bongo', 'claves', 'cowbell', 'maraca', 'shaker', 'woodblock',
    'live_kick', 'open_hat', 'ride',
    'upright_bass', 'sub_bass',
    'guitar_chords', 'palmwine_guitar', 'piano',
    'lead_guitar', 'clean_guitar_riff', 'trumpet', 'sax', 'brass_section',
    'chant', 'crowd_chant', 'humming',
    'transition_fx',
  ],
  fuji: [
    'sakara', 'dundun', 'gangan', 'omele', 'gbedu', 'bata', 'agogo', 'shekere', 'cowbell', 'woodblock',
    'djembe', 'conga', 'claves', 'maraca', 'cabasa',
    'tom', 'tom_fill',
    'sub_bass',
    'organ', 'guitar_chords', 'synth_pad',
    'flute', 'sax',
    'chant', 'crowd_chant', 'humming',
    'transition_fx',
  ],
  juju: [
    'dundun', 'gangan', 'omele', 'agogo', 'shekere', 'agidigbo', 'claves', 'maraca', 'conga', 'woodblock', 'bata',
    'open_hat', 'tom',
    'upright_bass', 'sub_bass',
    'guitar_chords', 'palmwine_guitar', 'organ', 'piano',
    'clean_guitar_riff', 'lead_guitar', 'pedal_steel',
    'chant', 'crowd_chant', 'humming',
    'transition_fx',
  ],
  apala: [
    'sakara', 'dundun', 'agidigbo', 'gangan', 'omele', 'bata', 'agogo', 'shekere', 'claves', 'woodblock', 'cabasa', 'maraca', 'udu',
    'kalimba', 'kora',
    'sub_bass',
    'organ',
    'flute',
    'chant', 'crowd_chant', 'humming',
    'nature_ambience',
  ],
  // ---- Global lanes ------------------------------------------------------------
  pop: [
    'shaker', 'conga',
    'snap', 'clap', 'open_hat', 'tom_fill', 'kick',
    'sub_bass', 'synth_bass', 'bass_guitar',
    'piano', 'guitar_chords', 'warm_pad', 'synth_pad', 'string_pad',
    'clean_guitar_riff', 'strings_line', 'synth_lead', 'synth_pluck', 'bell_lead', 'vocal_chop',
    'humming',
    'riser', 'downlifter', 'impact', 'sweep', 'transition_fx',
  ],
  rnb: [
    'shaker', 'conga',
    'snap', 'soft_kick', 'open_hat',
    'sub_bass', 'bass_808', 'synth_bass', 'fretless_bass',
    'rhodes', 'piano', 'wurlitzer', 'warm_pad', 'string_pad', 'guitar_chords',
    'clean_guitar_riff', 'strings_line', 'flute', 'sax', 'synth_lead', 'bell_lead', 'vocal_chop',
    'humming',
    'vinyl_noise', 'sweep', 'riser',
  ],
  dancehall: [
    'conga', 'bongo', 'cowbell', 'woodblock', 'triangle',
    'rimshot', 'snap', 'tom', 'open_hat', 'kick_808',
    'sub_bass', 'bass_808', 'synth_bass',
    'piano', 'organ', 'reggae_skank', 'guitar_chords', 'synth_pad',
    'brass_section', 'synth_lead', 'bell_lead', 'vocal_chop',
    'chant', 'crowd_chant',
    'siren', 'riser', 'drop_fx',
  ],
  drill: [
    'shaker',
    'kick_808', 'open_hat', 'snap', 'tom',
    'sub_bass', 'reese_bass',
    'piano', 'string_pad', 'synth_pad', 'choir_pad',
    'strings_line', 'violin_line', 'bell_lead', 'synth_lead', 'vocal_chop',
    'chant',
    'riser', 'reverse_cymbal', 'beat_stop', 'impact',
  ],
  trap: [
    'shaker', 'conga',
    'kick_808', 'snap', 'open_hat', 'tom',
    'sub_bass', 'reese_bass', 'synth_bass',
    'piano', 'synth_pad', 'string_pad', 'choir_pad',
    'bell_lead', 'synth_pluck', 'synth_lead', 'flute', 'strings_line', 'vocal_chop',
    'chant',
    'riser', 'reverse_cymbal', 'impact', 'beat_stop', 'drop_fx',
  ],
  house: [
    'conga', 'bongo', 'cabasa', 'shaker',
    'clap', 'open_hat', 'ride', 'snap',
    'sub_bass', 'synth_bass', 'organ_bass',
    'piano', 'organ', 'synth_pad', 'warm_pad', 'string_pad',
    'synth_lead', 'synth_pluck', 'sax', 'vocal_chop',
    'chant', 'humming',
    'riser', 'sweep', 'downlifter', 'club_ambience',
  ],
  edm: [
    'shaker',
    'clap', 'snap', 'open_hat', 'tom', 'club_kick',
    'sub_bass', 'synth_bass', 'reese_bass', 'moog_bass',
    'synth_pad', 'warm_pad', 'string_pad', 'piano',
    'synth_lead', 'synth_pluck', 'bell_lead', 'vocal_chop',
    'crowd_chant',
    'riser', 'downlifter', 'impact', 'sweep', 'drop_fx', 'transition_fx', 'club_ambience',
  ],
  reggaeton: [
    'timbales', 'conga', 'bongo', 'claves', 'guiro', 'cowbell',
    'open_hat', 'kick_808', 'snap',
    'sub_bass', 'synth_bass', 'bass_808',
    'piano', 'guitar_chords', 'synth_pad',
    'brass_section', 'trumpet', 'synth_lead', 'synth_pluck', 'bell_lead', 'vocal_chop',
    'chant',
    'siren', 'riser', 'drop_fx',
  ],
  latin_pop: [
    'conga', 'bongo', 'timbales', 'claves', 'guiro', 'cajon', 'maraca',
    'open_hat', 'tom_fill',
    'bass_guitar', 'sub_bass', 'upright_bass',
    'piano', 'guitar_chords', 'warm_pad', 'string_pad', 'accordion',
    'clean_guitar_riff', 'brass_section', 'trumpet', 'sax', 'strings_line', 'violin_line', 'synth_lead', 'vocal_chop',
    'chant',
    'riser', 'transition_fx',
  ],
  country: [
    'cajon', 'triangle', 'shaker',
    'brushes', 'live_kick', 'tom', 'ride', 'snap',
    'upright_bass', 'bass_guitar',
    'piano', 'organ', 'guitar_chords', 'accordion',
    'banjo', 'mandolin', 'fiddle', 'pedal_steel', 'harmonica', 'lead_guitar', 'clean_guitar_riff', 'strings_line',
    'humming', 'choir',
    'crowd_noise',
  ],
  rock: [
    'cowbell',
    'live_kick', 'tom', 'tom_fill', 'ride', 'crash', 'open_hat',
    'bass_guitar', 'sub_bass',
    'organ', 'hammond', 'piano', 'guitar_chords', 'string_pad',
    'lead_guitar', 'clean_guitar_riff', 'strings_line',
    'crowd_chant', 'choir',
    'crowd_noise', 'riser', 'impact',
  ],
  soul: [
    'conga', 'bongo', 'triangle', 'shaker',
    'brushes', 'live_kick', 'open_hat', 'ride',
    'upright_bass', 'bass_guitar',
    'piano', 'upright_piano', 'rhodes', 'wurlitzer', 'hammond', 'clavinet', 'string_pad', 'guitar_chords',
    'clean_guitar_riff', 'brass_section', 'trumpet', 'sax', 'trombone', 'strings_line', 'violin_line',
    'choir', 'humming',
    'vinyl_noise',
  ],
  jazz: [
    'conga', 'triangle',
    'brushes', 'ride', 'tom', 'snare_roll',
    'upright_bass', 'fretless_bass',
    'piano', 'rhodes', 'organ', 'guitar_chords',
    'vibraphone',
    'sax', 'trumpet', 'trombone', 'flute', 'clean_guitar_riff', 'strings_line',
    'humming',
    'vinyl_noise', 'tape_hiss',
  ],
  funk: [
    'conga', 'bongo', 'cowbell', 'cabasa', 'shaker',
    'clap', 'open_hat', 'tom_fill',
    'slap_bass', 'bass_guitar', 'moog_bass',
    'clavinet', 'rhodes', 'organ', 'hammond', 'piano', 'guitar_chords',
    'brass_section', 'trumpet', 'sax', 'trombone', 'synth_lead', 'vocal_chop',
    'chant', 'crowd_chant',
    'transition_fx',
  ],
  blues: [
    'triangle', 'shaker',
    'brushes', 'live_kick', 'ride', 'tom',
    'upright_bass', 'bass_guitar',
    'piano', 'upright_piano', 'organ', 'hammond', 'guitar_chords',
    'lead_guitar', 'clean_guitar_riff', 'harmonica', 'sax', 'trumpet',
    'humming',
    'vinyl_noise', 'tape_hiss',
  ],
  lofi: [
    'shaker', 'conga', 'kalimba',
    'brushes', 'soft_kick', 'snap',
    'sub_bass', 'upright_bass', 'fretless_bass',
    'rhodes', 'piano', 'upright_piano', 'warm_pad', 'guitar_chords',
    'vibraphone',
    'clean_guitar_riff', 'flute', 'sax', 'bell_lead', 'vocal_chop',
    'humming',
    'vinyl_noise', 'tape_hiss', 'nature_ambience', 'sweep',
  ],
  classical: [
    'timpani', 'triangle',
    'snare_roll', 'drum_roll',
    'upright_bass',
    'piano', 'upright_piano', 'harpsichord', 'string_pad', 'choir_pad',
    'glockenspiel', 'xylophone', 'marimba', 'vibraphone', 'tubular_bells', 'chimes', 'gong',
    'strings_line', 'violin_line', 'flute', 'piccolo', 'trumpet', 'trombone', 'brass_section',
    'choir', 'humming',
  ],
};

/** The lane's full palette (empty for unknown lanes — the kit core still forges). */
export function paletteFor(genre?: string | null): readonly string[] {
  if (!genre) return [];
  // CANONICALIZE FIRST (audit quick-win 2026-07-19) — raw exact tag still wins.
  return GENRE_PALETTES[genre] ?? GENRE_PALETTES[genreLookupKey(genre)] ?? [];
}
