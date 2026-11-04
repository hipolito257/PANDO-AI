-- Provenance: one row per change to a company data point (see src/lib/provenance.ts).
CREATE TABLE IF NOT EXISTS "FieldChange" (
  "id"          text PRIMARY KEY,
  "companyId"   text NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "field"       text NOT NULL,
  "oldValue"    text,
  "newValue"    text,
  "sourceType"  text NOT NULL,
  "sourceRef"   text,
  "sourceLabel" text,
  "note"        text,
  "userId"      text,
  "userName"    text,
  "createdAt"   text NOT NULL
);
CREATE INDEX IF NOT EXISTS "FieldChange_company_idx" ON "FieldChange" ("companyId", "createdAt");
