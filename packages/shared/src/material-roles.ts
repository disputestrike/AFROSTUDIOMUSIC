/**
 * MATERIAL ROLE TAXONOMY — the producer-grade sound vocabulary.
 *
 * The old material system had FIVE roles (log_drum, percussion, bass, chords,
 * fill) and the synth rendered every genre with an amapiano-leaning pattern —
 * so Afrobeats, Highlife and Gospel all came out sounding like amapiano mush.
 * This is the single source of truth for the full instrument/sound palette,
 * organised by family. Genre kits (genre-signatures.ts) pick their required /
 * optional / signature / forbidden roles from THIS list, so every lane gets its
 * own palette and nothing is a loose, unchecked string.
 *
 * Not every role is locally synthesizable (yet) — most are steer/verify tokens:
 * they front-load the render engine's brief with the CORRECT per-genre
 * instruments and give the ear a checklist ("amapiano must have log_drum +
 * piano"). SYNTHESIZABLE marks the subset the owned Python synth can render now.
 */

export const MATERIAL_FAMILIES = {
  // Kit drums — the backbone of the groove. Includes the modern Afrobeats drum
  // PROGRAMMING roles (owner's law, 2026-07 "drums and snares still missing"):
  // the melodic afro tom roll, military/marching snare, snare rush, triplet hat
  // rolls, rolled 808 kicks, gqom's broken kick pattern and the all-drums
  // percussion break — these are as much the genre's identity as the instruments.
  drumkit: [
    'kick', 'kick_808', 'soft_kick', 'club_kick', 'live_kick',
    'snare', 'rimshot', 'clap', 'snap', 'military_snare',
    'closed_hat', 'open_hat', 'ride', 'crash',
    'tom', 'tom_fill', 'snare_roll', 'drum_roll', 'brushes',
    'trap_hat_roll', 'drill_hat_slide',
    'afro_tom_roll', 'snare_rush', 'triplet_hat_roll', '808_roll',
    'gqom_drums', 'percussion_break',
  ],
  // African / diaspora percussion — the identity of Afro lanes. Organology facts:
  // gbedu (deep Yoruba drum), the gangan/omele talking-drum family beyond the
  // generic 'talking_drum', the Igbo trio ogene (twin bell) / ekwe (slit drum) /
  // igba (membrane drum), Ghana's kpanlogo and fontomfrom, the agidigbo
  // bass-lamellophone, and the offbeat shaker feel distinct from continuous 16ths.
  african_perc: [
    'talking_drum', 'dundun', 'gangan', 'omele', 'sakara', 'bata', 'gbedu',
    'djembe', 'ashiko', 'udu', 'ogene', 'ekwe', 'igba', 'kpanlogo', 'fontomfrom',
    'shekere', 'agogo', 'cowbell', 'conga', 'bongo', 'cabasa', 'shaker', 'shaker_offbeat',
    'maraca', 'woodblock', 'claves', 'kalimba', 'mbira', 'balafon', 'kora', 'ngoni', 'agidigbo',
  ],
  // Latin / world percussion.
  global_perc: [
    'timbales', 'cajon', 'cuica', 'surdo', 'pandeiro', 'tamborim', 'triangle',
    'tabla', 'darbuka', 'riq', 'bodhran', 'taiko', 'timpani', 'guiro',
  ],
  // Tuned/mallet percussion.
  mallets: ['glockenspiel', 'xylophone', 'marimba', 'vibraphone', 'tubular_bells', 'chimes', 'gong'],
  // Low end. log_drum = the amapiano BASS workhorse; log_drum_lead = the
  // higher-pitched MELODIC log-drum line that answers it (two distinct feels a
  // real amapiano session carries — both keyed, both forgeable).
  bass: [
    'sub_bass', 'bass_808', 'sliding_808', 'log_drum', 'log_drum_lead', 'bass_guitar', 'fretless_bass',
    'upright_bass', 'synth_bass', 'moog_bass', 'reese_bass', 'pluck_bass', 'organ_bass', 'slap_bass',
  ],
  // Chordal / harmonic instruments.
  harmony: [
    'piano', 'upright_piano', 'rhodes', 'wurlitzer', 'clavinet', 'organ', 'hammond',
    'gospel_organ', 'synth_pad', 'warm_pad', 'choir_pad', 'string_pad', 'guitar_chords',
    'highlife_guitar', 'palmwine_guitar', 'reggae_skank', 'house_piano_stab', 'harpsichord', 'accordion',
  ],
  // Lead / melodic color.
  melody: [
    'lead_guitar', 'clean_guitar_riff', 'flute', 'piccolo', 'pan_flute', 'sax', 'trumpet',
    'trombone', 'brass_section', 'violin_line', 'strings_line', 'synth_lead', 'synth_pluck',
    'bell_lead', 'mallet_lead', 'vocal_chop', 'harmonica', 'sitar', 'oud', 'erhu', 'koto',
    'fiddle', 'banjo', 'mandolin', 'pedal_steel', 'ukulele',
  ],
  // Vocal layers (the arranger places these; the engine sings them).
  vocals: [
    'lead_vocal', 'double', 'harmony_vocal', 'adlib', 'chant', 'choir', 'gospel_choir',
    'crowd_chant', 'call_response', 'humming', 'vocal_pad', 'spoken_word', 'hype_vocal',
  ],
  // Transitions / sound design / ambience.
  fx: [
    'riser', 'downlifter', 'impact', 'reverse_cymbal', 'sweep', 'vinyl_noise', 'tape_hiss',
    'crowd_noise', 'club_ambience', 'street_ambience', 'nature_ambience', 'transition_fx',
    'beat_stop', 'drop_fx', 'siren',
  ],
} as const;

export type MaterialFamily = keyof typeof MATERIAL_FAMILIES;
export type MaterialRole = typeof MATERIAL_FAMILIES[MaterialFamily][number];

/** Every role, flat. */
export const ALL_MATERIAL_ROLES: readonly MaterialRole[] = Object.values(MATERIAL_FAMILIES).flat() as MaterialRole[];

const ROLE_SET = new Set<string>(ALL_MATERIAL_ROLES);
export function isMaterialRole(s: string): s is MaterialRole {
  return ROLE_SET.has(s);
}

const FAMILY_OF: Record<string, MaterialFamily> = Object.fromEntries(
  (Object.entries(MATERIAL_FAMILIES) as Array<[MaterialFamily, readonly string[]]>).flatMap(([fam, roles]) =>
    roles.map((r) => [r, fam] as const),
  ),
);
export function familyOf(role: MaterialRole): MaterialFamily {
  return FAMILY_OF[role]!;
}

/** Every pitched role must be key-matched during selection and forging. Keeping
 * this beside the taxonomy prevents the API and worker from quietly disagreeing
 * about guitars, pianos, flutes, mallets, basses, and legacy coarse roles. */
const KEYED_FAMILIES = new Set<MaterialFamily>(['bass', 'harmony', 'melody', 'mallets']);
export function isKeyedRole(role: string): boolean {
  if (role === 'log_drum') return true;
  return isMaterialRole(role) ? KEYED_FAMILIES.has(familyOf(role)) : role === 'bass' || role === 'chords';
}

/** Honest coarse roles produced by broad stem separators. They may supplement a
 * precise genre kit, but must never be relabeled as a specific instrument. */
export const COARSE_MATERIAL_ROLES = ['drums', 'percussion', 'bass', 'chords'] as const;

export function withCoarseMaterialRoles(roles: readonly string[]): string[] {
  return [...new Set([...roles, ...COARSE_MATERIAL_ROLES])];
}

/**
 * The subset the owned Python synth (synth_material.py) can render TODAY. Roles
 * outside this set are steer/verify-only until sample packs or synth routines
 * land — callers must degrade gracefully, never pretend a talking drum was made.
 */
export const SYNTHESIZABLE_ROLES: readonly MaterialRole[] = [
  'log_drum', 'shaker', 'bass_guitar', 'synth_bass', 'sub_bass', 'piano', 'rhodes',
  'kick', 'snare', 'clap', 'closed_hat', 'tom_fill', 'shekere',
] as const;

export function isSynthesizable(role: MaterialRole): boolean {
  return (SYNTHESIZABLE_ROLES as readonly string[]).includes(role);
}

/** A kit's roles grouped by the musical job each family does — used by the
 *  arranger and the completeness check (a real record needs all five jobs). */
export const ROLE_JOBS = {
  rhythm: ['drumkit', 'african_perc', 'global_perc'] as MaterialFamily[],
  low_end: ['bass'] as MaterialFamily[],
  harmony: ['harmony'] as MaterialFamily[],
  melody: ['melody', 'mallets'] as MaterialFamily[],
  vocal: ['vocals'] as MaterialFamily[],
  transition: ['fx'] as MaterialFamily[],
} as const;
export type RoleJob = keyof typeof ROLE_JOBS;

/** The job a role serves (rhythm / low_end / harmony / melody / vocal / transition). */
export function jobOf(role: MaterialRole): RoleJob {
  const fam = familyOf(role);
  for (const [job, fams] of Object.entries(ROLE_JOBS) as Array<[RoleJob, MaterialFamily[]]>) {
    if (fams.includes(fam)) return job;
  }
  return 'melody';
}
