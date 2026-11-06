-- Push notifications to installed devices (phone / desktop), see src/lib/push.ts.
CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id"        text PRIMARY KEY,
  "userId"    text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "endpoint"  text NOT NULL UNIQUE,
  "p256dh"    text NOT NULL,
  "auth"      text NOT NULL,
  "device"    text,
  "createdAt" text NOT NULL,
  "lastUsedAt" text
);
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription" ("userId");
ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;

-- Which kinds of notifications each person wants (JSON: { sheet, tasks, deals, radar }).
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "pushPrefs" text;
