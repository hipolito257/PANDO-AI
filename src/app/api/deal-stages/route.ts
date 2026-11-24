import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, ne } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, dealStages, deals } from "@/lib/db";
import { listStages } from "@/lib/deals";
import { isPhase } from "@/lib/phases";

// GET ?phase= — the stages of a section's board (all of them without a phase), in order
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const phase = req.nextUrl.searchParams.get("phase");
  return NextResponse.json(await listStages(isPhase(phase) ? phase : undefined));
}

// PUT ?phase= [{ key, label, kind }] — admins replace one section's stage list (order = array order)
export async function PUT(req: NextRequest) {
  const phaseParam = req.nextUrl.searchParams.get("phase");
  const phase = isPhase(phaseParam) ? phaseParam : "sourcing";
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
    phase,
  }));
  if (stages.some(s => !s.key || !s.label)) return NextResponse.json({ error: "Every stage needs a name" }, { status: 400 });
  if (new Set(stages.map(s => s.key)).size !== stages.length) return NextResponse.json({ error: "Stage names must be unique" }, { status: 400 });

  // A stage that deals are in can't be removed.
  const others = await db.select({ key: dealStages.key }).from(dealStages).where(ne(dealStages.phase, phase));
  if (stages.some(s => others.some(o => o.key === s.key))) return NextResponse.json({ error: "That stage name is already used in another section" }, { status: 409 });
  const removed = (await listStages(phase)).map(s => s.key).filter(k => !stages.some(s => s.key === k));
  if (removed.length) {
    const inUse = await db.select({ stage: deals.stage }).from(deals).where(inArray(deals.stage, removed)).limit(1);
    if (inUse.length) return NextResponse.json({ error: `Move the deals out of "${inUse[0].stage}" before removing it` }, { status: 409 });
  }

  await db.transaction(async tx => {
    await tx.delete(dealStages).where(eq(dealStages.phase, phase));
    await tx.insert(dealStages).values(stages);
  });
  return NextResponse.json(await listStages(phase));
}
