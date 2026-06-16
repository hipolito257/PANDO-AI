import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// GET /api/user/api-key — get current user's API key
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await db.query.userSettings.findFirst({
    where: (s, { eq }) => eq(s.userId, session.user.id),
  });

  return NextResponse.json({
    userId: session.user.id,
    hasApiKey: !!settings?.anthropicApiKey,
    // Never return the actual key to frontend for security
    lastUpdated: settings?.updatedAt,
  });
}

// POST /api/user/api-key — save/update user's API key
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { apiKey } = await req.json() as { apiKey?: string };
  if (!apiKey?.trim()) {
    return NextResponse.json({ error: "apiKey es requerida" }, { status: 400 });
  }

  const trimmedKey = apiKey.trim();

  // Validate that it looks like a real Anthropic API key
  if (!trimmedKey.startsWith("sk-ant-")) {
    return NextResponse.json({ error: "API key inválida — debe comenzar con 'sk-ant-'" }, { status: 400 });
  }

  // Check if settings already exist
  const existing = await db.query.userSettings.findFirst({
    where: (s, { eq }) => eq(s.userId, session.user.id),
  });

  if (existing) {
    // Update
    await db.update(userSettings)
      .set({ anthropicApiKey: trimmedKey, updatedAt: new Date().toISOString() })
      .where((s) => eq(s.userId, session.user.id));
  } else {
    // Create
    await db.insert(userSettings).values({
      id: randomUUID(),
      userId: session.user.id,
      anthropicApiKey: trimmedKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return NextResponse.json({
    success: true,
    message: "API key guardada correctamente",
  });
}

// DELETE /api/user/api-key — remove user's API key
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await db.update(userSettings)
    .set({ anthropicApiKey: null, updatedAt: new Date().toISOString() })
    .where((s) => eq(s.userId, session.user.id));

  return NextResponse.json({ success: true });
}
