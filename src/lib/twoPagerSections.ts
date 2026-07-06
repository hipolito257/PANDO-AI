import { db } from "@/lib/db";
import { twoPagerSectionsConfig } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const TWO_PAGER_SECTIONS_ID = "default";

export interface TwoPagerSection {
  id: string;
  title: string;
  guidance: string;
}

export const DEFAULT_TWO_PAGER_SECTIONS: TwoPagerSection[] = [
  { id: "exec_summary",   title: "Executive Summary",              guidance: "2-3 sentence framing of the opportunity: what the company does, the ask, and the one-line thesis." },
  { id: "company_overview", title: "Company Overview",             guidance: "What the company does, sector, geography, stage, founding story, and key operating metrics." },
  { id: "market_opportunity", title: "Market Opportunity",          guidance: "Market size, growth, structural tailwinds, and why now." },
  { id: "investment_thesis", title: "Investment Thesis",           guidance: "Why PANDO, competitive advantages, and the value-creation plan." },
  { id: "financial_highlights", title: "Financial Highlights",     guidance: "Revenue, growth, margins, and any other headline financial metrics, with real figures." },
  { id: "risks_mitigants", title: "Risks & Mitigants",              guidance: "The 2-4 most material risks and how they are mitigated or priced in." },
  { id: "structure_next_steps", title: "Transaction Structure & Next Steps", guidance: "Proposed structure, use of proceeds, and immediate next steps." },
];

export async function getTwoPagerSections(): Promise<TwoPagerSection[]> {
  const row = await db.query.twoPagerSectionsConfig.findFirst({ where: eq(twoPagerSectionsConfig.id, TWO_PAGER_SECTIONS_ID) }).catch(() => null);
  if (!row?.sections) return DEFAULT_TWO_PAGER_SECTIONS;
  try {
    const parsed = JSON.parse(row.sections);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* fall through to default */ }
  return DEFAULT_TWO_PAGER_SECTIONS;
}
