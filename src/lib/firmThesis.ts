import { db } from "@/lib/db";
import { firmSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const FIRM_SETTINGS_ID = "default";

export const DEFAULT_INVESTMENT_THESIS = `Fund Overview
Pando is a Mexico-focused, sector-agnostic private equity growth fund. The Fund expects to make 5 to 10 investments during a five-year investment period, with individual investments representing between 5% and 20% of total Fund commitments. Pando typically targets a four to eight-year holding period, with an average target of approximately five years. Mexico must be the core geography for value creation.

What Pando Looks For
Pando invests in established companies with:
- A proven business model and demonstrated product-market fit
- Validated unit economics and sufficient financial visibility
- Predictable revenues and attractive long-term growth prospects
- Exposure to structural industry tailwinds
- Strong management teams with disciplined execution and capital allocation
- Opportunities where Pando can actively influence business performance and governance

Pando prioritizes companies with durable competitive advantages, which may include: scale economies, network effects, process power, switching costs, cornered resources, branding, and counter-positioning.

How Pando Underwrites Investments
1. Price Discipline — entry valuation must provide adequate downside protection and margin of safety (generally at least 20% for common equity without structural protections).
2. Asymmetric Structuring — protect invested capital while retaining upside, via common/preferred equity, convertibles, structured/high-yield debt, debt with warrants, tranched/milestone-based investments, or revenue/cash-flow-linked instruments.
3. Active Value Creation — Pando invests where it can materially influence outcomes: revenue growth and go-to-market execution, strategic/commercial relationships, capital allocation and financing, governance, financial reporting discipline, M&A and expansion. Pando generally seeks board representation, information rights, and customary approval/veto rights.
4. Anticipated Liquidity — a credible path to liquidity must exist from day one (strategic sale, secondary sale, management buyout, contractual liquidity rights, dividend/recap, or IPO), plus opportunities to generate distributions during the hold.

What Pando Generally Avoids
- Venture-stage businesses or companies dependent on continued external funding
- Businesses without proven product-market fit or sustainable unit economics
- Passive minority positions without meaningful governance rights
- Opportunities without a credible path to liquidity
- Industries in structural decline
- Companies with material and unmitigable customer, supplier, or channel concentration
- Businesses with significant public-sector dependency
- Highly regulated situations where regulation materially limits underwriting, governance, or exit visibility
- Companies with inadequate financial transparency or reporting
- Businesses with excessive leverage or limited downside protection
- Companies with unresolved legal, tax, labor, regulatory, or integrity concerns
- Standalone projects or infrastructure-style assets dependent on permitting or construction completion

In Summary
Pando invests in established, cash-generative companies operating in or expanding into Mexico, with durable competitive advantages, attractive growth prospects, and strong management teams. Each investment must combine disciplined entry valuation, appropriate downside protection, meaningful governance influence, active value creation potential, and a credible path to liquidity.`;

export async function getFirmThesis(): Promise<string> {
  const row = await db.query.firmSettings.findFirst({ where: eq(firmSettings.id, FIRM_SETTINGS_ID) }).catch(() => null);
  return row?.investmentThesis?.trim() || DEFAULT_INVESTMENT_THESIS;
}
