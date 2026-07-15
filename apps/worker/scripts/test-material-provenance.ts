import { materialCoverage, materialKeyScore, referenceOrigin, selectMaterialRows, withCoarseMaterialRoles, type SelectableMaterial } from '@afrohit/shared';

let failures = 0;
const check = (condition: boolean, message: string) => {
  if (!condition) { console.error(`FAIL: ${message}`); failures += 1; }
};

const base = (row: Partial<SelectableMaterial> & Pick<SelectableMaterial, 'id' | 'role'>): SelectableMaterial => ({
  id: row.id,
  role: row.role,
  url: row.url ?? `s3://bucket/${row.id}.wav`,
  bpm: row.bpm ?? 104,
  keySignature: row.keySignature ?? null,
  source: row.source ?? 'forged',
  readiness: row.readiness ?? 'ready',
  qualityState: row.qualityState ?? 'passed',
  rightsBasis: row.rightsBasis ?? 'provider-generated',
  roleEvidence: row.roleEvidence ?? 'provider-prompted-dsp-consistent',
});

const rows: SelectableMaterial[] = [
  base({ id: 'wrong-key-upload', role: 'highlife_guitar', keySignature: 'F# minor', source: 'artist_stem', rightsBasis: 'user-attested' }),
  base({ id: 'right-key-provider', role: 'highlife_guitar', keySignature: 'C major' }),
  base({ id: 'flute-ready', role: 'flute', keySignature: 'C major' }),
  base({ id: 'flute-rejected', role: 'flute', keySignature: 'C major', readiness: 'rejected', qualityState: 'failed' }),
  base({ id: 'conga-provider', role: 'conga', source: 'forged' }),
  base({ id: 'conga-upload', role: 'conga', source: 'artist_stem', rightsBasis: 'user-attested' }),
  base({ id: 'prompted-drums', role: 'drums', source: 'forged', roleEvidence: 'provider-prompted-dsp-consistent' }),
  base({ id: 'separated-drums', role: 'drums', source: 'provider_stem', roleEvidence: 'stem-separated' }),
  base({ id: 'unknown-piano', role: 'piano', rightsBasis: 'unknown' }),
  base({ id: 'harvested-drums', role: 'drums', source: 'artist_stem', rightsBasis: 'user-attested', roleEvidence: 'stem-separated' }),
  base({ id: 'harvested-bass', role: 'bass', source: 'artist_stem', rightsBasis: 'user-attested', roleEvidence: 'stem-separated', keySignature: 'C major' }),
  base({ id: 'harvested-chords', role: 'chords', source: 'artist_stem', rightsBasis: 'user-attested', roleEvidence: 'stem-separated', keySignature: 'C major' }),
];

const selected = selectMaterialRows(rows, ['highlife_guitar', 'flute', 'conga'], 104, 'C major');
check(selected.find((pick) => pick.role === 'highlife_guitar')?.id === 'right-key-provider', 'all keyed taxonomy roles must prefer the compatible key');
check(selected.find((pick) => pick.role === 'flute')?.id === 'flute-ready', 'rejected material must never be selected');
check(selected.find((pick) => pick.role === 'conga')?.id === 'conga-upload', 'verified artist stems must outrank provider material when musical fit ties');
check(selected.map((pick) => pick.role).join(',') === 'highlife_guitar,flute,conga', 'the caller requested rich roles and the selector must honor them exactly');
check(materialKeyScore('bass_guitar', 'A minor', 'C major') === 1, 'relative major/minor keys should be compatible');
check(materialKeyScore('shaker', 'F# minor', 'C major') === 0, 'unpitched roles must ignore key');
check(selectMaterialRows(rows, ['piano'], 104, 'C major').length === 0, 'rights-unknown material must not enter an assembly');
check(
  selectMaterialRows(rows.filter((row) => row.id === 'prompted-drums' || row.id === 'separated-drums'), ['drums'], 104)[0]?.id === 'separated-drums',
  'stem-separated evidence must outrank a prompted loop when musical fit ties',
);

const supplemented = selectMaterialRows(rows, withCoarseMaterialRoles(['conga', 'flute']), 104, 'C major');
check(supplemented.some((pick) => pick.id === 'harvested-drums'), 'honest coarse drum stems must supplement precise genre roles');
check(materialCoverage(supplemented).ready, 'coarse harvested rhythm, bass, and chords must count toward a complete bed');

check(referenceOrigin('https://example.invalid/audio.wav', {}, null) === 'unknown', 'unclassified URLs must not silently become owned uploads');
check(referenceOrigin('s3://private/owned.wav', { source: 'beat-upload' }, 'user-attested') === 'owned-upload', 'attested uploads must ground their lane');
check(referenceOrigin('zap:chart-song', { source: 'zap' }, 'facts-only') === 'facts-only', 'Zap must remain facts-only');

if (failures) process.exit(1);
console.log('material-provenance: rich-role selection, key fit, QC exclusion, rights origin, and source priority enforced');
