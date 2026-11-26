-- Fundraising CRM: investor profile, contacts, AI research & score, Google Sheet sync.

ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "linkedinUrl"    text;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "description"    text;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "aum"            double precision;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "focus"          text;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "geographies"    text;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "ticketMin"      double precision;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "ticketMax"      double precision;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "fitScore"       integer;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "probability"    integer;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "scoreSource"    text;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "scoredAt"       text;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "research"       text;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "researchStatus" text;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "researchError"  text;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "researchedAt"   text;
ALTER TABLE "Investor" ADD COLUMN IF NOT EXISTS "sheetKey"       text;

CREATE TABLE IF NOT EXISTS "InvestorContact" (
  "id"          text PRIMARY KEY,
  "investorId"  text NOT NULL REFERENCES "Investor"("id") ON DELETE CASCADE,
  "name"        text NOT NULL,
  "role"        text,
  "email"       text,
  "phone"       text,
  "linkedinUrl" text,
  "notes"       text,
  "isPrimary"   boolean NOT NULL DEFAULT false,
  "source"      text NOT NULL DEFAULT 'manual',
  "createdAt"   text NOT NULL,
  "updatedAt"   text NOT NULL
);
CREATE INDEX IF NOT EXISTS "InvestorContact_investorId_idx" ON "InvestorContact" ("investorId");
ALTER TABLE "InvestorContact" ENABLE ROW LEVEL SECURITY;

-- The contact already on each investor becomes its first (primary) contact.
INSERT INTO "InvestorContact" ("id", "investorId", "name", "role", "isPrimary", "source", "createdAt", "updatedAt")
SELECT 'ic_' || "id", "id", "contactName", "contactRole", true, 'manual', "createdAt", "updatedAt"
FROM "Investor" WHERE "contactName" IS NOT NULL AND trim("contactName") <> ''
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "InvestorSheetSync" (
  "id"          text PRIMARY KEY,
  "sourceUrl"   text NOT NULL,
  "fileId"      text NOT NULL,
  "fileKind"    text NOT NULL DEFAULT 'gsheet',
  "sheetName"   text,
  "headerRow"   integer NOT NULL DEFAULT 1,
  "columnMap"   text NOT NULL DEFAULT '{}',
  "frequency"   text NOT NULL DEFAULT 'daily',
  "snapshot"    text,
  "lastRunAt"   text,
  "lastStatus"  text,
  "lastError"   text,
  "lastSummary" text,
  "createdBy"   text,
  "createdAt"   text NOT NULL
);
ALTER TABLE "InvestorSheetSync" ENABLE ROW LEVEL SECURITY;
