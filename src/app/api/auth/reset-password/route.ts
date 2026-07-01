import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, passwordResetTokens } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";

// POST /api/auth/reset-password — public. Body: { token, password }
export async function POST(req: NextRequest) {
  const { token, password } = await req.json() as { token?: string; password?: string };
  if (!token || !password) {
    return NextResponse.json({ error: "Token and new password are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const record = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.tokenHash, tokenHash),
  });

  if (!record || record.usedAt || new Date(record.expiresAt) < new Date()) {
    return NextResponse.json({ error: "This reset link is invalid or has expired" }, { status: 400 });
  }

  const hashed = await bcrypt.hash(password, 10);
  await db.update(users)
    .set({ password: hashed, updatedAt: new Date().toISOString() })
    .where(eq(users.id, record.userId));

  await db.update(passwordResetTokens)
    .set({ usedAt: new Date().toISOString() })
    .where(eq(passwordResetTokens.id, record.id));

  return NextResponse.json({ success: true });
}
