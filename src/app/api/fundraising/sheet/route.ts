// The Google Sheet that feeds Fundraising.
// GET: connection + last result (+ the sheet's columns with ?columns=1)
// PUT { url, sheetName? }: connect / switch tab   PATCH { columnMap?, headerRow?, frequency? }: settings
// POST: sync now   DELETE: disconnect
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, investorSheetSyncs } from "@/lib/db";
import { serviceAccountEmail } from "@/lib/sheetSync";
import { INVESTOR_FIELDS, INVESTOR_SYNC_ID, connectInvestorSheet, investorSheetHeaders, runInvestorSync } from "@/lib/investorSheet";

export const maxDuration = 120;

async function current() {
  const [s] = await db.select().from(investorSheetSyncs).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID)).limit(1);
  if (!s) return null;
  const { snapshot: _s, ...rest } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...rest, columnMap: JSON.parse(s.columnMap || "{}"), lastSummary: s.lastSummary ? JSON.parse(s.lastSummary) : null };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sync = await current();
  let columns: unknown = null;
  if (sync && req.nextUrl.searchParams.get("columns")) {
    columns = await investorSheetHeaders().catch(e => ({ error: e instanceof Error ? e.message : "Could not read the sheet" }));
  }
  return NextResponse.json({
    sync, columns, serviceAccount: serviceAccountEmail(),
    fields: INVESTOR_FIELDS.map(f => ({ key: f.key, label: f.label, required: "required" in f })),
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (typeof b.url !== "string" || !b.url.trim()) return NextResponse.json({ error: "Paste the Google Sheet link" }, { status: 400 });
  try {
    const res = await connectInvestorSheet(b.url.trim(), session.user.id, typeof b.sheetName === "string" ? b.sheetName : null);
    return NextResponse.json({ ...res, sync: await current() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not open the sheet" }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const set: Partial<typeof investorSheetSyncs.$inferInsert> = {};
  if (b.columnMap && typeof b.columnMap === "object") {
    const keys = new Set<string>(INVESTOR_FIELDS.map(f => f.key));
    set.columnMap = JSON.stringify(Object.fromEntries(Object.entries(b.columnMap).filter(([k, v]) => keys.has(k) && typeof v === "string" && v)));
  }
  if (Number.isInteger(b.headerRow) && b.headerRow > 0 && b.headerRow < 50) set.headerRow = b.headerRow;
  if (b.frequency === "daily" || b.frequency === "manual") set.frequency = b.frequency;
  if (Object.keys(set).length) await db.update(investorSheetSyncs).set(set).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID));
  return NextResponse.json({ sync: await current() });
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const summary = await runInvestorSync("manual");
    return NextResponse.json({ summary, sync: await current() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "The sync failed", sync: await current() }, { status: 400 });
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await db.delete(investorSheetSyncs).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID));
  return NextResponse.json({ ok: true });
}
