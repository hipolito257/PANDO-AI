import { NextRequest, NextResponse } from "next/server";
import { db, userSettings } from "@/lib/db";
import { auth } from "@/lib/auth";
import { syncCompanyDocumentComps } from "@/lib/companyDocComps";
import { eq } from "drizzle-orm";

// Documents never checked for comparables are extracted here (a long deck takes 1–3 min).
export const maxDuration = 300;

// POST { companyId, force? } — add the listed comparables named in the company's
// documents to its comp set. Each document is processed once.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { companyId, force } = await req.json().catch(() => ({}));
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  const setting = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, session.user.id) });
  const apiKey = setting?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? null;

  try {
    return NextResponse.json(await syncCompanyDocumentComps(companyId, apiKey, { force: !!force }));
  } catch (err) {
    console.error("[comparables/from-documents]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to import comparables" }, { status: 500 });
  }
}
