// Server-side loading of everything a company's valuation uses: its comp set
// (football-field config + comps), and the LBO models saved on it.
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, compSets, publicComps, financialModels } from "@/lib/db";
import { footballFieldSpec, parseValuation, valuationText, type LboModelRef, type ValComp } from "@/lib/valuation";

export async function loadValuation(companyId: string) {
  const [set, models] = await Promise.all([
    db.query.compSets.findFirst({ where: eq(compSets.companyId, companyId), orderBy: [desc(compSets.createdAt)] }),
    db.query.financialModels.findMany({
      where: and(eq(financialModels.companyId, companyId), eq(financialModels.modelType, "lbo"), eq(financialModels.status, "built")),
      orderBy: [desc(financialModels.createdAt)],
    }),
  ]);
  let comps: ValComp[] = [];
  let tickers: string[] = [];
  try { tickers = set?.tickers ? JSON.parse(set.tickers) : []; } catch { tickers = []; }
  if (tickers.length) {
    comps = await db.select({
      ticker: publicComps.ticker, name: publicComps.name, evEbitda: publicComps.evEbitda, evRevenue: publicComps.evRevenue,
      lastRefreshed: publicComps.lastRefreshed,
    }).from(publicComps).where(inArray(publicComps.ticker, tickers));
  }
  const lbos: (LboModelRef & { updatedAt: string | null; createdAt: string | null })[] = models.flatMap(m => {
    try { return [{ id: m.id, name: m.name, assumptions: JSON.parse(m.assumptions), updatedAt: m.updatedAt, createdAt: m.createdAt }]; } catch { return []; }
  });
  return { set: set ?? null, config: parseValuation(set?.valuation), comps, lbos };
}

/** Valuation summary as text for AI context ("" when nothing is set up). */
export async function companyValuationText(companyId: string | null): Promise<string> {
  if (!companyId) return "";
  try {
    const v = await loadValuation(companyId);
    if (!v.config) return "";
    const text = valuationText(v.config, v.comps, v.lbos);
    return text ? `VALUATION (from PANDO's valuation workspace: football field, comps and LBO):\n${text}` : "";
  } catch {
    return "";
  }
}

/** Valuation text plus a ready-made football-field chart spec, for deck generation. */
export async function deckValuationData(companyId: string | null): Promise<string> {
  if (!companyId) return "";
  try {
    const v = await loadValuation(companyId);
    if (!v.config) return "";
    const text = valuationText(v.config, v.comps, v.lbos);
    if (!text) return "";
    const spec = footballFieldSpec(v.config, v.comps, v.lbos);
    return `${text}\nIf the deck has a valuation slide, show this football field. When the template has no floating-range chart, draw it as an hbar_float element with exactly this spec_json: ${JSON.stringify(spec)}`;
  } catch {
    return "";
  }
}
