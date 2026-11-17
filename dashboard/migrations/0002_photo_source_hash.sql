-- Fingerprint (SHA-256, hex) of the original file a photo was made from, so picking the same photo
-- again is recognised and skipped. NULL for photos added before this existed.
ALTER TABLE photos ADD COLUMN source_hash TEXT;
CREATE UNIQUE INDEX photos_source_hash ON photos (source_hash) WHERE source_hash IS NOT NULL;
