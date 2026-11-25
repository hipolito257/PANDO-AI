-- Team rating of each deal (src/lib/dealRating.ts): interest and status.
-- "High interest" + "Pending" deals are flagged as alerts.
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "interest" text NOT NULL DEFAULT 'radar';
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "dealStatus" text NOT NULL DEFAULT 'active';
UPDATE "Deal" SET "dealStatus" = 'on_hold' WHERE "onHold" = true AND "dealStatus" = 'active';
CREATE INDEX IF NOT EXISTS "Deal_alert_idx" ON "Deal" ("interest", "dealStatus");
