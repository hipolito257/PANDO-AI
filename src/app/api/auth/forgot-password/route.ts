import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, passwordResetTokens } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { randomUUID, randomBytes, createHash } from "crypto";
import { sendPasswordResetEmail } from "@/lib/email";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// POST /api/auth/forgot-password — public. Always returns success to avoid
// leaking which emails have accounts.
export async function POST(req: NextRequest) {
  const { email } = await req.json() as { email?: string };
  const trimmedEmail = email?.trim().toLowerCase() ?? "";
  if (!trimmedEmail) return NextResponse.json({ error: "Email is required" }, { status: 400 });

  const user = await db.query.users.findFirst({ where: eq(users.email, trimmedEmail) });

  if (user) {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    await db.insert(passwordResetTokens).values({
      id: randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      createdAt: new Date().toISOString(),
    });

    const origin = req.nextUrl.origin;
    const resetUrl = `${origin}/reset-password?token=${rawToken}`;
    await sendPasswordResetEmail(trimmedEmail, resetUrl).catch(err =>
      console.error("[forgot-password] failed to send email:", err));
  }

  return NextResponse.json({ success: true });
}
