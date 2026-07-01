import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const ALLOWED_DOMAIN = "@pando.mx";

// PATCH /api/user/account — change own email and/or password.
// Body: { currentPassword, newEmail?, newPassword? }
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { currentPassword, newEmail, newPassword } = await req.json() as {
    currentPassword?: string; newEmail?: string; newPassword?: string;
  };

  if (!currentPassword) {
    return NextResponse.json({ error: "Current password is required" }, { status: 400 });
  }
  if (!newEmail && !newPassword) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const validPassword = await bcrypt.compare(currentPassword, user.password);
  if (!validPassword) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const update: Partial<typeof users.$inferInsert> = { updatedAt: new Date().toISOString() };

  if (newEmail) {
    const trimmedEmail = newEmail.trim().toLowerCase();
    if (!trimmedEmail.endsWith(ALLOWED_DOMAIN)) {
      return NextResponse.json({ error: `Only ${ALLOWED_DOMAIN} email addresses are allowed` }, { status: 400 });
    }
    if (trimmedEmail !== user.email) {
      const existing = await db.query.users.findFirst({ where: eq(users.email, trimmedEmail) });
      if (existing) return NextResponse.json({ error: "That email is already in use" }, { status: 409 });
      update.email = trimmedEmail;
    }
  }

  if (newPassword) {
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
    }
    update.password = await bcrypt.hash(newPassword, 10);
  }

  await db.update(users).set(update).where(eq(users.id, user.id));

  return NextResponse.json({ success: true, email: update.email ?? user.email });
}
