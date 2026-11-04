import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, jobs } from "@/lib/db";

// POST — cancel a queued or running job; its handler stops at the next check.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await db.update(jobs)
    .set({ status: "cancelled", message: "Cancelled", finishedAt: new Date().toISOString() })
    .where(and(eq(jobs.id, id), eq(jobs.userId, session.user.id), inArray(jobs.status, ["queued", "running"])));
  return NextResponse.json({ ok: true });
}
