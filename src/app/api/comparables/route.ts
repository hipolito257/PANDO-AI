import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { compSets, publicComps } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { eq, inArray } from "drizzle-orm";

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// GET — all comp sets, each with resolved public comp data
// Optional ?companyId=X to filter by company
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId = req.nextUrl.searchParams.get("companyId");

  const sets = await db.query.compSets.findMany({
    with: { company: true },
    where: companyId ? eq(compSets.companyId, companyId) : undefined,
    orderBy: (c, { desc }) => [desc(c.createdAt)],
  });

  const allTickers = [...new Set(sets.flatMap(s => JSON.parse(s.tickers) as string[]))];
  const pubData = allTickers.length > 0
    ? await db.query.publicComps.findMany({ where: inArray(publicComps.ticker, allTickers) })
    : [];
  const pubMap = Object.fromEntries(pubData.map(p => [p.ticker, p]));

  const result = sets.map(s => ({
    ...s,
    comps: (JSON.parse(s.tickers) as string[]).map(t => pubMap[t]).filter(Boolean),
  }));

  return NextResponse.json(result);
}

// POST — create comp set
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name, companyId, tickers = [], notes, aiDescriptions } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const id = uid();
  await db.insert(compSets).values({
    id, name, companyId: companyId || null, tickers: JSON.stringify(tickers),
    notes: notes || null,
    aiDescriptions: aiDescriptions ? JSON.stringify(aiDescriptions) : null,
  });

  const set = await db.query.compSets.findFirst({ where: eq(compSets.id, id), with: { company: true } });
  return NextResponse.json(set, { status: 201 });
}

// PATCH — update comp set (add/remove tickers, rename)
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, name, companyId, tickers, notes, aiDescriptions } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (name           !== undefined) update.name           = name;
  if (companyId      !== undefined) update.companyId      = companyId;
  if (tickers        !== undefined) update.tickers        = JSON.stringify(tickers);
  if (notes          !== undefined) update.notes          = notes;
  if (aiDescriptions !== undefined) update.aiDescriptions = JSON.stringify(aiDescriptions);

  await db.update(compSets).set(update as any).where(eq(compSets.id, id));
  const set = await db.query.compSets.findFirst({ where: eq(compSets.id, id), with: { company: true } });
  return NextResponse.json(set);
}

// DELETE — remove comp set
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  await db.delete(compSets).where(eq(compSets.id, id));
  return NextResponse.json({ ok: true });
}
