import { db } from "@/lib/db";
import { irlSectionsConfig } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const IRL_SECTIONS_ID = "default";

export interface IrlSection {
  id: string;
  title: string;
  guidance: string;
}

export const DEFAULT_IRL_SECTIONS: IrlSection[] = [
  { id: "recommendation",  title: "Investment Recommendation",       guidance: "One clear recommendation (proceed / proceed with conditions / pass) and the 2-3 sentence case for it." },
  { id: "transaction_overview", title: "Transaction Overview",       guidance: "Deal type, proposed structure, entry valuation/multiple, sponsor role, and timeline." },
  { id: "business_overview", title: "Business Overview",             guidance: "What the company does, business model, history, and key operating metrics." },
  { id: "market_position",  title: "Market & Competitive Position",  guidance: "Market size and growth, competitive landscape, and the company's differentiation and moat." },
  { id: "financial_analysis", title: "Financial Analysis & Diligence Findings", guidance: "Revenue, growth, margins, cash conversion, and any findings from financial diligence, with real figures." },
  { id: "risks_mitigants",  title: "Key Risks & Mitigants",          guidance: "The most material risks identified in diligence and how each is mitigated, structured for, or priced into the terms." },
  { id: "legal_regulatory_esg", title: "Legal, Regulatory & ESG Considerations", guidance: "Material legal/regulatory exposure, litigation, compliance, and ESG findings from diligence." },
  { id: "terms_structure",  title: "Deal Terms & Structure",         guidance: "Proposed instrument, governance rights, protective provisions, and use of proceeds." },
  { id: "next_steps",       title: "Next Steps",                     guidance: "Outstanding diligence items, approvals needed, and the path to closing." },
];

export async function getIrlSections(): Promise<IrlSection[]> {
  const row = await db.query.irlSectionsConfig.findFirst({ where: eq(irlSectionsConfig.id, IRL_SECTIONS_ID) }).catch(() => null);
  if (!row?.sections) return DEFAULT_IRL_SECTIONS;
  try {
    const parsed = JSON.parse(row.sections);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* fall through to default */ }
  return DEFAULT_IRL_SECTIONS;
}
