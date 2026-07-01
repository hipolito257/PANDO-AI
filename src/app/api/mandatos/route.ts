import { NextRequest, NextResponse } from "next/server";
import { db, mandates, mandateMatches, activityLog } from "@/lib/db";
import { auth } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";
import { randomUUID } from "crypto";

async function logActivity(userId: string, userName: string, action: string, entityId: string, entityName: string) {
  try {
    await db.insert(activityLog).values({ id: randomUUID(), userId, userName, action, entityType: "mandate", entityId, entityName });
  } catch { /* non-blocking */ }
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.query.mandates.findMany({
    with: { matches: true },
    orderBy: [asc(mandates.createdAt)],
  });

  const result = rows.map((m) => ({
    ...m,
    _count: { matches: m.matches.length },
    matches: m.matches.filter((x: any) => x.tier === "strong"),
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const userId   = session.user.id;
  const userName = session.user.name ?? session.user.email ?? "User";
  const id = randomUUID();

  await db.insert(mandates).values({
    id,
    name:        body.name,
    description: body.description || null,
    sectors:     JSON.stringify(body.sectors ?? []),
    countries:   JSON.stringify(body.countries ?? ["Mexico"]),
    stages:      JSON.stringify(body.stages ?? []),
    minRevenue:  body.minRevenue ? Number(body.minRevenue) : null,
    maxRevenue:  body.maxRevenue ? Number(body.maxRevenue) : null,
    thesis:      body.thesis || null,
    isActive:    body.isActive ?? true,
    createdBy:   userName,
    updatedBy:   userName,
  });

  await logActivity(userId, userName, "added_mandate", id, body.name);

  const mandate = await db.query.mandates.findFirst({ where: eq(mandates.id, id) });
  return NextResponse.json(mandate, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, ...data } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const userId   = session.user.id;
  const userName = session.user.name ?? session.user.email ?? "User";

  const updateData: Record<string, unknown> = { ...data, updatedBy: userName };
  if (data.sectors)   updateData.sectors   = JSON.stringify(data.sectors);
  if (data.countries) updateData.countries = JSON.stringify(data.countries);
  if (data.stages)    updateData.stages    = JSON.stringify(data.stages);

  await db.update(mandates).set(updateData as any).where(eq(mandates.id, id));
  const mandate = await db.query.mandates.findFirst({ where: eq(mandates.id, id) });

  await logActivity(userId, userName, "edited_mandate", id, mandate?.name ?? id);

  return NextResponse.json(mandate);
}
