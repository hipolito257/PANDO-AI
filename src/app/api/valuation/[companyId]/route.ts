import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { db, companies, compSets, deals } from "@/lib/db";
import { loadValuation } from "@/lib/valuationData";

// GET — the company's valuation workspace: football-field config, comps, LBO models, deals.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { companyId } = await params;
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
    columns: { id: true, name: true, revenueUsd: true, ebitdaUsd: true, revenueGrowth: true, ebitdaMargin: true, sector: true, country: true },
  });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  try {
    let v = await loadValuation(companyId);
    if (!v.set) {
      // The football field is saved on the company's comp set; start an empty one.
      await db.insert(compSets).values({ id: randomUUID(), name: `${company.name} comps`, companyId, tickers: "[]" });
      v = await loadValuation(companyId);
    }
    const companyDeals = await db.query.deals.findMany({ where: eq(deals.companyId, companyId), columns: { id: true, codeName: true, stage: true } });
    return NextResponse.json({
      company, compSetId: v.set?.id ?? null, valuation: v.set?.valuation ?? null, comps: v.comps, lbos: v.lbos, deals: companyDeals,
    });
  } catch (err) {
    console.error("[valuation GET]", err);
    return NextResponse.json({ error: "Failed to load the valuation" }, { status: 500 });
  }
}
