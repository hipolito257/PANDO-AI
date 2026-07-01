import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

// POST /api/admin/users/[id]/reset-password — admin-only. Body: { newPassword }
// The admin sets a new password directly and relays it to the user out-of-band
// (no email service is used for this app).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { newPassword } = await req.json() as { newPassword?: string };
  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
  }

  const target = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const hashed = await bcrypt.hash(newPassword, 10);
  await db.update(users)
    .set({ password: hashed, updatedAt: new Date().toISOString() })
    .where(eq(users.id, id));

  return NextResponse.json({ success: true });
}
