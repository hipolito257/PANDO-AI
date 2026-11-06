-- Executive summary on each deal: company overview, financial overview and
-- transaction overview, as edited by the team (JSON, see src/lib/dealSummary.ts).
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "summary" text;
