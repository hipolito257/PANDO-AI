import { NextRequest, NextResponse } from "next/server";
import { db, users, availabilityUpdates, activityLog } from "@/lib/db";
import { auth } from "@/lib/auth";
import { AVAILABILITY_VALUES, levelInfo } from "@/lib/availability";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

function clean(v: unknown, max = 1000): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

// GET               → every active user with their latest update
// GET ?userId=…     → that user's last 20 updates (history)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const userId = req.nextUrl.searchParams.get("userId");
    if (userId) {
      const history = await db.query.availabilityUpdates.findMany({
        where: eq(availabilityUpdates.userId, userId),
        orderBy: [desc(availabilityUpdates.createdAt)],
        limit: 20,
      });
      return NextResponse.json(history);
    }

    const [members, latest] = await Promise.all([
      db.select({ id: users.id, name: users.name, email: users.email, role: users.role, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.status, "active")),
      db.selectDistinctOn([availabilityUpdates.userId])
        .from(availabilityUpdates)
        .orderBy(availabilityUpdates.userId, desc(availabilityUpdates.createdAt)),
    ]);

    const byUser = new Map(latest.map(u => [u.userId, u]));
    const result = members
      .map(m => ({ ...m, current: byUser.get(m.id) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json(result);
  } catch (err) {
    console.error("[team availability GET]", err);
    return NextResponse.json({ error: "Failed to load team availability" }, { status: 500 });
  }
}

// POST → record a new availability update. Members update themselves; admins can update anyone.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const targetId = typeof body.userId === "string" && body.userId ? body.userId : session.user.id;
  if (targetId !== session.user.id && session.user.role !== "admin") {
    return NextResponse.json({ error: "You can only update your own availability" }, { status: 403 });
  }
  if (!AVAILABILITY_VALUES.includes(body.level)) {
    return NextResponse.json({ error: "Invalid availability level" }, { status: 400 });
  }
  const availableFrom = clean(body.availableFrom, 10);
  if (availableFrom && !/^\d{4}-\d{2}-\d{2}$/.test(availableFrom)) {
    return NextResponse.json({ error: "availableFrom must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const target = await db.query.users.findFirst({ where: eq(users.id, targetId) });
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const row = {
      id:            randomUUID(),
      userId:        targetId,
      level:         body.level as string,
      comment:       clean(body.comment),
      currentWork:   clean(body.currentWork, 300),
      availableFrom,
      interests:     clean(body.interests, 300),
      createdBy:     session.user.id,
      createdAt:     new Date().toISOString(),
    };
    await db.insert(availabilityUpdates).values(row);

    try {
      await db.insert(activityLog).values({
        id: randomUUID(),
        userId: session.user.id,
        userName: session.user.name ?? "Team member",
        action: "updated_availability",
        entityType: "user",
        entityId: targetId,
        entityName: target.name,
        detail: levelInfo(row.level)?.label ?? row.level,
      });
    } catch { /* non-blocking */ }

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    console.error("[team availability POST]", err);
    return NextResponse.json({ error: "Failed to save availability" }, { status: 500 });
  }
}
