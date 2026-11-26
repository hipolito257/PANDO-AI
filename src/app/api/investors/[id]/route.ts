// One investor: profile, people, AI research and score.
import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, investors, investorContacts, users } from "@/lib/db";
import { cleanInvestor } from "@/lib/investorClean";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [inv] = await db.select().from(investors).where(eq(investors.id, id)).limit(1);
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [contacts, team] = await Promise.all([
    db.select().from(investorContacts).where(eq(investorContacts.investorId, id)).orderBy(asc(investorContacts.name)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.status, "active")),
  ]);
  return NextResponse.json({
    investor: { ...inv, owner: team.find(u => u.id === inv.ownerId) ?? null },
    contacts: contacts.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
    team,
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [row] = await db.select({ stage: investors.stage }).from(investors).where(eq(investors.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const set = { ...cleanInvestor(b), updatedAt: new Date().toISOString() };
  if (set.stage && set.stage !== row.stage) set.stageChangedAt = set.updatedAt;
  await db.update(investors).set(set).where(eq(investors.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await db.delete(investors).where(eq(investors.id, id));
  return NextResponse.json({ ok: true });
}
