import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildLboWorkbook, LboAssumptions } from "@/lib/lboModelBuilder";
import { dbErrorMessage } from "@/lib/utils";

export const maxDuration = 60;

function validate(a: Partial<LboAssumptions>): string | null {
  if (!a || typeof a !== "object") return "Assumptions are required";
  const N = a.holdingPeriodYears;
  if (!N || !Number.isFinite(N) || N < 1 || N > 15) return "Holding period must be between 1 and 15 years";
  if (!a.entryMultiple || a.entryMultiple <= 0) return "Entry multiple must be greater than 0";
  if (!a.exitMultiple || a.exitMultiple <= 0) return "Exit multiple must be greater than 0";
  if (!a.entryEbitda || a.entryEbitda <= 0) return "Entry EBITDA must be greater than 0";
  if (!a.revenueYear0 || a.revenueYear0 <= 0) return "Year 0 revenue must be greater than 0";
  for (const [key, arr] of Object.entries({
    revenueGrowthPct: a.revenueGrowthPct, ebitdaMarginPct: a.ebitdaMarginPct,
    capexPctRevenue: a.capexPctRevenue, nwcPctRevenue: a.nwcPctRevenue, daPctRevenue: a.daPctRevenue,
  })) {
    if (!Array.isArray(arr) || arr.length !== N) return `${key} must have exactly ${N} entries (one per projected year)`;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await req.json().catch(() => null) as {
      approvedPlan?: Partial<LboAssumptions>;
      companyName?: string;
    } | null;

    const plan = body?.approvedPlan;
    if (!plan) return NextResponse.json({ error: "Approved assumptions are required" }, { status: 400 });

    const validationError = validate(plan);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const companyName = (body?.companyName || plan.companyName || "Company").trim();
    const entryMult = plan.entryMultiple as number;
    const exitMult = plan.exitMultiple as number;

    const assumptions: LboAssumptions = {
      companyName,
      currency: (plan.currency as LboAssumptions["currency"]) || "USD",
      transactionYear: plan.transactionYear || new Date().getFullYear(),
      entryEbitda: plan.entryEbitda as number,
      revenueYear0: plan.revenueYear0 as number,
      entryMultiple: entryMult,
      transactionFeesPct: plan.transactionFeesPct ?? 0.02,
      financingFeesPct: plan.financingFeesPct ?? 0.015,
      debtToEbitda: plan.debtToEbitda ?? 4,
      interestRatePct: plan.interestRatePct ?? 0.09,
      mandatoryAmortPct: plan.mandatoryAmortPct ?? 0.05,
      cashSweepPct: plan.cashSweepPct ?? 1.0,
      minCashBalance: plan.minCashBalance ?? 0,
      revenueGrowthPct: plan.revenueGrowthPct as number[],
      ebitdaMarginPct: plan.ebitdaMarginPct as number[],
      capexPctRevenue: plan.capexPctRevenue as number[],
      nwcPctRevenue: plan.nwcPctRevenue as number[],
      daPctRevenue: plan.daPctRevenue as number[],
      taxRatePct: plan.taxRatePct ?? 0.25,
      holdingPeriodYears: plan.holdingPeriodYears as number,
      exitMultiple: exitMult,
      // Computed here, not trusted to the AI — a clean deterministic spread around the chosen multiples.
      sensitivityEntryMultiples: [entryMult - 1, entryMult - 0.5, entryMult, entryMult + 0.5, entryMult + 1].map(v => Math.max(v, 0.5)),
      sensitivityExitMultiples: [exitMult - 1, exitMult - 0.5, exitMult, exitMult + 0.5, exitMult + 1].map(v => Math.max(v, 0.5)),
    };

    const buffer = await buildLboWorkbook(assumptions);

    const safeCompanyName = companyName.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, " ") || "Company";
    const filename = `${safeCompanyName} - LBO Model - ${new Date().toISOString().slice(0, 10)}.xlsx`;

    return NextResponse.json({
      success: true,
      file: buffer.toString("base64"),
      filename,
    });
  } catch (err) {
    console.error("[financial-models/lbo/build]", err);
    return NextResponse.json({ error: dbErrorMessage(err) }, { status: 500 });
  }
}
