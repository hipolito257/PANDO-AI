// Cleans an investor payload from the UI before it's saved.
import { investors } from "@/lib/db";
import { INVESTOR_STAGES, INVESTOR_TYPES } from "@/lib/fundraising";

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
export const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s$]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const score = (v: unknown) => { const n = num(v); return n == null ? null : Math.max(0, Math.min(100, Math.round(n))); };

export function cleanInvestor(b: Record<string, unknown>) {
  const out: Partial<typeof investors.$inferInsert> = {};
  if (b.name !== undefined) { const v = str(b.name, 160); if (v) out.name = v; }
  if (typeof b.type === "string" && INVESTOR_TYPES.some(t => t.key === b.type)) out.type = b.type;
  if (typeof b.stage === "string" && INVESTOR_STAGES.some(s => s.key === b.stage)) out.stage = b.stage;
  for (const [k, max] of [["country", 60], ["city", 80], ["website", 300], ["linkedinUrl", 300], ["contactName", 120], ["contactRole", 120],
    ["nextStep", 300], ["notes", 4000], ["description", 4000], ["focus", 1000], ["geographies", 500]] as const) {
    if (b[k] !== undefined) out[k] = str(b[k], max);
  }
  if (b.nextStepDate !== undefined) out.nextStepDate = typeof b.nextStepDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.nextStepDate) ? b.nextStepDate : null;
  for (const k of ["targetAmount", "committedAmount", "aum", "ticketMin", "ticketMax"] as const) if (b[k] !== undefined) out[k] = num(b[k]);
  if (typeof b.currency === "string" && b.currency) out.currency = b.currency.slice(0, 5).toUpperCase();
  if (b.ownerId !== undefined) out.ownerId = typeof b.ownerId === "string" && b.ownerId ? b.ownerId : null;
  // Scores typed by hand win over the AI's until the team clears them.
  if (b.fitScore !== undefined || b.probability !== undefined) {
    if (b.fitScore !== undefined) out.fitScore = score(b.fitScore);
    if (b.probability !== undefined) out.probability = score(b.probability);
    out.scoreSource = "manual"; out.scoredAt = new Date().toISOString();
  }
  if (b.scoreSource === "ai") out.scoreSource = "ai";
  return out;
}
