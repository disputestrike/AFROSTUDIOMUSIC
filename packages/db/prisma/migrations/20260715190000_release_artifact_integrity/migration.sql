-- Atomic identifier allocation replaces count-based ISRC/UPC issuance.
CREATE TABLE "ReleaseIdentifierSequence" (
  "namespace" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ReleaseIdentifierSequence_pkey" PRIMARY KEY ("namespace"),
  CONSTRAINT "ReleaseIdentifierSequence_positive_value" CHECK ("value" >= 0)
);

CREATE UNIQUE INDEX "Song_isrc_key" ON "Song"("isrc");
CREATE UNIQUE INDEX "Song_upc_key" ON "Song"("upc");
CREATE UNIQUE INDEX "Release_upc_key" ON "Release"("upc");

-- A Release is the mutable head; every mutation is copied to ReleaseRevision.
ALTER TABLE "Release"
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "title" TEXT,
  ADD COLUMN "artistName" TEXT,
  ADD COLUMN "genre" TEXT,
  ADD COLUMN "audioAssetId" TEXT,
  ADD COLUMN "audioAssetKind" TEXT,
  ADD COLUMN "audioUrl" TEXT,
  ADD COLUMN "coverAssetId" TEXT,
  ADD COLUMN "coverUrl" TEXT,
  ADD COLUMN "exportId" TEXT,
  ADD COLUMN "archiveUrl" TEXT,
  ADD COLUMN "artifactFingerprint" TEXT,
  ADD COLUMN "evidenceHash" TEXT;

CREATE INDEX "Release_workspaceId_status_idx" ON "Release"("workspaceId", "status");
CREATE INDEX "Release_projectId_idx" ON "Release"("projectId");
CREATE INDEX "Release_coverAssetId_idx" ON "Release"("coverAssetId");
CREATE INDEX "Release_exportId_idx" ON "Release"("exportId");

ALTER TABLE "Release"
  ADD CONSTRAINT "Release_coverAssetId_fkey"
    FOREIGN KEY ("coverAssetId") REFERENCES "ImageAsset"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Release_exportId_fkey"
    FOREIGN KEY ("exportId") REFERENCES "Export"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Release" release
SET
  "projectId" = song."projectId",
  "title" = song."title",
  "artistName" = artist."stageName",
  "genre" = project."genre"
FROM "Song" song
JOIN "Project" project ON project."id" = song."projectId"
JOIN "Artist" artist ON artist."id" = project."artistId"
WHERE release."songId" = song."id";

-- Preserve existing behavior only when artwork ownership is unambiguous.
WITH singleton_projects AS (
  SELECT "projectId"
  FROM "Song"
  GROUP BY "projectId"
  HAVING COUNT(*) = 1
)
UPDATE "Release" release
SET
  "coverAssetId" = selected."id",
  "coverUrl" = selected."url"
FROM "Song" song
JOIN singleton_projects singleton ON singleton."projectId" = song."projectId"
JOIN LATERAL (
  SELECT image."id", image."url"
  FROM "ImageAsset" image
  WHERE image."projectId" = song."projectId"
    AND image."kind" = 'cover'
    AND image."approved" = TRUE
    AND image."qualityState" = 'passed'
    AND image."contentHash" IS NOT NULL
    AND image."verifiedAt" IS NOT NULL
  ORDER BY image."createdAt" DESC, image."id" DESC
  LIMIT 1
) selected ON TRUE
WHERE release."songId" = song."id";

CREATE TABLE "ReleaseRevision" (
  "id" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT,
  "songId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "audioUrl" TEXT,
  "coverUrl" TEXT,
  "archiveUrl" TEXT,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReleaseRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReleaseRevision_releaseId_revision_key"
  ON "ReleaseRevision"("releaseId", "revision");
CREATE INDEX "ReleaseRevision_releaseId_createdAt_idx"
  ON "ReleaseRevision"("releaseId", "createdAt" DESC);
CREATE INDEX "ReleaseRevision_workspaceId_status_idx"
  ON "ReleaseRevision"("workspaceId", "status");

ALTER TABLE "ReleaseRevision"
  ADD CONSTRAINT "ReleaseRevision_releaseId_fkey"
    FOREIGN KEY ("releaseId") REFERENCES "Release"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION release_snapshot_json(release_row "Release")
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'releaseId', release_row."id",
    'revision', release_row."revision",
    'workspaceId', release_row."workspaceId",
    'projectId', release_row."projectId",
    'songId', release_row."songId",
    'title', release_row."title",
    'artistName', release_row."artistName",
    'genre', release_row."genre",
    'isrc', release_row."isrc",
    'upc', release_row."upc",
    'audio', jsonb_build_object(
      'assetId', release_row."audioAssetId",
      'kind', release_row."audioAssetKind",
      'url', release_row."audioUrl"
    ),
    'cover', jsonb_build_object(
      'assetId', release_row."coverAssetId",
      'url', release_row."coverUrl"
    ),
    'export', jsonb_build_object(
      'exportId', release_row."exportId",
      'archiveUrl', release_row."archiveUrl",
      'artifactFingerprint', release_row."artifactFingerprint",
      'evidenceHash', release_row."evidenceHash"
    ),
    'distribution', jsonb_build_object(
      'status', release_row."status",
      'provider', release_row."distributor",
      'externalId', release_row."externalId",
      'channels', release_row."channels",
      'submittedAt', release_row."submittedAt",
      'statusAt', release_row."distributionStatusAt",
      'liveAt', release_row."liveAt",
      'releaseDate', release_row."releaseDate"
    )
  );
$$;

UPDATE "Release" SET "revision" = 1;

INSERT INTO "ReleaseRevision" (
  "id",
  "releaseId",
  "workspaceId",
  "projectId",
  "songId",
  "revision",
  "status",
  "audioUrl",
  "coverUrl",
  "archiveUrl",
  "snapshot",
  "createdAt"
)
SELECT
  release."id" || ':0000000001',
  release."id",
  release."workspaceId",
  release."projectId",
  release."songId",
  1,
  release."status",
  release."audioUrl",
  release."coverUrl",
  release."archiveUrl",
  release_snapshot_json(release),
  release."updatedAt"
FROM "Release" release;

CREATE OR REPLACE FUNCTION prepare_release_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  song_project_id TEXT;
  song_title TEXT;
  song_genre TEXT;
  song_artist_name TEXT;
  song_isrc TEXT;
  song_upc TEXT;
BEGIN
  SELECT
    song."projectId",
    song."title",
    project."genre",
    artist."stageName",
    song."isrc",
    song."upc"
  INTO
    song_project_id,
    song_title,
    song_genre,
    song_artist_name,
    song_isrc,
    song_upc
  FROM "Song" song
  JOIN "Project" project ON project."id" = song."projectId"
  JOIN "Artist" artist ON artist."id" = project."artistId"
  WHERE song."id" = NEW."songId";

  NEW."projectId" := COALESCE(NEW."projectId", song_project_id);
  NEW."title" := COALESCE(NEW."title", song_title);
  NEW."genre" := COALESCE(NEW."genre", song_genre);
  NEW."artistName" := COALESCE(NEW."artistName", song_artist_name);
  NEW."isrc" := COALESCE(NEW."isrc", song_isrc);
  NEW."upc" := COALESCE(NEW."upc", song_upc);
  NEW."revision" := CASE
    WHEN TG_OP = 'INSERT' THEN GREATEST(COALESCE(NEW."revision", 0), 0) + 1
    ELSE OLD."revision" + 1
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION append_release_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "ReleaseRevision" (
    "id",
    "releaseId",
    "workspaceId",
    "projectId",
    "songId",
    "revision",
    "status",
    "audioUrl",
    "coverUrl",
    "archiveUrl",
    "snapshot"
  ) VALUES (
    NEW."id" || ':' || LPAD(NEW."revision"::TEXT, 10, '0'),
    NEW."id",
    NEW."workspaceId",
    NEW."projectId",
    NEW."songId",
    NEW."revision",
    NEW."status",
    NEW."audioUrl",
    NEW."coverUrl",
    NEW."archiveUrl",
    release_snapshot_json(NEW)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Release_prepare_revision"
  BEFORE INSERT OR UPDATE ON "Release"
  FOR EACH ROW EXECUTE FUNCTION prepare_release_revision();

CREATE TRIGGER "Release_append_revision"
  AFTER INSERT OR UPDATE ON "Release"
  FOR EACH ROW EXECUTE FUNCTION append_release_revision();

CREATE OR REPLACE FUNCTION protect_release_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND (
      pg_trigger_depth() > 1
      OR NOT EXISTS (
        SELECT 1 FROM "Release" WHERE "id" = OLD."releaseId"
      )
    )
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'release_revision_is_immutable';
END;
$$;

CREATE TRIGGER "ReleaseRevision_immutable"
  BEFORE UPDATE OR DELETE ON "ReleaseRevision"
  FOR EACH ROW EXECUTE FUNCTION protect_release_revision();

-- Parent-delete triggers preserve refs that the API cannot read after cascade.
CREATE TABLE "AssetDeletionCandidate" (
  "id" BIGSERIAL NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT,
  "songId" TEXT,
  "ref" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetDeletionCandidate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssetDeletionCandidate_workspaceId_songId_idx"
  ON "AssetDeletionCandidate"("workspaceId", "songId");
CREATE INDEX "AssetDeletionCandidate_workspaceId_projectId_idx"
  ON "AssetDeletionCandidate"("workspaceId", "projectId");

CREATE OR REPLACE FUNCTION capture_song_deletion_assets()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "AssetDeletionCandidate" (
    "workspaceId", "projectId", "songId", "ref", "kind"
  )
  SELECT OLD."workspaceId", OLD."projectId", OLD."id", export."archiveUrl", 'export_archive'
  FROM "Export" export
  WHERE export."songId" = OLD."id" AND export."archiveUrl" IS NOT NULL
  UNION ALL
  SELECT OLD."workspaceId", OLD."projectId", OLD."id", master."meta" #>> '{deliveryMp3,url}', 'master_delivery_mp3'
  FROM "Master" master
  WHERE master."songId" = OLD."id"
    AND master."meta" #>> '{deliveryMp3,url}' IS NOT NULL
  UNION ALL
  SELECT OLD."workspaceId", OLD."projectId", OLD."id", refs."ref", refs."kind"
  FROM "Release" release
  CROSS JOIN LATERAL (
    VALUES
      (release."audioUrl", 'release_audio'),
      (release."coverUrl", 'release_cover'),
      (release."archiveUrl", 'release_archive')
  ) refs("ref", "kind")
  WHERE release."songId" = OLD."id" AND refs."ref" IS NOT NULL
  UNION ALL
  SELECT OLD."workspaceId", OLD."projectId", OLD."id", refs."ref", refs."kind"
  FROM "ReleaseRevision" revision
  CROSS JOIN LATERAL (
    VALUES
      (revision."audioUrl", 'release_revision_audio'),
      (revision."coverUrl", 'release_revision_cover'),
      (revision."archiveUrl", 'release_revision_archive')
  ) refs("ref", "kind")
  WHERE revision."songId" = OLD."id" AND refs."ref" IS NOT NULL;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION capture_project_deletion_assets()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "AssetDeletionCandidate" (
    "workspaceId", "projectId", "songId", "ref", "kind"
  )
  SELECT OLD."workspaceId", OLD."id", export."songId", export."archiveUrl", 'export_archive'
  FROM "Export" export
  WHERE export."projectId" = OLD."id" AND export."archiveUrl" IS NOT NULL
  UNION ALL
  SELECT OLD."workspaceId", OLD."id", master."songId", master."meta" #>> '{deliveryMp3,url}', 'master_delivery_mp3'
  FROM "Master" master
  WHERE master."projectId" = OLD."id"
    AND master."meta" #>> '{deliveryMp3,url}' IS NOT NULL
  UNION ALL
  SELECT OLD."workspaceId", OLD."id", release."songId", refs."ref", refs."kind"
  FROM "Release" release
  CROSS JOIN LATERAL (
    VALUES
      (release."audioUrl", 'release_audio'),
      (release."coverUrl", 'release_cover'),
      (release."archiveUrl", 'release_archive')
  ) refs("ref", "kind")
  WHERE release."projectId" = OLD."id" AND refs."ref" IS NOT NULL
  UNION ALL
  SELECT OLD."workspaceId", OLD."id", revision."songId", refs."ref", refs."kind"
  FROM "ReleaseRevision" revision
  CROSS JOIN LATERAL (
    VALUES
      (revision."audioUrl", 'release_revision_audio'),
      (revision."coverUrl", 'release_revision_cover'),
      (revision."archiveUrl", 'release_revision_archive')
  ) refs("ref", "kind")
  WHERE revision."projectId" = OLD."id" AND refs."ref" IS NOT NULL;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION capture_release_deletion_assets()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "AssetDeletionCandidate" (
    "workspaceId", "projectId", "songId", "ref", "kind"
  )
  SELECT OLD."workspaceId", OLD."projectId", OLD."songId", refs."ref", refs."kind"
  FROM (
    VALUES
      (OLD."audioUrl", 'release_audio'),
      (OLD."coverUrl", 'release_cover'),
      (OLD."archiveUrl", 'release_archive')
  ) refs("ref", "kind")
  WHERE refs."ref" IS NOT NULL
  UNION ALL
  SELECT OLD."workspaceId", OLD."projectId", OLD."songId", refs."ref", refs."kind"
  FROM "ReleaseRevision" revision
  CROSS JOIN LATERAL (
    VALUES
      (revision."audioUrl", 'release_revision_audio'),
      (revision."coverUrl", 'release_revision_cover'),
      (revision."archiveUrl", 'release_revision_archive')
  ) refs("ref", "kind")
  WHERE revision."releaseId" = OLD."id" AND refs."ref" IS NOT NULL;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "Song_capture_deletion_assets"
  BEFORE DELETE ON "Song"
  FOR EACH ROW EXECUTE FUNCTION capture_song_deletion_assets();

CREATE TRIGGER "Project_capture_deletion_assets"
  BEFORE DELETE ON "Project"
  FOR EACH ROW EXECUTE FUNCTION capture_project_deletion_assets();

CREATE TRIGGER "Release_capture_deletion_assets"
  BEFORE DELETE ON "Release"
  FOR EACH ROW EXECUTE FUNCTION capture_release_deletion_assets();
