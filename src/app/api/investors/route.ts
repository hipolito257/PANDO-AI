import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { db, investors, users, firmSettings } from "@/lib/db";
import { INVESTOR_STAGES, INVESTOR_TYPES } from "@/lib/fundraising";
import { FIRM_SETTINGS_ID } from "@/lib/firmThesis";

const now = () => new Date().toISOString();
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s$]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function clean(b: Record<string, unknown>) {
  const out: Partial<typeof investors.$inferInsert> = {};
  if (b.name !== undefined) { const v = str(b.name, 160); if (v) out.name = v; }
  if (typeof b.type === "string" && INVESTOR_TYPES.some(t => t.key === b.type)) out.type = b.type;
  if (typeof b.stage === "string" && INVESTOR_STAGES.some(s => s.key === b.stage)) out.stage = b.stage;
  for (const [k, max] of [["country", 60], ["city", 80], ["website", 300], ["contactName", 120], ["contactRole", 120], ["nextStep", 300], ["notes", 4000]] as const) {
    if (b[k] !== undefined) out[k] = str(b[k], max);
  }
  if (b.nextStepDate !== undefined) out.nextStepDate = typeof b.nextStepDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.nextStepDate) ? b.nextStepDate : null;
  if (b.targetAmount !== undefined) out.targetAmount = num(b.targetAmount);
  if (b.committedAmount !== undefined) out.committedAmount = num(b.committedAmount);
  if (typeof b.currency === "string" && b.currency) out.currency = b.currency.slice(0, 5).toUpperCase();
  if (b.ownerId !== undefined) out.ownerId = typeof b.ownerId === "string" && b.ownerId ? b.ownerId : null;
  return out;
}

// GET — every investor, the team (for owners) and the fund target
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [rows, team, settings] = await Promise.all([
    db.select().from(investors).orderBy(asc(investors.name)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.status, "active")),
    db.select({ fundTarget: firmSettings.fundTarget, fundCurrency: firmSettings.fundCurrency, fundName: firmSettings.fundName })
      .from(firmSettings).where(eq(firmSettings.id, FIRM_SETTINGS_ID)).limit(1),
  ]);
  const names = new Map(team.map(u => [u.id, u]));
  return NextResponse.json({
    investors: rows.map(r => ({ ...r, owner: r.ownerId ? names.get(r.ownerId) ?? null : null })),
    team,
    fund: { target: settings[0]?.fundTarget ?? null, currency: settings[0]?.fundCurrency ?? "USD", name: settings[0]?.fundName ?? null },
  });
}

// POST — add an investor
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const values = clean(b);
  if (!values.name) return NextResponse.json({ error: "The investor needs a name" }, { status: 400 });
  const id = randomUUID();
  const t = now();
  await db.insert(investors).values({
    type: "family_office", stage: "identified", currency: "USD", ...values, name: values.name,
    id, ownerId: values.ownerId === undefined ? session.user.id : values.ownerId, stageChangedAt: t, createdBy: session.user.id, createdAt: t, updatedAt: t,
  });
  return NextResponse.json({ id }, { status: 201 });
}

// PATCH { id, ...fields } — edit an investor (also used when dragging it to another stage)
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (typeof b.id !== "string") return NextResponse.json({ error: "id required" }, { status: 400 });
  const [row] = await db.select({ stage: investors.stage }).from(investors).where(eq(investors.id, b.id)).limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const set = { ...clean(b), updatedAt: now() };
  if (set.stage && set.stage !== row.stage) set.stageChangedAt = now();
  await db.update(investors).set(set).where(eq(investors.id, b.id));
  return NextResponse.json({ ok: true });
}

// DELETE ?id= — remove an investor
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.delete(investors).where(eq(investors.id, id));
  return NextResponse.json({ ok: true });
}

// PUT { target, currency, name } — the fund's target size
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const values = {
    fundTarget: num(b.target), fundCurrency: typeof b.currency === "string" && b.currency ? b.currency.slice(0, 5).toUpperCase() : "USD",
    fundName: str(b.name, 120),
  };
  const [exists] = await db.select({ id: firmSettings.id }).from(firmSettings).where(eq(firmSettings.id, FIRM_SETTINGS_ID)).limit(1);
  if (exists) await db.update(firmSettings).set(values).where(eq(firmSettings.id, FIRM_SETTINGS_ID));
  else await db.insert(firmSettings).values({ id: FIRM_SETTINGS_ID, ...values });
  return NextResponse.json({ ok: true });
}
