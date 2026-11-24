-- The platform is organised in five sections: General, Fundraising, Deal
-- Sourcing, Portfolio Management and Exit. Deals move between the last three
-- (their "phase"); each phase has its own stages. Fundraising tracks investors.

-- Stages belong to a phase.
ALTER TABLE "DealStage" ADD COLUMN IF NOT EXISTS "phase" text NOT NULL DEFAULT 'sourcing';
INSERT INTO "DealStage" ("key", "label", "position", "kind", "phase") VALUES
  ('pf_onboarding', '100-day plan',     1, 'open', 'portfolio'),
  ('pf_value',      'Value creation',   2, 'open', 'portfolio'),
  ('pf_monitoring', 'Monitoring',       3, 'open', 'portfolio'),
  ('pf_watchlist',  'Watchlist',        4, 'open', 'portfolio'),
  ('ex_prep',        'Exit preparation', 1, 'open', 'exit'),
  ('ex_process',     'Banker & process', 2, 'open', 'exit'),
  ('ex_negotiation', 'Offers & SPA',     3, 'open', 'exit'),
  ('ex_realized',    'Realized',         4, 'won',  'exit')
ON CONFLICT ("key") DO NOTHING;

-- Deals belong to a phase. Deals already closed (won) in the pipeline are
-- investments: they start in Portfolio.
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "phase" text NOT NULL DEFAULT 'sourcing';
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "phaseChangedAt" text;
UPDATE "Deal" SET "phase" = 'portfolio', "stage" = 'pf_value', "phaseChangedAt" = now()::text
WHERE "phase" = 'sourcing' AND "stage" IN (SELECT "key" FROM "DealStage" WHERE "phase" = 'sourcing' AND "kind" = 'won');
CREATE INDEX IF NOT EXISTS "Deal_phase_idx" ON "Deal" ("phase");

-- Fundraising: the investors (LPs) Pando is raising from.
CREATE TABLE IF NOT EXISTS "Investor" (
  "id"              text PRIMARY KEY,
  "name"            text NOT NULL,
  "type"            text NOT NULL DEFAULT 'family_office',
  "country"         text,
  "city"            text,
  "website"         text,
  "contactName"     text,
  "contactRole"     text,
  "stage"           text NOT NULL DEFAULT 'identified',
  "targetAmount"    double precision,
  "committedAmount" double precision,
  "currency"        text NOT NULL DEFAULT 'USD',
  "ownerId"         text REFERENCES "User"("id") ON DELETE SET NULL,
  "nextStep"        text,
  "nextStepDate"    text,
  "notes"           text,
  "stageChangedAt"  text,
  "createdBy"       text,
  "createdAt"       text NOT NULL,
  "updatedAt"       text NOT NULL
);
CREATE INDEX IF NOT EXISTS "Investor_stage_idx" ON "Investor" ("stage");
ALTER TABLE "Investor" ENABLE ROW LEVEL SECURITY;

-- The fund's target size, for fundraising progress.
ALTER TABLE "FirmSettings" ADD COLUMN IF NOT EXISTS "fundTarget" double precision;
ALTER TABLE "FirmSettings" ADD COLUMN IF NOT EXISTS "fundCurrency" text;
ALTER TABLE "FirmSettings" ADD COLUMN IF NOT EXISTS "fundName" text;
