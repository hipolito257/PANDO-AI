import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { twoPagerSectionsConfig } from "@/lib/schema";
import { TWO_PAGER_SECTIONS_ID, getTwoPagerSections, TwoPagerSection } from "@/lib/twoPagerSections";

// GET /api/admin/twopager-sections — any logged-in user can view the default outline
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sections = await getTwoPagerSections();
  return NextResponse.json({ sections });
}

// PATCH /api/admin/twopager-sections — admin-only edit of the default section outline
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const sections = body?.sections;
  if (
    !Array.isArray(sections) || sections.length === 0 ||
    !sections.every((s): s is TwoPagerSection =>
      s && typeof s.id === "string" && typeof s.title === "string" && s.title.trim() && typeof s.guidance === "string")
  ) {
    return NextResponse.json({ error: "sections must be a non-empty array of { id, title, guidance }" }, { status: 400 });
  }

  await db
    .insert(twoPagerSectionsConfig)
    .values({ id: TWO_PAGER_SECTIONS_ID, sections: JSON.stringify(sections), updatedBy: session.user.id })
    .onConflictDoUpdate({
      target: twoPagerSectionsConfig.id,
      set: { sections: JSON.stringify(sections), updatedBy: session.user.id, updatedAt: new Date().toISOString() },
    });

  return NextResponse.json({ sections });
}
