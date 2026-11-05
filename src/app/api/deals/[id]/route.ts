import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { auth } from "@/lib/auth";
import {
  db, deals, dealMembers, companyFiles, compSets, publicComps, jobs, activityLog, availabilityUpdates, users,
} from "@/lib/db";
import { DEAL_TYPES, listStages, logDeal, newId, nowIso } from "@/lib/deals";
import { loadValuation } from "@/lib/valuationData";

type Params = { params: Promise<{ id: string }> };

// GET — everything the deal page shows
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const deal = await db.query.deals.findFirst({
      where: eq(deals.id, id),
      with: {
        company: true,
        lead: { columns: { id: true, name: true } },
        members: { with: { user: { columns: { id: true, name: true, email: true, role: true } } } },
        tasks: { with: { assignee: { columns: { id: true, name: true } } } },
        milestones: true,
      },
    });
    if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const companyId = deal.companyId;
    const memberIds = deal.members.map(m => m.userId);

    const [stages, files, set, deckJobs, activity, availability, allUsers] = await Promise.all([
      listStages(),
      db.query.companyFiles.findMany({
        where: eq(companyFiles.companyId, companyId), orderBy: [desc(companyFiles.createdAt)],
        columns: { id: true, filename: true, ext: true, sizeBytes: true, extractionStatus: true, uploadedByName: true, createdAt: true },
      }),
      db.query.compSets.findFirst({ where: eq(compSets.companyId, companyId), orderBy: [desc(compSets.createdAt)] }),
      db.query.jobs.findMany({
        where: and(eq(jobs.companyId, companyId), eq(jobs.type, "deck_build"), eq(jobs.status, "done")),
        orderBy: [desc(jobs.createdAt)], limit: 20,
        columns: { id: true, title: true, result: true, createdAt: true, userId: true },
      }),
      db.query.activityLog.findMany({
        where: or(and(eq(activityLog.entityType, "deal"), eq(activityLog.entityId, id)), eq(activityLog.entityId, companyId)),
        orderBy: [desc(activityLog.createdAt)], limit: 40,
      }),
      memberIds.length
        ? db.selectDistinctOn([availabilityUpdates.userId]).from(availabilityUpdates)
          .where(inArray(availabilityUpdates.userId, memberIds))
          .orderBy(availabilityUpdates.userId, desc(availabilityUpdates.createdAt))
        : Promise.resolve([]),
      db.select({ id: users.id, name: users.name }).from(users).where(eq(users.status, "active")),
    ]);

    let comps: unknown[] = [];
    if (set?.tickers) {
      const tickers: string[] = JSON.parse(set.tickers || "[]");
      if (tickers.length) {
        comps = await db.select({
          ticker: publicComps.ticker, name: publicComps.name, evEbitda: publicComps.evEbitda,
          evRevenue: publicComps.evRevenue, lastRefreshed: publicComps.lastRefreshed,
        }).from(publicComps).where(inArray(publicComps.ticker, tickers));
      }
    }
    const names = new Map(allUsers.map(u => [u.id, u.name]));
    const avail = new Map(availability.map(a => [a.userId, a]));

    return NextResponse.json({
      deal: {
        ...deal,
        members: deal.members.map(m => ({ ...m, availability: avail.get(m.userId) ?? null })),
      },
      stages,
      users: allUsers,
      files,
      valuation: { compSetId: set?.id ?? null, config: set?.valuation ?? null, comps, lbos: (await loadValuation(deal.companyId).catch(() => null))?.lbos ?? [] },
      decks: deckJobs.map(j => {
        const r = j.result ? JSON.parse(j.result) as { filename?: string; slideCount?: number } : {};
        return { id: j.id, title: j.title, filename: r.filename ?? "presentation.pptx", slideCount: r.slideCount ?? null, createdAt: j.createdAt, by: names.get(j.userId) ?? "" };
      }),
      activity,
    });
  } catch (err) {
    console.error("[deal GET]", err);
    return NextResponse.json({ error: "Failed to load the deal" }, { status: 500 });
  }
}

// PATCH — edit the deal's fields (stage changes are logged)
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, id) });
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const set: Partial<typeof deals.$inferInsert> = { updatedAt: nowIso() };
  if (typeof b.codeName === "string" && b.codeName.trim()) set.codeName = b.codeName.trim().slice(0, 120);
  if (typeof b.type === "string" && DEAL_TYPES.some(t => t.value === b.type)) set.type = b.type;
  if (typeof b.onHold === "boolean") set.onHold = b.onHold;
  if (b.statusNote !== undefined) set.statusNote = b.statusNote ? String(b.statusNote).slice(0, 1000) : null;
  if (b.description !== undefined) set.description = b.description ? String(b.description).slice(0, 4000) : null;
  if (b.dealSize !== undefined) set.dealSize = typeof b.dealSize === "number" && Number.isFinite(b.dealSize) ? b.dealSize : null;
  if (typeof b.currency === "string" && b.currency) set.currency = b.currency.slice(0, 5);
  if (b.leadUserId !== undefined) set.leadUserId = b.leadUserId || null;

  let stageLabel: string | null = null;
  if (typeof b.stage === "string" && b.stage !== deal.stage) {
    const stage = (await listStages()).find(s => s.key === b.stage);
    if (!stage) return NextResponse.json({ error: "Unknown stage" }, { status: 400 });
    set.stage = stage.key;
    set.stageChangedAt = nowIso();
    stageLabel = stage.label;
  }

  await db.update(deals).set(set).where(eq(deals.id, id));

  // A new lead joins the team as lead.
  if (set.leadUserId) {
    const existing = await db.query.dealMembers.findFirst({ where: and(eq(dealMembers.dealId, id), eq(dealMembers.userId, set.leadUserId)) });
    if (existing) await db.update(dealMembers).set({ role: "lead" }).where(eq(dealMembers.id, existing.id));
    else await db.insert(dealMembers).values({ id: newId(), dealId: id, userId: set.leadUserId, role: "lead", allocation: 40, createdAt: nowIso() });
  }

  const who = session.user.name ?? "User";
  if (stageLabel) await logDeal(session.user.id, who, "deal_stage_changed", id, set.codeName ?? deal.codeName, `moved the deal to ${stageLabel}`);
  if (typeof b.onHold === "boolean" && b.onHold !== deal.onHold) {
    await logDeal(session.user.id, who, b.onHold ? "deal_on_hold" : "deal_resumed", id, set.codeName ?? deal.codeName, set.statusNote ?? undefined);
  }
  return NextResponse.json({ ok: true });
}

// DELETE — remove the deal (team, tasks and milestones go with it)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, id), with: { company: { columns: { name: true } } } });
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.delete(deals).where(eq(deals.id, id));
  await logDeal(session.user.id, session.user.name ?? "User", "deleted_deal", id, deal.codeName, deal.company?.name);
  return NextResponse.json({ ok: true });
}
