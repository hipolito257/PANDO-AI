import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { firmSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { FIRM_SETTINGS_ID } from "@/lib/firmThesis";
import { dbErrorMessage } from "@/lib/utils";

// GET /api/admin/cron-settings — any logged-in user can view whether the daily cron is enabled
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await db.query.firmSettings.findFirst({ where: eq(firmSettings.id, FIRM_SETTINGS_ID) }).catch(() => null);
  return NextResponse.json({ enabled: row?.cronEnabled ?? true });
}

// PATCH /api/admin/cron-settings — admin-only: turn the daily discovery cron on/off.
// The Vercel schedule keeps firing either way; this just tells the cron route to no-op.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const enabled = body?.enabled;
  if (typeof enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });

  try {
    await db
      .insert(firmSettings)
      .values({ id: FIRM_SETTINGS_ID, cronEnabled: enabled, updatedBy: session.user.id })
      .onConflictDoUpdate({
        target: firmSettings.id,
        set: { cronEnabled: enabled, updatedBy: session.user.id, updatedAt: new Date().toISOString() },
      });

    return NextResponse.json({ enabled });
  } catch (e) {
    console.error("[cron-settings PATCH]", e);
    return NextResponse.json({ error: dbErrorMessage(e) }, { status: 500 });
  }
}
