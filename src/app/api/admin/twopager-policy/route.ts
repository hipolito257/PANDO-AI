import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { firmSettings } from "@/lib/schema";
import { FIRM_SETTINGS_ID } from "@/lib/firmThesis";
import { getTwoPagerPolicy } from "@/lib/twoPagerPolicy";

// GET /api/admin/twopager-policy — any logged-in user can view the 2-pager policy
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const policy = await getTwoPagerPolicy();
  return NextResponse.json({ policy });
}

// PATCH /api/admin/twopager-policy — admin-only edit of the 2-pager policy text
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const policy = typeof body?.policy === "string" ? body.policy.trim() : "";
  if (!policy) return NextResponse.json({ error: "Policy text is required" }, { status: 400 });

  await db
    .insert(firmSettings)
    .values({ id: FIRM_SETTINGS_ID, twoPagerPolicy: policy, updatedBy: session.user.id })
    .onConflictDoUpdate({
      target: firmSettings.id,
      set: { twoPagerPolicy: policy, updatedBy: session.user.id, updatedAt: new Date().toISOString() },
    });

  return NextResponse.json({ policy });
}
