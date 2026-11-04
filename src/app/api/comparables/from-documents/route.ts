import { NextRequest, NextResponse } from "next/server";
import { db, userSettings } from "@/lib/db";
import { auth } from "@/lib/auth";
import { syncCompanyDocumentComps } from "@/lib/companyDocComps";
import { eq } from "drizzle-orm";

export const maxDuration = 60;

// POST { companyId } — quick check: adds to the comp set the comparables of
// documents already analysed but not yet synced, and reports how many
// documents still need analysing (`pending`); those are analysed by the
// "sync_document_comps" background job.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { companyId } = await req.json().catch(() => ({}));
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  const setting = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, session.user.id) });
  const apiKey = setting?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? null;

  try {
    return NextResponse.json(await syncCompanyDocumentComps(companyId, apiKey, { maxExtractions: 0 }));
  } catch (err) {
    console.error("[comparables/from-documents]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to import comparables" }, { status: 500 });
  }
}
