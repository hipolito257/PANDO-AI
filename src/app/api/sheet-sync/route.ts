import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { db, sheetSyncs, sheetSyncRuns } from "@/lib/db";
import { listStages, nowIso } from "@/lib/deals";
import { SYNC_FIELDS, newHookToken, norm, parseSheetUrl, serviceAccountEmail, type ColumnMap, type StageMap } from "@/lib/sheetSync";

const FREQUENCIES = ["manual", "immediate", "daily", "weekly", "monthly"];

// GET — the sync connection, its recent runs and the reading waiting for review
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sync = (await db.select().from(sheetSyncs).orderBy(sheetSyncs.createdAt).limit(1))[0] ?? null;
  const runs = sync
    ? await db.select().from(sheetSyncRuns).where(eq(sheetSyncRuns.syncId, sync.id)).orderBy(desc(sheetSyncRuns.createdAt)).limit(20)
    : [];
  const pending = runs.find(r => r.status === "pending_review") ?? null;
  return NextResponse.json({
    sync: sync && {
      ...sync, snapshot: undefined,
      columnMap: JSON.parse(sync.columnMap || "{}") as ColumnMap,
      stageMap: JSON.parse(sync.stageMap || "{}") as StageMap,
    },
    runs: runs.map(r => ({ ...r, changes: undefined, snapshot: undefined, changeCount: (JSON.parse(r.changes || "[]") as { kind: string }[]).filter(c => c.kind === "update" || c.kind === "create").length })),
    pending: pending && { ...pending, snapshot: undefined, changes: JSON.parse(pending.changes || "[]") },
    stages: await listStages(),
    fields: SYNC_FIELDS,
    serviceAccount: serviceAccountEmail(),
  });
}

// POST — create or update the connection
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const ref = parseSheetUrl(String(b.sourceUrl ?? ""));
  if (!ref) return NextResponse.json({ error: "Paste the link of a Google Sheet or of an Excel file in Google Drive" }, { status: 400 });
  const columnMap: ColumnMap = {};
  for (const f of SYNC_FIELDS) if (typeof b.columnMap?.[f.key] === "string" && b.columnMap[f.key]) columnMap[f.key] = b.columnMap[f.key];
  if (!columnMap.company || !columnMap.stage) return NextResponse.json({ error: "Map at least the Company and Stage columns" }, { status: 400 });
  const stageKeys = new Set((await listStages()).map(s => s.key));
  const stageMap: StageMap = {};
  for (const [k, v] of Object.entries((b.stageMap ?? {}) as Record<string, unknown>)) {
    if (typeof v === "string" && (stageKeys.has(v) || v === "__hold" || v === "__ignore")) stageMap[norm(k)] = v;
  }
  const values = {
    name: String(b.name ?? "Deal pipeline").slice(0, 120) || "Deal pipeline",
    sourceUrl: String(b.sourceUrl).trim().slice(0, 1000),
    fileId: ref.fileId, fileKind: ref.kind,
    sheetName: typeof b.sheetName === "string" ? b.sheetName.slice(0, 200) : null,
    headerRow: Math.max(1, Math.min(50, Math.round(Number(b.headerRow) || 1))),
    columnMap: JSON.stringify(columnMap), stageMap: JSON.stringify(stageMap),
    sizeUnit: [1, 1e3, 1e6].includes(Number(b.sizeUnit)) ? Number(b.sizeUnit) : 1,
    frequency: FREQUENCIES.includes(b.frequency) ? b.frequency : "weekly",
    updatedAt: nowIso(),
  };
  const existing = (await db.select().from(sheetSyncs).limit(1))[0];
  if (existing) {
    // A different file starts from a clean baseline.
    const reset = existing.fileId !== ref.fileId || existing.sheetName !== values.sheetName ? { snapshot: null } : {};
    await db.update(sheetSyncs).set({ ...values, ...reset }).where(eq(sheetSyncs.id, existing.id));
    return NextResponse.json({ id: existing.id });
  }
  const id = randomUUID();
  await db.insert(sheetSyncs).values({ id, ...values, hookToken: newHookToken(), createdBy: session.user.id, createdAt: nowIso() });
  return NextResponse.json({ id }, { status: 201 });
}

// DELETE — disconnect the sheet (deals stay as they are)
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await db.delete(sheetSyncs);
  return NextResponse.json({ ok: true });
}
