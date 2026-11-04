-- Background jobs (see src/lib/jobs.ts)
CREATE TABLE IF NOT EXISTS "Job" (
  "id"          text PRIMARY KEY,
  "type"        text NOT NULL,
  "status"      text NOT NULL DEFAULT 'queued',
  "userId"      text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "companyId"   text REFERENCES "Company"("id") ON DELETE SET NULL,
  "title"       text NOT NULL,
  "progress"    integer NOT NULL DEFAULT 0,
  "message"     text,
  "input"       text NOT NULL DEFAULT '{}',
  "result"      text,
  "error"       text,
  "createdAt"   text NOT NULL,
  "startedAt"   text,
  "finishedAt"  text,
  "heartbeatAt" text
);
CREATE INDEX IF NOT EXISTS "Job_userId_createdAt_idx" ON "Job" ("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Job_companyId_idx" ON "Job" ("companyId");
ALTER TABLE "Job" ENABLE ROW LEVEL SECURITY;
