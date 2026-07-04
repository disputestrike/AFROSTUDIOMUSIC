-- Run after `prisma db push` or migrate, to add PostGIS-specific indexes that Prisma cannot express.
-- Idempotent — safe to re-run.

CREATE INDEX IF NOT EXISTS share_event_location_gix
  ON "ShareEvent" USING GIST (location);

-- For regional heatmap queries (country + time slice)
CREATE INDEX IF NOT EXISTS share_event_country_created_idx
  ON "ShareEvent" ("country", "createdAt" DESC);

-- pgvector ANN index over ArtistMemoryChunk.embedding.
-- HNSW is preferred when available; falls back to ivfflat if not.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'artist_memory_embedding_idx') THEN
    BEGIN
      EXECUTE 'CREATE INDEX artist_memory_embedding_idx ON "ArtistMemoryChunk" USING hnsw (embedding vector_cosine_ops)';
    EXCEPTION WHEN OTHERS THEN
      EXECUTE 'CREATE INDEX artist_memory_embedding_idx ON "ArtistMemoryChunk" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';
    END;
  END IF;
END$$;
