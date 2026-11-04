-- Deals: projects on a target company, with team, stage, tasks and milestones.
CREATE TABLE IF NOT EXISTS "DealStage" (
  "key"      text PRIMARY KEY,
  "label"    text NOT NULL,
  "position" integer NOT NULL,
  "kind"     text NOT NULL DEFAULT 'open'
);
INSERT INTO "DealStage" ("key", "label", "position", "kind") VALUES
  ('sourcing',  'Sourcing',            1, 'open'),
  ('screening', 'Screening',           2, 'open'),
  ('ic1',       'First IC',            3, 'open'),
  ('dd',        'Due diligence',       4, 'open'),
  ('ic_final',  'Final IC',            5, 'open'),
  ('signing',   'Signing / closing',   6, 'open'),
  ('closed',    'Closed',              7, 'won'),
  ('dropped',   'Dropped',             8, 'lost')
ON CONFLICT ("key") DO NOTHING;

CREATE TABLE IF NOT EXISTS "Deal" (
  "id"             text PRIMARY KEY,
  "companyId"      text NOT NULL REFERENCES "Company"("id") ON DELETE CASCADE,
  "codeName"       text NOT NULL,
  "type"           text NOT NULL DEFAULT 'buy_side',
  "stage"          text NOT NULL DEFAULT 'sourcing',
  "stageChangedAt" text,
  "onHold"         boolean NOT NULL DEFAULT false,
  "statusNote"     text,
  "leadUserId"     text REFERENCES "User"("id") ON DELETE SET NULL,
  "dealSize"       double precision,
  "currency"       text NOT NULL DEFAULT 'USD',
  "description"    text,
  "createdBy"      text,
  "createdAt"      text NOT NULL,
  "updatedAt"      text NOT NULL
);
CREATE INDEX IF NOT EXISTS "Deal_companyId_idx" ON "Deal" ("companyId");

CREATE TABLE IF NOT EXISTS "DealMember" (
  "id"         text PRIMARY KEY,
  "dealId"     text NOT NULL REFERENCES "Deal"("id") ON DELETE CASCADE,
  "userId"     text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "role"       text NOT NULL DEFAULT 'analyst',
  "allocation" integer NOT NULL DEFAULT 25,
  "createdAt"  text NOT NULL,
  UNIQUE ("dealId", "userId")
);
CREATE INDEX IF NOT EXISTS "DealMember_userId_idx" ON "DealMember" ("userId");

CREATE TABLE IF NOT EXISTS "DealTask" (
  "id"          text PRIMARY KEY,
  "dealId"      text NOT NULL REFERENCES "Deal"("id") ON DELETE CASCADE,
  "title"       text NOT NULL,
  "assigneeId"  text REFERENCES "User"("id") ON DELETE SET NULL,
  "dueDate"     text,
  "status"      text NOT NULL DEFAULT 'todo',
  "createdBy"   text,
  "createdAt"   text NOT NULL,
  "completedAt" text
);
CREATE INDEX IF NOT EXISTS "DealTask_dealId_idx" ON "DealTask" ("dealId");
CREATE INDEX IF NOT EXISTS "DealTask_assigneeId_idx" ON "DealTask" ("assigneeId");

CREATE TABLE IF NOT EXISTS "DealMilestone" (
  "id"        text PRIMARY KEY,
  "dealId"    text NOT NULL REFERENCES "Deal"("id") ON DELETE CASCADE,
  "label"     text NOT NULL,
  "date"      text,
  "done"      boolean NOT NULL DEFAULT false,
  "createdAt" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "DealMilestone_dealId_idx" ON "DealMilestone" ("dealId");

ALTER TABLE "DealStage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Deal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DealMilestone" ENABLE ROW LEVEL SECURITY;
