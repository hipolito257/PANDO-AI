// Fundraising constants (safe for client components).

export const INVESTOR_TYPES = [
  { key: "family_office",  label: "Family office",          color: "#0F2D2B" },
  { key: "afore",          label: "AFORE / pension fund",   color: "#437742" },
  { key: "institutional",  label: "Institutional",          color: "#806E4B" },
  { key: "dfi",            label: "Development finance (DFI)", color: "#4B5F62" },
  { key: "fund_of_funds",  label: "Fund of funds",          color: "#8A9982" },
  { key: "insurance",      label: "Insurance company",      color: "#A5C8D1" },
  { key: "corporate",      label: "Corporate / strategic",  color: "#E2B540" },
  { key: "hnwi",           label: "Individual (HNWI)",      color: "#C9B98F" },
] as const;

export const INVESTOR_STAGES = [
  { key: "identified",  label: "Identified",       kind: "open" },
  { key: "contacted",   label: "Contacted",        kind: "open" },
  { key: "meeting",     label: "First meeting",    kind: "open" },
  { key: "diligence",   label: "Due diligence",    kind: "open" },
  { key: "soft_commit", label: "Soft commit",      kind: "open" },
  { key: "committed",   label: "Committed",        kind: "won" },
  { key: "declined",    label: "Declined",         kind: "lost" },
] as const;

export type InvestorType = (typeof INVESTOR_TYPES)[number]["key"];
export type InvestorStage = (typeof INVESTOR_STAGES)[number]["key"];

export const investorTypeInfo = (k: string) => INVESTOR_TYPES.find(t => t.key === k) ?? INVESTOR_TYPES[0];
export const investorStageInfo = (k: string) => INVESTOR_STAGES.find(s => s.key === k) ?? INVESTOR_STAGES[0];

export type Investor = {
  id: string; name: string; type: string; country: string | null; city: string | null; website: string | null;
  contactName: string | null; contactRole: string | null; stage: string;
  targetAmount: number | null; committedAmount: number | null; currency: string;
  ownerId: string | null; owner?: { id: string; name: string } | null;
  nextStep: string | null; nextStepDate: string | null; notes: string | null;
  stageChangedAt: string | null; createdAt: string; updatedAt: string;
  linkedinUrl?: string | null; description?: string | null; aum?: number | null;
  focus?: string | null; geographies?: string | null; ticketMin?: number | null; ticketMax?: number | null;
  fitScore?: number | null; probability?: number | null; scoreSource?: string | null; scoredAt?: string | null;
  research?: string | null; researchStatus?: string | null; researchError?: string | null; researchedAt?: string | null;
  sheetKey?: string | null;
  contacts?: InvestorContact[];
};

export type InvestorContact = {
  id: string; investorId: string; name: string; role: string | null; email: string | null; phone: string | null;
  linkedinUrl: string | null; notes: string | null; isPrimary: boolean; source: string; createdAt: string; updatedAt: string;
};

/** What the AI found about an investor (stored as JSON on Investor.research). */
export type InvestorResearch = {
  summary: string;
  investorType: string;
  website: string; linkedinUrl: string;
  hq: { city: string; country: string };
  aum: { amount: number | null; currency: string; asOf: string; source: string };
  ticket: { min: number | null; max: number | null; currency: string; note: string };
  investsIn: string[]; sectors: string[]; geographies: string[];
  lpActivity: { fund: string; manager: string; year: string; amount: string; source: string }[];
  directInvestments: { company: string; year: string; note: string; source: string }[];
  people: { name: string; title: string; email: string; phone: string; linkedinUrl: string; source: string }[];
  fit: number | null; probability: number | null;
  rationale: string[]; strengths: string[]; concerns: string[]; approach: string;
  sources: { title: string; url: string }[];
};

/** Colour band for a 0-100 score. */
export function scoreTone(n: number | null | undefined) {
  if (n == null) return "bg-fog text-slate border-chalk";
  return n >= 70 ? "bg-olive text-paper border-olive" : n >= 45 ? "bg-pistacho/70 text-olive border-pistacho" : "bg-amber-50 text-amber-800 border-amber-200";
}

export function fmtMoney(v: number | null | undefined, currency = "USD") {
  if (v == null) return "—";
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(v / 1e9).toFixed(1)}bn` : a >= 1e6 ? `${(v / 1e6).toFixed(a >= 1e8 ? 0 : 1)}m` : a >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : v.toFixed(0);
  return `${currency} ${s}`;
}
