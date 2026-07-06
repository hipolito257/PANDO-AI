import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { firmSettings } from "@/lib/schema";
import { FIRM_SETTINGS_ID } from "@/lib/firmThesis";
import { eq } from "drizzle-orm";

// GET /api/admin/twopager-template — any logged-in user can see which template is active
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await db.query.firmSettings.findFirst({ where: eq(firmSettings.id, FIRM_SETTINGS_ID) }).catch(() => null);
  return NextResponse.json({
    url: row?.twoPagerTemplateUrl ?? null,
    name: row?.twoPagerTemplateName ?? null,
  });
}

// PATCH /api/admin/twopager-template — admin-only: set or clear the reference template
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  try {
    await db
      .insert(firmSettings)
      .values({ id: FIRM_SETTINGS_ID, twoPagerTemplateUrl: url || null, twoPagerTemplateName: name || null, updatedBy: session.user.id })
      .onConflictDoUpdate({
        target: firmSettings.id,
        set: { twoPagerTemplateUrl: url || null, twoPagerTemplateName: name || null, updatedBy: session.user.id, updatedAt: new Date().toISOString() },
      });
  } catch (e) {
    console.error("[twopager-template PATCH]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Database error saving template" }, { status: 500 });
  }

  return NextResponse.json({ url: url || null, name: name || null });
}
