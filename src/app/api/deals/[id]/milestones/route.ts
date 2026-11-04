import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, deals, dealMilestones } from "@/lib/db";
import { logDeal, newId, nowIso } from "@/lib/deals";

type Params = { params: Promise<{ id: string }> };
const validDate = (d: unknown) => d === null || d === "" || (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));

// POST { label, date? }
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { label, date } = await req.json().catch(() => ({}));
  if (!String(label ?? "").trim()) return NextResponse.json({ error: "Label required" }, { status: 400 });
  if (date !== undefined && !validDate(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, id), columns: { id: true } });
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.insert(dealMilestones).values({ id: newId(), dealId: id, label: String(label).trim().slice(0, 120), date: date || null, done: false, createdAt: nowIso() });
  await db.update(deals).set({ updatedAt: nowIso() }).where(eq(deals.id, id));
  return NextResponse.json({ ok: true }, { status: 201 });
}

// PATCH { milestoneId, label?, date?, done? }
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const m = await db.query.dealMilestones.findFirst({ where: and(eq(dealMilestones.id, b.milestoneId ?? ""), eq(dealMilestones.dealId, id)), with: { deal: { columns: { codeName: true } } } });
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const set: Partial<typeof dealMilestones.$inferInsert> = {};
  if (typeof b.label === "string" && b.label.trim()) set.label = b.label.trim().slice(0, 120);
  if (b.date !== undefined) { if (!validDate(b.date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 }); set.date = b.date || null; }
  if (typeof b.done === "boolean") set.done = b.done;
  await db.update(dealMilestones).set(set).where(eq(dealMilestones.id, m.id));
  if (set.done && !m.done) await logDeal(session.user.id, session.user.name ?? "User", "deal_milestone_done", id, m.deal.codeName, m.label);
  return NextResponse.json({ ok: true });
}

// DELETE { milestoneId }
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { milestoneId } = await req.json().catch(() => ({}));
  await db.delete(dealMilestones).where(and(eq(dealMilestones.id, milestoneId ?? ""), eq(dealMilestones.dealId, id)));
  return NextResponse.json({ ok: true });
}
