import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

// PATCH /api/admin/pending-users/[id] — admin-only. Body: { action: "approve" | "decline" }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { action } = await req.json() as { action?: string };
  if (action !== "approve" && action !== "decline") {
    return NextResponse.json({ error: "action must be 'approve' or 'decline'" }, { status: 400 });
  }

  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target || target.status !== "pending") {
    return NextResponse.json({ error: "No pending request found" }, { status: 404 });
  }

  if (action === "approve") {
    await db.update(users)
      .set({ status: "active", updatedAt: new Date().toISOString() })
      .where(eq(users.id, id));
  } else {
    await db.delete(users).where(eq(users.id, id));
  }

  return NextResponse.json({ success: true });
}
