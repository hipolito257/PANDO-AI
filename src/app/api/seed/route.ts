import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

// GET /api/seed — create initial admin user (only if no users exist)
export async function GET() {
  try {
    const existing = await db.query.users.findFirst({
      where: eq(users.email, "pablo.morincon@gmail.com"),
    });

    if (existing) {
      return NextResponse.json({ ok: true, message: "Usuario ya existe", email: existing.email });
    }

    const pw = await bcrypt.hash("pando2026", 10);
    await db.insert(users).values({
      id: randomUUID(),
      name: "Pablo Morincon",
      email: "pablo.morincon@gmail.com",
      password: pw,
      role: "admin",
    });

    return NextResponse.json({ ok: true, message: "Usuario creado", email: "pablo.morincon@gmail.com", password: "pando2026" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
