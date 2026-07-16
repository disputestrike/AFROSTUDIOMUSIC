import {
  materialCoverage,
  materialGenreMatches,
  materialKeyScore,
  normalizeMaterialGenre,
  referenceOrigin,
  selectMaterialRows,
  withCoarseMaterialRoles,
  type SelectableMaterial,
} from "@afrohit/shared";

let failures = 0;
const check = (condition: boolean, message: string) => {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failures += 1;
  }
};

const base = (
  row: Partial<SelectableMaterial> & Pick<SelectableMaterial, "id" | "role">
): SelectableMaterial => ({
  id: row.id,
  role: row.role,
  url: row.url ?? `s3://bucket/${row.id}.wav`,
  // Explicit null must survive (bpm-null disqualification tests) — only an
  // OMITTED bpm defaults to the target tempo.
  bpm: row.bpm !== undefined ? row.bpm : 104,
  keySignature: row.keySignature ?? null,
  source: row.source ?? "forged",
  readiness: row.readiness ?? "ready",
  qualityState: row.qualityState ?? "passed",
  rightsBasis: row.rightsBasis ?? "provider-generated",
  roleEvidence: row.roleEvidence ?? "provider-prompted-dsp-consistent",
});

const rows: SelectableMaterial[] = [
  base({
    id: "wrong-key-upload",
    role: "highlife_guitar",
    keySignature: "F# minor",
    source: "artist_stem",
    rightsBasis: "user-attested",
  }),
  base({
    id: "right-key-provider",
    role: "highlife_guitar",
    keySignature: "C major",
  }),
  base({ id: "flute-ready", role: "flute", keySignature: "C major" }),
  base({
    id: "flute-rejected",
    role: "flute",
    keySignature: "C major",
    readiness: "rejected",
    qualityState: "failed",
  }),
  base({ id: "conga-provider", role: "conga", source: "forged" }),
  base({
    id: "conga-upload",
    role: "conga",
    source: "artist_stem",
    rightsBasis: "user-attested",
  }),
  base({
    id: "prompted-drums",
    role: "drums",
    source: "forged",
    roleEvidence: "provider-prompted-dsp-consistent",
  }),
  base({
    id: "separated-drums",
    role: "drums",
    source: "provider_stem",
    roleEvidence: "stem-separated",
  }),
  base({
    id: "unconfirmed-flute",
    role: "flute",
    roleEvidence: "provider-prompted-unconfirmed",
  }),
  base({ id: "legacy-prompt", role: "sax", roleEvidence: "provider-prompted" }),
  base({
    id: "technical-conga",
    role: "conga",
    roleEvidence: "provider-prompted-technical-only",
  }),
  base({
    id: "technical-chant",
    role: "chant",
    roleEvidence: "provider-prompted-technical-only",
  }),
  base({ id: "unknown-piano", role: "piano", rightsBasis: "unknown" }),
  base({
    id: "harvested-drums",
    role: "drums",
    source: "artist_stem",
    rightsBasis: "user-attested",
    roleEvidence: "stem-separated",
  }),
  base({
    id: "harvested-bass",
    role: "bass",
    source: "artist_stem",
    rightsBasis: "user-attested",
    roleEvidence: "stem-separated",
    keySignature: "C major",
  }),
  base({
    id: "harvested-chords",
    role: "chords",
    source: "artist_stem",
    rightsBasis: "user-attested",
    roleEvidence: "stem-separated",
    keySignature: "C major",
  }),
];

const selected = selectMaterialRows(
  rows,
  ["highlife_guitar", "flute", "conga"],
  104,
  "C major"
);
check(
  selected.find(pick => pick.role === "highlife_guitar")?.id ===
    "right-key-provider",
  "all keyed taxonomy roles must prefer the compatible key"
);
check(
  selected.find(pick => pick.role === "flute")?.id === "flute-ready",
  "rejected material must never be selected"
);
check(
  selected.find(pick => pick.role === "conga")?.id === "conga-upload",
  "verified artist stems must outrank provider material when musical fit ties"
);
check(
  selected.map(pick => pick.role).join(",") === "highlife_guitar,flute,conga",
  "the caller requested rich roles and the selector must honor them exactly"
);
check(
  materialKeyScore("bass_guitar", "A minor", "C major") === 1,
  "relative major/minor keys should be compatible"
);
check(
  materialKeyScore("shaker", "F# minor", "C major") === 0,
  "unpitched roles must ignore key"
);
check(
  selectMaterialRows(rows, ["piano"], 104, "C major").length === 0,
  "rights-unknown material must not enter an assembly"
);
check(
  selectMaterialRows(
    rows.filter(
      row => row.id === "prompted-drums" || row.id === "separated-drums"
    ),
    ["drums"],
    104
  )[0]?.id === "separated-drums",
  "stem-separated evidence must outrank a prompted loop when musical fit ties"
);
check(
  selectMaterialRows(
    rows.filter(row => row.id === "unconfirmed-flute"),
    ["flute"],
    104
  ).length === 0,
  "DSP-inconsistent prompted instruments must stay out of automatic assembly"
);
check(
  selectMaterialRows(
    rows.filter(row => row.id === "legacy-prompt"),
    ["sax"],
    104
  ).length === 0,
  "legacy prompt-only rows must be re-inspected before automatic assembly"
);
check(
  selectMaterialRows(
    rows.filter(row => row.id === "technical-conga"),
    ["conga"],
    104
  ).length === 0,
  "technical-only evidence cannot stand in for a core instrument"
);
check(
  selectMaterialRows(
    rows.filter(row => row.id === "technical-chant"),
    ["chant"],
    104
  )[0]?.id === "technical-chant",
  "technical-only vocal textures remain usable with their lower-confidence receipt"
);

const supplemented = selectMaterialRows(
  rows,
  withCoarseMaterialRoles(["conga", "flute"]),
  104,
  "C major"
);
check(
  supplemented.some(pick => pick.id === "harvested-drums"),
  "honest coarse drum stems must supplement precise genre roles"
);
check(
  materialCoverage(supplemented).ready,
  "coarse harvested rhythm, bass, and chords must count toward a complete bed"
);

// ---- Test-tone demotion: 'synth-code' is BRIDGE material. It used to rank 0
// alongside real stems, so numpy sine loops outranked AI-forged loops for the
// song's foundation — the literal "test tones in real songs" the owner hears.
const synthDrums = base({
  id: "synth-drums",
  role: "drums",
  roleEvidence: "synth-code",
  rightsBasis: "code-generated",
});
const forgedDrums = base({
  id: "forged-drums",
  role: "drums",
  roleEvidence: "provider-prompted-dsp-consistent",
});
check(
  selectMaterialRows([synthDrums, forgedDrums], ["drums"], 104)[0]?.id ===
    "forged-drums",
  "a forged loop must beat the numpy test-tone loop for the foundation"
);
for (const seed of [0, 1, 2, 3, 4]) {
  check(
    selectMaterialRows([synthDrums, forgedDrums], ["drums"], 104, null, {
      varietySeed: seed,
    })[0]?.id === "forged-drums",
    `variety seed ${seed} must never rotate onto the synth bridge loop`
  );
}
check(
  selectMaterialRows(
    [
      base({
        id: "synth-shaker",
        role: "shaker",
        roleEvidence: "synth-code",
        rightsBasis: "code-generated",
      }),
      base({
        id: "licensed-shaker",
        role: "shaker",
        source: "licensed",
        rightsBasis: "licensed",
        roleEvidence: "licensed-metadata",
      }),
    ],
    ["shaker"],
    104
  )[0]?.id === "licensed-shaker",
  "licensed material must also beat the synth bridge loop"
);
check(
  selectMaterialRows([synthDrums], ["drums"], 104)[0]?.id === "synth-drums",
  "the synth bridge loop remains selectable when it is the ONLY candidate"
);

// ---- Tempo honesty: unmeasured bpm cannot be conformed (sourceBpm would
// silently default to the target and the loop would play at its real tempo).
check(
  selectMaterialRows(
    [base({ id: "null-bpm-drums", role: "drums", bpm: null })],
    ["drums"],
    104
  ).length === 0,
  "bpm-null rhythm material must be disqualified from auto-assembly"
);
check(
  selectMaterialRows(
    [base({ id: "null-bpm-bass", role: "bass", bpm: null, keySignature: "C major" })],
    ["bass"],
    104,
    "C major"
  ).length === 0,
  "bpm-null low-end material must be disqualified from auto-assembly"
);
check(
  selectMaterialRows(
    [base({ id: "null-bpm-fill", role: "fill", bpm: null })],
    ["fill"],
    104
  ).length === 0,
  "bpm-null fills must be disqualified (a free-running fill smears the transition)"
);
check(
  selectMaterialRows(
    [base({ id: "null-bpm-riser", role: "riser", bpm: null })],
    ["riser"],
    104
  )[0]?.id === "null-bpm-riser",
  "fx textures may still ride the bed at unknown tempo"
);

// ---- ±5% tempo gate (was ±15%): smaller atempo ratios, fewer artifacts.
check(
  selectMaterialRows(
    [base({ id: "conga-110", role: "conga", bpm: 110 })],
    ["conga"],
    104
  ).length === 0,
  "a 110bpm loop must not conform to a 104bpm song (>5% stretch)"
);
check(
  selectMaterialRows(
    [base({ id: "conga-108", role: "conga", bpm: 108 })],
    ["conga"],
    104
  )[0]?.id === "conga-108",
  "a 108bpm loop still conforms to a 104bpm song (<5% stretch)"
);

// ---- Key is a GATE for keyed roles: wrong-key rows must not survive any
// variety rotation when a better-key candidate passed the other gates.
const wrongKeyPiano = base({
  id: "wrong-key-piano",
  role: "piano",
  keySignature: "F# minor",
});
const rightKeyPiano = base({
  id: "right-key-piano",
  role: "piano",
  keySignature: "C major",
});
for (const seed of [0, 1, 2, 3, 4]) {
  check(
    selectMaterialRows([wrongKeyPiano, rightKeyPiano], ["piano"], 104, "C major", {
      varietySeed: seed,
    })[0]?.id === "right-key-piano",
    `wrong-key piano must be hard-filtered when a better key exists (seed ${seed})`
  );
}
check(
  selectMaterialRows([wrongKeyPiano], ["piano"], 104, "C major")[0]?.id ===
    "wrong-key-piano",
  "a role stays coverable when ONLY wrong-key material exists (key is in the receipt)"
);

// ---- The variety window rotates only within a KEY TIE: two exact-key chords
// alternate, the relative-key one never rides the rotation in.
const exactChordsA = base({ id: "chords-a-exact", role: "chords", keySignature: "C major" });
const exactChordsB = base({ id: "chords-b-exact", role: "chords", keySignature: "C major" });
const relativeChords = base({ id: "chords-relative", role: "chords", keySignature: "A minor" });
const rotationSeen = new Set<string>();
for (const seed of [0, 1, 2, 3]) {
  const pick = selectMaterialRows(
    [relativeChords, exactChordsA, exactChordsB],
    ["chords"],
    104,
    "C major",
    { varietySeed: seed }
  )[0];
  check(
    pick?.id !== "chords-relative",
    `variety window must not cross the key tie onto a relative-key loop (seed ${seed})`
  );
  if (pick) rotationSeen.add(pick.id);
}
check(
  rotationSeen.size === 2,
  "variety rotation still alternates between the key-tied candidates"
);

// ---- Genre canonicalization: 'Afrobeats' stems must be visible to an
// 'afrobeats' lane (same canonical form as lane-material.ts's norm()).
check(
  normalizeMaterialGenre(" Afro-Beats ") === "afro_beats",
  "genre normalization lowercases, trims, and collapses separators"
);
check(
  materialGenreMatches("Afrobeats", "afrobeats"),
  "genre matching must be case-insensitive"
);
check(
  materialGenreMatches("afro beats", "Afro/Beats"),
  "space/slash/hyphen runs collapse to one canonical genre"
);
check(
  !materialGenreMatches("amapiano", "afrobeats"),
  "different genres must never match"
);
check(
  !materialGenreMatches(null, "afrobeats"),
  "null genre never MATCHES — callers decide whether untagged rows are wildcards"
);

check(
  referenceOrigin("https://example.invalid/audio.wav", {}, null) === "unknown",
  "unclassified URLs must not silently become owned uploads"
);
check(
  referenceOrigin(
    "s3://private/owned.wav",
    { source: "beat-upload" },
    "user-attested"
  ) === "owned-upload",
  "attested uploads must ground their lane"
);
check(
  referenceOrigin("zap:chart-song", { source: "zap" }, "facts-only") ===
    "facts-only",
  "Zap must remain facts-only"
);

if (failures) process.exit(1);
console.log(
  "material-provenance: rich-role selection, key gating, tempo honesty (±5%, no bpm-null grid roles), synth-bridge demotion, genre canonicalization, QC exclusion, rights origin, and source priority enforced"
);
