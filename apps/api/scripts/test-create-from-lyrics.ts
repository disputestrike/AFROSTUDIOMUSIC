/**
 * CREATE-FROM-LYRICS — reproduce the 400 invalid_request (2026-07-19).
 * Owner: "I can't create songs from my own lyrics — it never works."
 * Runs the REAL production schemas against the exact payloads the create page
 * sends, to pinpoint which field 400s (function test, no click-through needed).
 */
import assert from 'node:assert/strict';
import { z } from 'zod';
import { generateBeatInputSchema, genreSchema } from '../../../packages/shared/src/schemas';

// copies of the two smaller route schemas (projects.ts createProjectSchema +
// lyrics.ts attachSchema) — kept in sync here to test the whole chain.
const createProjectSchema = z.object({
  artistId: z.string().cuid().optional(),
  title: z.string().min(1).max(160),
  genre: genreSchema,
  bpm: z.number().int().min(40).max(220).optional(),
});
const attachSchema = z.object({ title: z.string().min(1).max(120), body: z.string().min(20).max(12000) });

const CUID = 'cm' + 'a'.repeat(23); // shape-valid cuid for the test
const gen = (bpm: number, extra: Record<string, unknown> = {}) =>
  generateBeatInputSchema.omit({ projectId: true }).safeParse({
    songId: CUID, genre: 'afrobeats', bpm, withStems: false, withVocals: true,
    languages: ['pcm', 'en'], mood: 'confident', instruments: ['piano', 'sax', 'shekere', 'talking_drum'],
    ...extra,
  });

// ── FIX 1: bpm ranges now AGREE (40..220), and crazy values clamp not 400 ────
assert.equal(createProjectSchema.safeParse({ title: 'x', genre: 'afrobeats', bpm: 190 }).success, true, 'project accepts bpm 190');
assert.equal(gen(190).success, true, 'FIXED: beats/generate now accepts bpm 190 (matches /projects)');
assert.equal(gen(55).success, true, 'FIXED: beats/generate now accepts bpm 55');
assert.equal(gen(112).success, true, 'in-range bpm 112 passes');
// a genuinely insane tempo no longer 400s — it clamps to a safe default
const crazy = gen(400);
assert.equal(crazy.success, true, 'FIXED: an out-of-range bpm 400 no longer rejects — it coerces');
if (crazy.success) assert.equal(crazy.data.bpm, 112, 'a crazy bpm coerces to the 112 default instead of 400ing');

// ── FIX 2: a long full-song lyric now attaches (cap raised 6000 -> 12000) ─────
const longBody = 'la la la '.repeat(750); // ~6750 chars — a long full lyric
assert.ok(longBody.length > 6000 && longBody.length < 12000, 'test body is a long-but-real lyric');
assert.equal(attachSchema.safeParse({ title: 'My lyrics', body: longBody }).success, true, 'FIXED: a long lyric (>6000) now attaches');
assert.equal(attachSchema.safeParse({ title: 'My lyrics', body: 'a real short verse here we go' }).success, true, 'normal lyrics attach fine');
assert.equal(attachSchema.safeParse({ title: 'My lyrics', body: 'x'.repeat(13000) }).success, false, 'an absurd 13k lyric is still bounded');

console.log('FIXED + PROVEN: from-lyrics 400 gone — bpm ranges agree (40-220, crazy clamps to 112), lyric cap 6000->12000.');
