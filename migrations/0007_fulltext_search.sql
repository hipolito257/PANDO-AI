-- Document search moves from Voyage embeddings to Postgres full-text search:
-- no outside service, no rate limits, passages are searchable as soon as a
-- file is read. Words are matched in Spanish and English (stems, accents ignored).
DROP INDEX IF EXISTS "DocChunk_embedding_idx";
ALTER TABLE "DocChunk" DROP COLUMN IF EXISTS "embedding";

ALTER TABLE "DocChunk" ADD COLUMN IF NOT EXISTS "tsv" tsvector GENERATED ALWAYS AS (
  to_tsvector('spanish'::regconfig, translate(lower("text"), 'áéíóúüñàèìòùâêîôûäëïöç', 'aeiouunaeiouaeiouaeioc'))
  || to_tsvector('english'::regconfig, translate(lower("text"), 'áéíóúüñàèìòùâêîôûäëïöç', 'aeiouunaeiouaeiouaeioc'))
) STORED;
CREATE INDEX IF NOT EXISTS "DocChunk_tsv_idx" ON "DocChunk" USING gin ("tsv");

-- Files that were read but waiting for embeddings are searchable now.
UPDATE "CompanyFile" SET "indexStatus" = 'indexed', "indexedAt" = now()::text, "indexError" = NULL
WHERE "indexStatus" = 'chunked';
