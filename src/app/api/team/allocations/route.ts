import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, deals, dealMembers } from "@/lib/db";
import { logDeal, nowIso } from "@/lib/deals";
import { isSheetAutoMembership } from "@/lib/teamAllocations";

// POST { action: "remove_sheet", userId? } — take someone off every deal the
// Google Sheet sync put them on automatically (yourself, or anyone for admins).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (b.action !== "remove_sheet") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const userId = typeof b.userId === "string" && b.userId ? b.userId : session.user.id;
  if (userId !== session.user.id && session.user.role !== "admin") return NextResponse.json({ error: "Only admins can change someone else's deals" }, { status: 403 });

  const memberships = await db.query.dealMembers.findMany({
    where: eq(dealMembers.userId, userId),
    with: { deal: { columns: { id: true, codeName: true, sheetKey: true, createdAt: true, createdBy: true, leadUserId: true } } },
  });
  const auto = memberships.filter(m => m.deal && isSheetAutoMembership(m, m.deal));
  if (!auto.length) return NextResponse.json({ removed: 0 });

  await db.delete(dealMembers).where(inArray(dealMembers.id, auto.map(m => m.id)));
  const leadOf = auto.filter(m => m.deal.leadUserId === userId).map(m => m.deal.id);
  if (leadOf.length) {
    await db.update(deals).set({ leadUserId: null, updatedAt: nowIso() }).where(and(inArray(deals.id, leadOf), eq(deals.leadUserId, userId)));
  }
  const who = session.user.name ?? "User";
  for (const m of auto) await logDeal(session.user.id, who, "deal_member_removed", m.deal.id, m.deal.codeName, "added automatically by the Google Sheet sync");
  return NextResponse.json({ removed: auto.length });
}
