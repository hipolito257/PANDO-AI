-- How the platform reads the investors workbook (all tabs), worked out by AI:
-- which tabs to use, header rows, column roles, tab-level type, value translations.
ALTER TABLE "InvestorSheetSync" ADD COLUMN IF NOT EXISTS "plan" text;
ALTER TABLE "InvestorSheetSync" ADD COLUMN IF NOT EXISTS "planFingerprint" text;
ALTER TABLE "InvestorSheetSync" ADD COLUMN IF NOT EXISTS "valueMap" text;
