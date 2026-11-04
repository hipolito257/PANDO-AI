import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, deals, dealMembers, users } from "@/lib/db";
import { DEAL_ROLES, logDeal, newId, nowIso } from "@/lib/deals";

type Params = { params: Promise<{ id: string }> };
const validRole = (r: unknown) => DEAL_ROLES.some(x => x.value === r);
const clampAlloc = (a: unknown) => Math.max(0, Math.min(100, Math.round(Number(a) || 0)));

// POST { userId, role, allocation } — add someone to the deal team
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { userId, role = "analyst", allocation = 25 } = await req.json().catch(() => ({}));
  const [deal, user] = await Promise.all([
    db.query.deals.findFirst({ where: eq(deals.id, id), columns: { id: true, codeName: true } }),
    db.query.users.findFirst({ where: eq(users.id, userId ?? ""), columns: { id: true, name: true } }),
  ]);
  if (!deal || !user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!validRole(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  const exists = await db.query.dealMembers.findFirst({ where: and(eq(dealMembers.dealId, id), eq(dealMembers.userId, user.id)) });
  if (exists) return NextResponse.json({ error: `${user.name} is already on the team` }, { status: 409 });
  await db.insert(dealMembers).values({ id: newId(), dealId: id, userId: user.id, role, allocation: clampAlloc(allocation), createdAt: nowIso() });
  await db.update(deals).set({ updatedAt: nowIso() }).where(eq(deals.id, id));
  await logDeal(session.user.id, session.user.name ?? "User", "deal_member_added", id, deal.codeName, user.name);
  return NextResponse.json({ ok: true }, { status: 201 });
}

// PATCH { memberId, role?, allocation? }
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { memberId, role, allocation } = await req.json().catch(() => ({}));
  const set: Partial<typeof dealMembers.$inferInsert> = {};
  if (role !== undefined) { if (!validRole(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 }); set.role = role; }
  if (allocation !== undefined) set.allocation = clampAlloc(allocation);
  if (!Object.keys(set).length) return NextResponse.json({ ok: true });
  await db.update(dealMembers).set(set).where(and(eq(dealMembers.id, memberId ?? ""), eq(dealMembers.dealId, id)));
  return NextResponse.json({ ok: true });
}

// DELETE { memberId }
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { memberId } = await req.json().catch(() => ({}));
  const m = await db.query.dealMembers.findFirst({
    where: and(eq(dealMembers.id, memberId ?? ""), eq(dealMembers.dealId, id)),
    with: { user: { columns: { name: true } }, deal: { columns: { codeName: true } } },
  });
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.delete(dealMembers).where(eq(dealMembers.id, m.id));
  await logDeal(session.user.id, session.user.name ?? "User", "deal_member_removed", id, m.deal.codeName, m.user.name);
  return NextResponse.json({ ok: true });
}
