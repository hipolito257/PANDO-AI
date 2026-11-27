// The workbook that feeds Fundraising.
// GET: connection, how it's read, last result (+ each tab's titles with ?columns=1)
// PUT { url }: connect, work out how to read it, sync   PATCH { plan? , frequency? }: adjustments
// POST { replan? }: sync now (replan: read the layout again with AI)   DELETE: disconnect
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, investorSheetSyncs, userSettings } from "@/lib/db";
import { serviceAccountEmail } from "@/lib/sheetSync";
import { INVESTOR_FIELDS, INVESTOR_SYNC_ID, connectInvestorSheet, investorSheetTabs, runInvestorSync, saveInvestorPlan } from "@/lib/investorSheet";
import { INVESTOR_STAGES, INVESTOR_TYPES } from "@/lib/fundraising";

export const maxDuration = 300;

async function current() {
  const [s] = await db.select().from(investorSheetSyncs).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID)).limit(1);
  if (!s) return null;
  const { snapshot: _s, columnMap: _c, ...rest } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
  return {
    ...rest,
    plan: s.plan ? JSON.parse(s.plan) : null,
    valueMap: s.valueMap ? JSON.parse(s.valueMap) : null,
    lastSummary: s.lastSummary ? JSON.parse(s.lastSummary) : null,
  };
}
async function userKey(userId: string) {
  const setting = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  return setting?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sync = await current();
  let tabs: unknown = null;
  if (sync && req.nextUrl.searchParams.get("columns")) {
    tabs = await investorSheetTabs().catch(e => ({ error: e instanceof Error ? e.message : "Could not read the file" }));
  }
  return NextResponse.json({
    sync, tabs, serviceAccount: serviceAccountEmail(),
    fields: INVESTOR_FIELDS.map(f => ({ key: f.key, label: f.label })),
    types: INVESTOR_TYPES.map(t => ({ key: t.key, label: t.label })),
    stages: INVESTOR_STAGES.map(s => ({ key: s.key, label: s.label })),
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (typeof b.url !== "string" || !b.url.trim()) return NextResponse.json({ error: "Paste the Google Sheet link" }, { status: 400 });
  try {
    const summary = await connectInvestorSheet(b.url.trim(), session.user.id, await userKey(session.user.id));
    return NextResponse.json({ summary, sync: await current() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not open the sheet", sync: await current() }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  try {
    if (b.plan && typeof b.plan === "object") await saveInvestorPlan(b.plan);
    if (b.frequency === "daily" || b.frequency === "manual") {
      await db.update(investorSheetSyncs).set({ frequency: b.frequency }).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID));
    }
    return NextResponse.json({ sync: await current() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  try {
    const summary = await runInvestorSync("manual", await userKey(session.user.id), { replan: b.replan === true });
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
