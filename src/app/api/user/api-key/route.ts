import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// GET /api/user/api-key — get current user's API key
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });

  return NextResponse.json({
    userId,
    hasApiKey: !!settings?.anthropicApiKey,
    // Never return the actual key to frontend for security
    lastUpdated: settings?.updatedAt,
  });
}

// POST /api/user/api-key — save/update user's API key
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
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
    where: eq(userSettings.userId, userId),
  });

  if (existing) {
    // Update
    await db.update(userSettings)
      .set({ anthropicApiKey: trimmedKey, updatedAt: new Date().toISOString() })
      .where(eq(userSettings.userId, userId));
  } else {
    // Create
    await db.insert(userSettings).values({
      id: randomUUID(),
      userId,
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
export async function DELETE(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  await db.update(userSettings)
    .set({ anthropicApiKey: null, updatedAt: new Date().toISOString() })
    .where(eq(userSettings.userId, userId));

  return NextResponse.json({ success: true });
}
