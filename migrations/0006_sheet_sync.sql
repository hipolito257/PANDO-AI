-- Deal pipeline sync from a Google Sheet / Excel in Google Drive.
-- A SheetSync is the connection (link, column and stage mapping, frequency);
-- each SheetSyncRun reads the sheet and proposes changes that someone approves.
CREATE TABLE IF NOT EXISTS "SheetSync" (
  "id"          text PRIMARY KEY,
  "name"        text NOT NULL DEFAULT 'Deal pipeline',
  "sourceUrl"   text NOT NULL,
  "fileId"      text NOT NULL,
  "fileKind"    text NOT NULL DEFAULT 'gsheet',      -- gsheet | drive_file
  "sheetName"   text,
  "headerRow"   integer NOT NULL DEFAULT 1,
  "columnMap"   text NOT NULL DEFAULT '{}',          -- field -> column header
  "stageMap"    text NOT NULL DEFAULT '{}',          -- sheet value -> stage key | __hold | __ignore
  "sizeUnit"    double precision NOT NULL DEFAULT 1,  -- multiplier for plain deal-size numbers
  "frequency"   text NOT NULL DEFAULT 'weekly',      -- manual | immediate | daily | weekly | monthly
  "hookToken"   text NOT NULL,
  "snapshot"    text,                                -- sheet values at the last review, by row key
  "lastRunAt"   text,
  "lastStatus"  text,
  "lastError"   text,
  "createdBy"   text,
  "createdAt"   text NOT NULL,
  "updatedAt"   text NOT NULL
);

CREATE TABLE IF NOT EXISTS "SheetSyncRun" (
  "id"           text PRIMARY KEY,
  "syncId"       text NOT NULL REFERENCES "SheetSync"("id") ON DELETE CASCADE,
  "trigger"      text NOT NULL,                      -- manual | cron | hook
  "status"       text NOT NULL,                      -- pending_review | no_changes | applied | dismissed | superseded | error
  "rowCount"     integer NOT NULL DEFAULT 0,
  "changes"      text NOT NULL DEFAULT '[]',
  "snapshot"     text,
  "error"        text,
  "appliedCount" integer,
  "resolvedBy"   text,
  "resolvedAt"   text,
  "createdAt"    text NOT NULL
);
CREATE INDEX IF NOT EXISTS "SheetSyncRun_syncId_idx" ON "SheetSyncRun" ("syncId", "createdAt");

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "sheetKey" text;

ALTER TABLE "SheetSync" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SheetSyncRun" ENABLE ROW LEVEL SECURITY;
