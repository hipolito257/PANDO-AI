import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { db, investors, investorContacts, investorSheetSyncs, users, firmSettings } from "@/lib/db";
import { cleanInvestor, num } from "@/lib/investorClean";
import { FIRM_SETTINGS_ID } from "@/lib/firmThesis";

const now = () => new Date().toISOString();
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const clean = cleanInvestor;

// GET — every investor, the team (for owners) and the fund target
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [rows, team, settings, contacts, sheet] = await Promise.all([
    db.select().from(investors).orderBy(asc(investors.name)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.status, "active")),
    db.select({ fundTarget: firmSettings.fundTarget, fundCurrency: firmSettings.fundCurrency, fundName: firmSettings.fundName })
      .from(firmSettings).where(eq(firmSettings.id, FIRM_SETTINGS_ID)).limit(1),
    db.select().from(investorContacts).orderBy(asc(investorContacts.name)),
    db.select({ lastRunAt: investorSheetSyncs.lastRunAt, lastStatus: investorSheetSyncs.lastStatus, frequency: investorSheetSyncs.frequency })
      .from(investorSheetSyncs).limit(1).catch(() => []),
  ]);
  const names = new Map(team.map(u => [u.id, u]));
  const byInvestor = new Map<string, typeof contacts>();
  for (const c of contacts) byInvestor.set(c.investorId, [...(byInvestor.get(c.investorId) ?? []), c]);
  return NextResponse.json({
    investors: rows.map(({ research: _r, ...r }) => { // eslint-disable-line @typescript-eslint/no-unused-vars
      const cs = (byInvestor.get(r.id) ?? []).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
      return { ...r, owner: r.ownerId ? names.get(r.ownerId) ?? null : null, contacts: cs,
        contactName: cs[0]?.name ?? r.contactName, contactRole: cs[0]?.role ?? r.contactRole };
    }),
    sheet: sheet[0] ?? null,
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
  if (values.contactName) {
    await db.insert(investorContacts).values({ id: randomUUID(), investorId: id, name: values.contactName, role: values.contactRole ?? null,
      isPrimary: true, source: "manual", createdAt: t, updatedAt: t });
  }
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
