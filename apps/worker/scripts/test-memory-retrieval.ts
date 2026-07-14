import assert from "node:assert/strict";
import { rankMemoryCandidates } from "@afrohit/shared";

const now = new Date("2026-07-14T00:00:00.000Z");
const ranked = rankMemoryCandidates({
  query: "warm afrobeats love hook with pidgin call and response",
  queryEmbedding: [1, 0, 0],
  limit: 3,
  now,
  candidates: [
    {
      content: "old but semantically exact afrobeats love call and response",
      embedding: [1, 0, 0],
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      content: "recent unrelated cold techno instrumental",
      embedding: [0, 1, 0],
      createdAt: "2026-07-13T00:00:00.000Z",
    },
    {
      content: "Warm Afrobeats love hook with pidgin call and response",
      embedding: null,
      createdAt: "2026-06-01T00:00:00.000Z",
    },
    {
      content: "  warm afrobeats LOVE hook with pidgin call and response ",
      embedding: [1, 0, 0],
      createdAt: "2026-05-01T00:00:00.000Z",
    },
    {
      content: "malformed vector must not break retrieval",
      embedding: [1, "bad", 0],
      createdAt: "invalid-date",
    },
  ],
});

assert.equal(ranked.length, 3);
assert.match(ranked[0]!.content, /afrobeats/i);
assert.equal(
  ranked.filter(row => /warm afrobeats love hook/i.test(row.content)).length,
  1,
  "normalized duplicate memories should collapse"
);
assert.ok(
  ranked.findIndex(row => /unrelated cold techno/i.test(row.content)) > 0,
  "recency must not outrank a semantically exact older memory"
);

const lexicalFallback = rankMemoryCandidates({
  query: "log drum amapiano groove",
  limit: 1,
  now,
  candidates: [
    {
      content: "log drum amapiano groove with shaker pocket",
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    {
      content: "brand new unrelated orchestral ballad",
      createdAt: "2026-07-14T00:00:00.000Z",
    },
  ],
});
assert.match(lexicalFallback[0]!.content, /log drum amapiano/i);

console.log("memory retrieval: semantic use, fallback, and dedupe passed");
