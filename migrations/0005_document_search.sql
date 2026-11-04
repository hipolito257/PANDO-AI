-- Semantic search over company documents (see src/lib/docIndex.ts).
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "CompanyFile" ADD COLUMN IF NOT EXISTS "indexStatus" text NOT NULL DEFAULT 'none';
ALTER TABLE "CompanyFile" ADD COLUMN IF NOT EXISTS "indexError"  text;
ALTER TABLE "CompanyFile" ADD COLUMN IF NOT EXISTS "indexedAt"   text;
ALTER TABLE "CompanyFile" ADD COLUMN IF NOT EXISTS "chunkCount"  integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "DocChunk" (
  "id"         text PRIMARY KEY,
  "companyId"  text NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "fileId"     text NOT NULL REFERENCES "CompanyFile"("id") ON DELETE CASCADE,
  "position"   integer NOT NULL,
  "locator"    text,
  "text"       text NOT NULL,
  "tokens"     integer NOT NULL DEFAULT 0,
  "embedding"  vector(1024),
  "createdAt"  text NOT NULL
);
CREATE INDEX IF NOT EXISTS "DocChunk_company_idx" ON "DocChunk" ("companyId");
CREATE INDEX IF NOT EXISTS "DocChunk_file_idx" ON "DocChunk" ("fileId");
CREATE INDEX IF NOT EXISTS "DocChunk_embedding_idx" ON "DocChunk" USING hnsw ("embedding" vector_cosine_ops);
