-- BRAND WAVE (2026-07-20): "On all songs change BENXP to BXP" — the artist
-- stage name is BXP everywhere. Pure DML, ZERO schema drift: the two UPDATEs
-- rewrite existing rows only where they still carry the old name, so the
-- migration is idempotent (re-running it matches zero rows) and safe on any
-- environment — dev, scratch clusters and prod alike. New rows already get
-- 'BXP' from the corrected seed/writer defaults.

-- Artist.stageName — the workspace artist identity (Song.displayArtist falls
-- back to this via project.artist when null).
UPDATE "Artist" SET "stageName" = 'BXP' WHERE "stageName" = 'BENXP';

-- Song.displayArtist — the per-song display override (owner edit, 2026-07-20).
UPDATE "Song" SET "displayArtist" = 'BXP' WHERE "displayArtist" = 'BENXP';
