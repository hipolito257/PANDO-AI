import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, deals, dealMembers, companies } from "@/lib/db";
import { DEAL_TYPES, listStages, logDeal, newId, nowIso } from "@/lib/deals";

// GET ?companyId= — deals with what the board needs (company, lead, team, task and milestone summary)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const companyId = req.nextUrl.searchParams.get("companyId");
  try {
    const [rows, stages] = await Promise.all([
      db.query.deals.findMany({
        where: companyId ? eq(deals.companyId, companyId) : undefined,
        with: {
          company: { columns: { id: true, name: true, slug: true, sector: true, country: true, website: true } },
          lead: { columns: { id: true, name: true } },
          members: { with: { user: { columns: { id: true, name: true } } } },
          tasks: { columns: { id: true, status: true, dueDate: true, assigneeId: true } },
          milestones: { columns: { id: true, label: true, date: true, done: true } },
        },
        orderBy: [desc(deals.updatedAt)],
      }),
      listStages(),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const result = rows.map(d => {
      const open = d.tasks.filter(t => t.status !== "done");
      const next = d.milestones.filter(m => !m.done && m.date).sort((a, b) => a.date!.localeCompare(b.date!))[0] ?? null;
      const { tasks: _t, milestones: _m, ...rest } = d; // eslint-disable-line @typescript-eslint/no-unused-vars
      return {
        ...rest,
        openTasks: open.length,
        overdueTasks: open.filter(t => t.dueDate && t.dueDate < today).length,
        nextMilestone: next,
      };
    });
    return NextResponse.json({ deals: result, stages });
  } catch (err) {
    console.error("[deals GET]", err);
    return NextResponse.json({ error: "Failed to load deals" }, { status: 500 });
  }
}

// POST — create a deal on a company; the lead joins its team
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { companyId, codeName, type = "buy_side", stage, leadUserId, dealSize, currency, description } = body;
  if (!companyId || !String(codeName ?? "").trim()) return NextResponse.json({ error: "Company and code name are required" }, { status: 400 });
  if (!DEAL_TYPES.some(t => t.value === type)) return NextResponse.json({ error: "Invalid deal type" }, { status: 400 });

  const company = await db.query.companies.findFirst({ where: eq(companies.id, companyId), columns: { id: true, name: true } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const stages = await listStages();
  const stageKey = stages.some(s => s.key === stage) ? stage : stages[0]?.key ?? "sourcing";

  const id = newId();
  const now = nowIso();
  const lead = leadUserId || session.user.id;
  await db.insert(deals).values({
    id, companyId, codeName: String(codeName).trim().slice(0, 120), type, stage: stageKey, stageChangedAt: now,
    leadUserId: lead, dealSize: typeof dealSize === "number" && Number.isFinite(dealSize) ? dealSize : null,
    currency: typeof currency === "string" && currency ? currency.slice(0, 5) : "USD",
    description: typeof description === "string" ? description.slice(0, 4000) : null,
    createdBy: session.user.id, createdAt: now, updatedAt: now,
  });
  await db.insert(dealMembers).values({ id: newId(), dealId: id, userId: lead, role: "lead", allocation: 40, createdAt: now });
  await logDeal(session.user.id, session.user.name ?? "User", "created_deal", id, String(codeName).trim(), company.name);
  return NextResponse.json({ id }, { status: 201 });
}
