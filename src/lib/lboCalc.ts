// LBO math in code, mirroring the formulas of the Excel model built by
// lboModelBuilder.ts exactly (same simplifications), so the valuation
// workspace can show returns live and the football field can include an
// "LBO" bar. Safe to import on the client and the server.
import type { LboAssumptions } from "@/lib/lboModelBuilder";

export type LboInputs = Omit<LboAssumptions, "sensitivityEntryMultiples" | "sensitivityExitMultiples">;

export type LboYear = {
  year: number; revenue: number; ebitda: number; interest: number; netIncome: number;
  fcf: number; debtBegin: number; debtEnd: number; cash: number;
};

export type LboResult = {
  entryEv: number; initialDebt: number; equity: number; totalUses: number;
  exitEbitda: number; exitEv: number; exitNetDebt: number; exitEquity: number;
  moic: number | null; irr: number | null; years: LboYear[];
};

/** Fills the defaults the build route applies, and pads per-year arrays to the holding period. */
export function normalizeLbo(a: Partial<LboInputs>): LboInputs {
  const N = Math.max(1, Math.min(15, Math.round(a.holdingPeriodYears ?? 5)));
  const arr = (v: number[] | undefined, d: number) => Array.from({ length: N }, (_, i) => (Array.isArray(v) && Number.isFinite(v[i]) ? v[i] : Array.isArray(v) && v.length ? v[v.length - 1] : d));
  return {
    companyName: a.companyName ?? "Company",
    currency: a.currency ?? "USD",
    transactionYear: a.transactionYear ?? new Date().getFullYear(),
    entryEbitda: a.entryEbitda ?? 0,
    revenueYear0: a.revenueYear0 ?? 0,
    entryMultiple: a.entryMultiple ?? 8,
    transactionFeesPct: a.transactionFeesPct ?? 0.02,
    financingFeesPct: a.financingFeesPct ?? 0.015,
    debtToEbitda: a.debtToEbitda ?? 3,
    interestRatePct: a.interestRatePct ?? 0.1,
    mandatoryAmortPct: a.mandatoryAmortPct ?? 0.05,
    cashSweepPct: a.cashSweepPct ?? 1,
    minCashBalance: a.minCashBalance ?? 0,
    revenueGrowthPct: arr(a.revenueGrowthPct, 0.08),
    ebitdaMarginPct: arr(a.ebitdaMarginPct, a.revenueYear0 ? (a.entryEbitda ?? 0) / a.revenueYear0 : 0.2),
    capexPctRevenue: arr(a.capexPctRevenue, 0.03),
    nwcPctRevenue: arr(a.nwcPctRevenue, 0.1),
    daPctRevenue: arr(a.daPctRevenue, 0.03),
    taxRatePct: a.taxRatePct ?? 0.3,
    holdingPeriodYears: N,
    exitMultiple: a.exitMultiple ?? a.entryMultiple ?? 8,
  };
}

/** Operating years, debt paydown and exit — independent of the entry multiple. */
function operate(a: LboInputs) {
  const initialDebt = a.entryEbitda * a.debtToEbitda;
  let revenue = a.revenueYear0, debt = initialDebt, cash = a.minCashBalance, ebitda = a.entryEbitda;
  const years: LboYear[] = [];
  for (let n = 1; n <= a.holdingPeriodYears; n++) {
    const prevRevenue = revenue;
    revenue = prevRevenue * (1 + a.revenueGrowthPct[n - 1]);
    ebitda = revenue * a.ebitdaMarginPct[n - 1];
    const da = revenue * a.daPctRevenue[n - 1];
    const interest = debt * a.interestRatePct; // on the beginning balance (no circularity), as in the Excel
    const ebt = ebitda - da - interest;
    const netIncome = ebt - Math.max(ebt, 0) * a.taxRatePct;
    const capex = revenue * a.capexPctRevenue[n - 1];
    const dNwc = (revenue - prevRevenue) * a.nwcPctRevenue[n - 1];
    const cfads = netIncome + da - capex - dNwc;
    const mand = Math.min(debt, initialDebt * a.mandatoryAmortPct);
    const fcf = cfads - mand;
    const sweep = Math.min(Math.max(debt - mand, 0), Math.max(fcf, 0) * a.cashSweepPct);
    const debtBegin = debt;
    debt = debt - mand - sweep;
    cash = cash + fcf - sweep;
    years.push({ year: a.transactionYear + n, revenue, ebitda, interest, netIncome, fcf, debtBegin, debtEnd: debt, cash });
  }
  const exitEv = ebitda * a.exitMultiple;
  const exitNetDebt = debt - cash;
  return { initialDebt, years, exitEbitda: ebitda, exitEv, exitNetDebt, exitEquity: exitEv - exitNetDebt };
}

/** Sponsor equity for a given entry EV (uses = EV + transaction fees + financing fees; sources = debt + equity). */
const equityFor = (a: LboInputs, entryEv: number, initialDebt: number) =>
  entryEv + entryEv * a.transactionFeesPct + initialDebt * a.financingFeesPct - initialDebt;

export function runLbo(input: Partial<LboInputs>): LboResult {
  const a = normalizeLbo(input);
  const op = operate(a);
  const entryEv = a.entryEbitda * a.entryMultiple;
  const equity = equityFor(a, entryEv, op.initialDebt);
  const moic = equity > 0 ? op.exitEquity / equity : null;
  const irr = moic != null && moic > 0 ? Math.pow(moic, 1 / a.holdingPeriodYears) - 1 : null;
  return {
    entryEv, initialDebt: op.initialDebt, equity, totalUses: equity + op.initialDebt,
    exitEbitda: op.exitEbitda, exitEv: op.exitEv, exitNetDebt: op.exitNetDebt, exitEquity: op.exitEquity,
    moic, irr, years: op.years,
  };
}

/** Returns if we paid `entryEv` instead of the model's entry multiple. */
export function lboAtPrice(input: Partial<LboInputs>, entryEv: number) {
  const a = normalizeLbo(input);
  return runLbo({ ...a, entryMultiple: a.entryEbitda > 0 ? entryEv / a.entryEbitda : a.entryMultiple });
}

/** The most we could pay (enterprise value) and still earn `targetIrr`. */
export function maxEntryEvForIrr(input: Partial<LboInputs>, targetIrr: number): number | null {
  const a = normalizeLbo(input);
  const op = operate(a);
  if (op.exitEquity <= 0) return null;
  const equity = op.exitEquity / Math.pow(1 + targetIrr, a.holdingPeriodYears);
  const ev = (equity + op.initialDebt - op.initialDebt * a.financingFeesPct) / (1 + a.transactionFeesPct);
  return ev > 0 ? ev : null;
}

/** IRR grid by entry × exit multiple (same as the Excel's Sensitivity sheet). */
export function lboSensitivity(input: Partial<LboInputs>, entry: number[], exit: number[]): (number | null)[][] {
  const a = normalizeLbo(input);
  return entry.map(en => exit.map(ex => runLbo({ ...a, entryMultiple: en, exitMultiple: ex }).irr));
}
