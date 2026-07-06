import { db } from "@/lib/db";
import { firmSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { FIRM_SETTINGS_ID } from "@/lib/firmThesis";

export const DEFAULT_TWO_PAGER_POLICY = `Purpose
The Company 2-Pager is a short, external-facing investment brief PANDO shares with co-investors, lenders, and board members. It must read as polished and confidential, not as an internal working note.

Tone and Voice
- Write in a direct, confident, analytical register, as an investment professional summarizing a real opportunity.
- Every claim should be grounded in the company data and any attached source material provided, never invented.
- Avoid marketing hyperbole ("game-changing", "unprecedented") and avoid hedging language ("might", "could potentially") when the data supports a direct statement.

What to Emphasize
- The investment thesis: why this company, why now, why PANDO.
- Concrete, sourced numbers (revenue, growth, margins, market size) over vague qualitative claims.
- Downside protection and path to liquidity alongside the upside case, per PANDO's standard underwriting discipline.

What to Avoid
- Internal-only language (deal codenames, negotiating positions, unresolved diligence gaps) that should not appear in a document meant to leave the firm.
- Legal or binding language, this is a summary brief, not a term sheet.
- Any figure or claim not traceable to the company data or attached files.

Formatting
- Every page must carry a "Private & Confidential" footer.
- Keep paragraphs tight, this is a 2-pager, not a memo. Prefer short paragraphs and, where useful, bullet points over long prose blocks.`;

export async function getTwoPagerPolicy(): Promise<string> {
  const row = await db.query.firmSettings.findFirst({ where: eq(firmSettings.id, FIRM_SETTINGS_ID) }).catch(() => null);
  return row?.twoPagerPolicy?.trim() || DEFAULT_TWO_PAGER_POLICY;
}
