import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, userSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

const ALLOWED_DOMAIN = "@pando.mx";

// POST /api/auth/register — public self-signup, restricted to @pando.mx emails
export async function POST(req: NextRequest) {
  const { name, email, password } = await req.json() as {
    name?: string; email?: string; password?: string;
  };

  const trimmedName = name?.trim() ?? "";
  const trimmedEmail = email?.trim().toLowerCase() ?? "";

  if (!trimmedName || !trimmedEmail || !password) {
    return NextResponse.json({ error: "Name, email, and password are required" }, { status: 400 });
  }
  if (!trimmedEmail.endsWith(ALLOWED_DOMAIN)) {
    return NextResponse.json({ error: `Only ${ALLOWED_DOMAIN} email addresses can join` }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const existing = await db.query.users.findFirst({ where: eq(users.email, trimmedEmail) });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const userId = randomUUID();
  const hashed = await bcrypt.hash(password, 10);

  await db.insert(users).values({
    id: userId,
    name: trimmedName,
    email: trimmedEmail,
    password: hashed,
    role: "analyst",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await db.insert(userSettings).values({
    id: randomUUID(),
    userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true });
}
