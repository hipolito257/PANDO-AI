import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { irlSectionsConfig } from "@/lib/schema";
import { IRL_SECTIONS_ID, getIrlSections, IrlSection } from "@/lib/irlSections";
import { dbErrorMessage } from "@/lib/utils";

// GET /api/admin/irl-sections — any logged-in user can view the default outline
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sections = await getIrlSections();
  return NextResponse.json({ sections });
}

// PATCH /api/admin/irl-sections — admin-only edit of the default section outline
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const sections = body?.sections;
  if (
    !Array.isArray(sections) || sections.length === 0 ||
    !sections.every((s): s is IrlSection =>
      s && typeof s.id === "string" && typeof s.title === "string" && s.title.trim() && typeof s.guidance === "string")
  ) {
    return NextResponse.json({ error: "sections must be a non-empty array of { id, title, guidance }" }, { status: 400 });
  }

  try {
    await db
      .insert(irlSectionsConfig)
      .values({ id: IRL_SECTIONS_ID, sections: JSON.stringify(sections), updatedBy: session.user.id })
      .onConflictDoUpdate({
        target: irlSectionsConfig.id,
        set: { sections: JSON.stringify(sections), updatedBy: session.user.id, updatedAt: new Date().toISOString() },
      });
  } catch (e) {
    console.error("[irl-sections PATCH]", e);
    return NextResponse.json({ error: dbErrorMessage(e) }, { status: 500 });
  }

  return NextResponse.json({ sections });
}
