-- Real cap table per company (JSON, see src/lib/capTable.ts): edited by the team
-- or drafted by Claude from the company's documents.
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "capTable" text;
