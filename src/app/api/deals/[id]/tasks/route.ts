import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, deals, dealTasks } from "@/lib/db";
import { TASK_STATUSES, logDeal, newId, nowIso } from "@/lib/deals";

type Params = { params: Promise<{ id: string }> };
const validDate = (d: unknown) => d === null || d === "" || (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));

// POST { title, assigneeId?, dueDate? }
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { title, assigneeId, dueDate } = await req.json().catch(() => ({}));
  if (!String(title ?? "").trim()) return NextResponse.json({ error: "Title required" }, { status: 400 });
  if (dueDate !== undefined && !validDate(dueDate)) return NextResponse.json({ error: "dueDate must be YYYY-MM-DD" }, { status: 400 });
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, id), columns: { codeName: true } });
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.insert(dealTasks).values({
    id: newId(), dealId: id, title: String(title).trim().slice(0, 300), assigneeId: assigneeId || null,
    dueDate: dueDate || null, status: "todo", createdBy: session.user.id, createdAt: nowIso(),
  });
  await db.update(deals).set({ updatedAt: nowIso() }).where(eq(deals.id, id));
  return NextResponse.json({ ok: true }, { status: 201 });
}

// PATCH { taskId, title?, assigneeId?, dueDate?, status? }
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const task = await db.query.dealTasks.findFirst({ where: and(eq(dealTasks.id, b.taskId ?? ""), eq(dealTasks.dealId, id)), with: { deal: { columns: { codeName: true } } } });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const set: Partial<typeof dealTasks.$inferInsert> = {};
  if (typeof b.title === "string" && b.title.trim()) set.title = b.title.trim().slice(0, 300);
  if (b.assigneeId !== undefined) set.assigneeId = b.assigneeId || null;
  if (b.dueDate !== undefined) { if (!validDate(b.dueDate)) return NextResponse.json({ error: "dueDate must be YYYY-MM-DD" }, { status: 400 }); set.dueDate = b.dueDate || null; }
  if (b.status !== undefined) {
    if (!(TASK_STATUSES as readonly string[]).includes(b.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    set.status = b.status;
    set.completedAt = b.status === "done" ? nowIso() : null;
  }
  await db.update(dealTasks).set(set).where(eq(dealTasks.id, task.id));
  if (set.status === "done" && task.status !== "done") {
    await logDeal(session.user.id, session.user.name ?? "User", "deal_task_done", id, task.deal.codeName, task.title);
  }
  return NextResponse.json({ ok: true });
}

// DELETE { taskId }
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { taskId } = await req.json().catch(() => ({}));
  await db.delete(dealTasks).where(and(eq(dealTasks.id, taskId ?? ""), eq(dealTasks.dealId, id)));
  return NextResponse.json({ ok: true });
}
