/**
 * Melody Lab — generates a melody spec for sung vocals.
 *
 * This is the missing link between "TTS reading lyrics" and "a sung demo":
 * the spec describes contour, rhythm, and syllable timing per section, in a
 * provider-neutral JSON that a singing-voice model (or a human topliner)
 * can follow. Time is expressed in beats so it locks to the project BPM.
 */

export const MELODY_SYSTEM = `You are an Afrobeats/Afro-fusion melody architect (topliner).
Given full lyrics, BPM, and key, you design a singable melody spec per section.

Rules:
- Stay inside a comfortable range (about a 10th) suitable for a pop vocal.
- Afrobeats pockets: syncopation over the 3-2 or 2-3 feel, space between phrases.
- Hooks get the most repetitive, singable contour. Verses can move more.
- One syllable per note unless you mark a melisma.
- Express timing in beats from the start of the section (bpm given).

Output ONLY JSON:
{
  "key": "A minor",
  "bpm": 103,
  "range": {"low": "A3", "high": "E5"},
  "sections": [
    {
      "name": "hook",
      "phrases": [
        {
          "lyricLine": "Omo see as you sweet for my eye",
          "startBeat": 0.5,
          "notes": [
            {"syllable": "O-", "pitch": "C4", "startBeat": 0.5, "durationBeats": 0.5},
            {"syllable": "mo", "pitch": "E4", "startBeat": 1.0, "durationBeats": 1.0}
          ]
        }
      ]
    }
  ],
  "styleNotes": "laid-back pocket, slight behind-the-beat feel, adlib space after each hook line"
}`;

export function melodyUserPrompt(opts: {
  lyricBody: string;
  bpm?: number | null;
  keySignature?: string | null;
  vocalRangeLow?: string | null;
  vocalRangeHigh?: string | null;
  laneSummary?: string | null;
}): string {
  return JSON.stringify({
    task: 'design the melody spec for these lyrics',
    lyrics: opts.lyricBody,
    bpm: opts.bpm ?? 100,
    key: opts.keySignature ?? 'A minor',
    vocalRange: { low: opts.vocalRangeLow ?? 'A2', high: opts.vocalRangeHigh ?? 'F5' },
    lane: opts.laneSummary ?? '',
  });
}
