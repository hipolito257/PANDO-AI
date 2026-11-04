import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, dealStages, deals } from "@/lib/db";
import { listStages } from "@/lib/deals";

// GET — the pipeline stages, in order
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await listStages());
}

// PUT [{ key, label, kind }] — admins replace the stage list (order = array order)
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Only admins can edit stages" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!Array.isArray(body) || !body.length) return NextResponse.json({ error: "Send the full list of stages" }, { status: 400 });
  const stages = body.map((s: { key?: string; label?: string; kind?: string }, i: number) => ({
    key: String(s.key || s.label || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40),
    label: String(s.label ?? "").trim().slice(0, 60),
    position: i + 1,
    kind: ["open", "won", "lost"].includes(String(s.kind)) ? String(s.kind) : "open",
  }));
  if (stages.some(s => !s.key || !s.label)) return NextResponse.json({ error: "Every stage needs a name" }, { status: 400 });
  if (new Set(stages.map(s => s.key)).size !== stages.length) return NextResponse.json({ error: "Stage names must be unique" }, { status: 400 });

  // A stage that deals are in can't be removed.
  const removed = (await listStages()).map(s => s.key).filter(k => !stages.some(s => s.key === k));
  if (removed.length) {
    const inUse = await db.select({ stage: deals.stage }).from(deals).where(inArray(deals.stage, removed)).limit(1);
    if (inUse.length) return NextResponse.json({ error: `Move the deals out of "${inUse[0].stage}" before removing it` }, { status: 409 });
  }

  await db.transaction(async tx => {
    await tx.delete(dealStages);
    await tx.insert(dealStages).values(stages);
  });
  return NextResponse.json(await listStages());
}
