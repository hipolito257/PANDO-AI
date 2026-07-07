import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { firmSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { FIRM_SETTINGS_ID, getFirmThesis } from "@/lib/firmThesis";
import { dbErrorMessage } from "@/lib/utils";

// GET /api/admin/firm-thesis — any logged-in user can view the firm's investment thesis
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const thesis = await getFirmThesis();
  return NextResponse.json({ thesis });
}

// PATCH /api/admin/firm-thesis — admin-only edit of the firm's investment thesis
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const thesis = typeof body?.thesis === "string" ? body.thesis.trim() : "";
  if (!thesis) return NextResponse.json({ error: "Thesis text is required" }, { status: 400 });

  try {
    await db
      .insert(firmSettings)
      .values({ id: FIRM_SETTINGS_ID, investmentThesis: thesis, updatedBy: session.user.id })
      .onConflictDoUpdate({
        target: firmSettings.id,
        set: { investmentThesis: thesis, updatedBy: session.user.id, updatedAt: new Date().toISOString() },
      });
  } catch (e) {
    console.error("[firm-thesis PATCH]", e);
    return NextResponse.json({ error: dbErrorMessage(e) }, { status: 500 });
  }

  return NextResponse.json({ thesis });
}
