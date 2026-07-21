/**
 * SONG RENAME + SINGER RENAME + LYRIC EDIT (owner edits, 2026-07-20).
 *
 * Boots the REAL songs route on a bare Fastify with an in-memory prisma
 * (injected through the @afrohit/db global seam) and a simulated tenant, and
 * proves, WITHOUT a database:
 *   - PATCH /songs/:id { title } renames the song and keeps the lyric title in step
 *   - PATCH /songs/:id { artistName } writes the PER-SONG displayArtist only
 *     (never the workspace artist, never a sibling), and "" resets it to NULL
 *   - a cross-workspace id is rejected as not_found (workspace scoping)
 *   - PATCH /songs/:id/lyrics stamps the draft artistAuthored (VERBATIM LAW)
 * A source pin guards the list/detail read mapping (displayArtist || stageName).
 *
 * Run: pnpm --filter @afrohit/api test:song-edit-lyrics
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.NODE_ENV = "test"; // keep the @afrohit/db global-singleton seam active
process.env.AUTH_MODE = "internal";

type Song = { id: string; workspaceId: string; projectId: string; title: string; displayArtist: string | null; lyricId: string | null };
type Lyric = { id: string; projectId: string; songId: string | null; title: string | null; body: string; cleanVersion: string | null; explicit: boolean; artistAuthored: boolean; versions: unknown };

const songs = new Map<string, Song>();
const lyrics = new Map<string, Lyric>();
let lyricSeq = 0;

function whereScalarMatch(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "not" in (v as object)) return row[k] !== (v as { not: unknown }).not;
    return row[k] === v;
  });
}

const fakePrisma = {
  song: {
    async findFirst({ where, include }: { where: Record<string, unknown>; include?: { lyric?: boolean }; select?: unknown }) {
      const row = [...songs.values()].find((s) => whereScalarMatch(s as unknown as Record<string, unknown>, where));
      if (!row) return null;
      const out: Record<string, unknown> = { ...row };
      if (include?.lyric) out.lyric = [...lyrics.values()].find((l) => l.songId === row.id) ?? null;
      return out;
    },
    async update({ where, data }: { where: { id: string }; data: Partial<Song> }) {
      const row = songs.get(where.id);
      if (!row) throw new Error("song not found");
      Object.assign(row, data);
      return { ...row };
    },
  },
  lyricDraft: {
    async findFirst({ where }: { where: Record<string, unknown> }) {
      const row = [...lyrics.values()].find((l) => whereScalarMatch(l as unknown as Record<string, unknown>, where));
      return row ? { ...row } : null;
    },
    async findUnique({ where }: { where: { id: string } }) {
      const row = lyrics.get(where.id);
      return row ? { ...row } : null;
    },
    async create({ data }: { data: Partial<Lyric> }) {
      const id = `lyr_${++lyricSeq}`;
      const row: Lyric = {
        id,
        projectId: String(data.projectId),
        songId: data.songId ?? null,
        title: data.title ?? null,
        body: data.body ?? "",
        cleanVersion: data.cleanVersion ?? null,
        explicit: data.explicit ?? false,
        artistAuthored: data.artistAuthored ?? false,
        versions: data.versions ?? null,
      };
      lyrics.set(id, row);
      return { ...row };
    },
    async update({ where, data }: { where: { id: string }; data: Partial<Lyric> }) {
      const row = lyrics.get(where.id);
      if (!row) throw new Error("lyric not found");
      Object.assign(row, data);
      return { ...row };
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Partial<Lyric> }) {
      let count = 0;
      for (const row of lyrics.values()) {
        if (whereScalarMatch(row as unknown as Record<string, unknown>, where)) {
          Object.assign(row, data);
          count++;
        }
      }
      return { count };
    },
  },
  beatAsset: {
    async count() {
      return 0;
    },
  },
  // LYRICS LOCK AFTER VIDEO (lib/lyrics-video-lock): the lyric PATCH now asks
  // whether a video exists before allowing an edit. These songs have none —
  // empty stores keep every edit here on the unlocked path.
  videoConcept: {
    async findMany() {
      return [];
    },
  },
  videoRender: {
    async findMany() {
      return [];
    },
  },
};

(globalThis as unknown as { __afrohit_prisma: unknown }).__afrohit_prisma = fakePrisma;

async function main() {
  const { default: Fastify } = await import("fastify");
  const { validatorCompiler, serializerCompiler } = await import("fastify-type-provider-zod");
  const { default: songsRoutes } = await import("../src/routes/songs");

  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook("preValidation", async (req) => {
    (req as unknown as { auth: object }).auth = { userId: "u1", workspaceId: "ws-1", role: "OWNER", isService: false };
  });
  await app.register(songsRoutes, { prefix: "/api/v1/songs" });
  await app.ready();

  // Seed: one song in ws-1 with a bound lyric, one song in a DIFFERENT workspace.
  songs.set("s1", { id: "s1", workspaceId: "ws-1", projectId: "p1", title: "Old Title", displayArtist: null, lyricId: "l1" });
  lyrics.set("l1", { id: "l1", projectId: "p1", songId: "s1", title: "Old Title", body: "[Verse]\noriginal", cleanVersion: null, explicit: false, artistAuthored: false, versions: null });
  songs.set("s2", { id: "s2", workspaceId: "ws-1", projectId: "p2", title: "No Lyric Yet", displayArtist: null, lyricId: null });
  songs.set("foreign", { id: "foreign", workspaceId: "ws-OTHER", projectId: "pX", title: "Not Mine", displayArtist: null, lyricId: null });

  const patch = (url: string, payload: unknown) => app.inject({ method: "PATCH", url, payload });

  // ---- RENAME TITLE --------------------------------------------------------
  let res = await patch("/api/v1/songs/s1", { title: "Brand New Name" });
  assert.equal(res.statusCode, 200, `rename must be 200, got ${res.statusCode}: ${res.body}`);
  assert.equal(songs.get("s1")!.title, "Brand New Name", "song title updated");
  assert.equal(lyrics.get("l1")!.title, "Brand New Name", "lyric title kept in step with the rename");

  // ---- RENAME SINGER (per-song displayArtist) ------------------------------
  res = await patch("/api/v1/songs/s1", { artistName: "Custom Singer" });
  assert.equal(res.statusCode, 200, `singer rename must be 200, got ${res.statusCode}: ${res.body}`);
  assert.equal(songs.get("s1")!.displayArtist, "Custom Singer", "displayArtist set on THIS song only");
  // A sibling song is untouched — renaming one singer never renames another.
  assert.equal(songs.get("s2")!.displayArtist, null, "sibling song's displayArtist is untouched");

  // Blank artistName resets to the workspace default (NULL).
  res = await patch("/api/v1/songs/s1", { artistName: "" });
  assert.equal(res.statusCode, 200, "clearing the singer name must be 200");
  assert.equal(songs.get("s1")!.displayArtist, null, "empty artistName clears displayArtist back to NULL");

  // ---- CROSS-WORKSPACE REJECTION ------------------------------------------
  res = await patch("/api/v1/songs/foreign", { title: "hijack" });
  assert.equal(res.statusCode, 404, `a cross-workspace song must be 404, got ${res.statusCode}`);
  assert.equal(songs.get("foreign")!.title, "Not Mine", "a foreign song is never modified");
  res = await patch("/api/v1/songs/foreign", { artistName: "hijack" });
  assert.equal(res.statusCode, 404, "cross-workspace singer rename must also be 404");
  assert.equal(songs.get("foreign")!.displayArtist, null, "a foreign song's displayArtist is never modified");

  // ---- LYRIC EDIT MARKS artistAuthored (VERBATIM LAW) ----------------------
  // Existing bound draft: editing it flips artistAuthored true.
  assert.equal(lyrics.get("l1")!.artistAuthored, false, "precondition: draft starts non-authored");
  res = await patch("/api/v1/songs/s1/lyrics", { body: "[Verse]\nmy own words\n[Chorus]\nsung as written" });
  assert.equal(res.statusCode, 200, `lyric edit must be 200, got ${res.statusCode}: ${res.body}`);
  assert.equal(lyrics.get("l1")!.body, "[Verse]\nmy own words\n[Chorus]\nsung as written", "lyric body saved verbatim");
  assert.equal(lyrics.get("l1")!.artistAuthored, true, "a hand-edited lyric becomes artistAuthored (never rewritten by enrichment)");

  // Create branch: a song with no lyric yet gets an artist-authored draft.
  res = await patch("/api/v1/songs/s2/lyrics", { title: "Fresh", body: "[Verse]\nfresh words" });
  assert.equal(res.statusCode, 200, `first lyric must be 200, got ${res.statusCode}: ${res.body}`);
  const fresh = [...lyrics.values()].find((l) => l.songId === "s2");
  assert.ok(fresh, "a new draft was created and bound to the song");
  assert.equal(fresh!.artistAuthored, true, "a hand-typed first lyric is artistAuthored too");
  assert.equal(songs.get("s2")!.lyricId, fresh!.id, "the song now points at its new lyric draft");

  // ---- SOURCE PIN: the read mapping falls back correctly -------------------
  const src = readFileSync(join(process.cwd(), "src/routes/songs.ts"), "utf8");
  assert.match(src, /artist: s\.displayArtist \|\| s\.project\.artist\.stageName/, "catalog list uses displayArtist || stageName");
  assert.match(src, /artist: song\.displayArtist \|\| song\.project\.artist\.stageName/, "song detail uses displayArtist || stageName");
  assert.match(src, /artistAuthored: true/, "the lyric PATCH stamps artistAuthored");

  await app.close();
  console.log("song rename + singer rename + lyric edit: per-song scope, cross-workspace rejection, and VERBATIM LAW all pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
