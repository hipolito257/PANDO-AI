// Cap table of a company: who owns what. Stored as JSON on Company.capTable.
// Filled in by the team or drafted by Claude from the company's documents.

export type CapHolder = { name: string; kind: string; pct: number | null; note: string };
export type CapTable = {
  holders: CapHolder[];
  asOf: string;        // e.g. "Dec 2025" or "Post-money Series B"
  source: string;      // e.g. "CIM p. 14" or "Management call"
  updatedAt?: string;
  updatedBy?: string;
};

export const HOLDER_KINDS = ["Founders", "Management", "Family", "PE / VC fund", "Strategic", "Angels", "ESOP", "Pando", "Public float", "Other"];
export const CAP_COLORS = ["#0F2D2B", "#8A9982", "#B9C8A0", "#DCE9C2", "#5E7A6B", "#C7B98F", "#D9DBD4", "#3F5F55", "#A3B18A", "#E8E4D6"];

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max).trim() : v == null ? "" : String(v).slice(0, max).trim());
const pct = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[%,\s]/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 100) / 100)) : null;
};

export function emptyCapTable(): CapTable { return { holders: [], asOf: "", source: "" }; }

export function normalizeCapTable(raw: unknown): CapTable {
  if (!raw || typeof raw !== "object") return emptyCapTable();
  const r = raw as Record<string, unknown>;
  const holders = Array.isArray(r.holders) ? r.holders.slice(0, 30).map(h => {
    const o = (h ?? {}) as Record<string, unknown>;
    return { name: str(o.name, 120), kind: str(o.kind, 40), pct: pct(o.pct), note: str(o.note, 300) };
  }).filter(h => h.name || h.pct != null) : [];
  return { holders, asOf: str(r.asOf, 60), source: str(r.source, 200) };
}

export function parseCapTable(json: string | null | undefined): CapTable | null {
  if (!json) return null;
  try { return normalizeCapTable(JSON.parse(json)); } catch { return null; }
}

export const CAP_DRAFT_SYSTEM = `You read a company's documents (CIM, teaser, decks, financial models, minutes, shareholder registries) and extract its cap table: who owns the company and in what percentage.

Answer with JSON only:
{ "holders": [ { "name": "Founding family (Pérez)", "kind": "Family", "pct": 62.5, "note": "Through holding Grupo X" } ], "asOf": "Dec 2025", "source": "CIM p. 14" , "found": true }

Rules:
- kind is one of: ${HOLDER_KINDS.join(", ")}.
- pct is the fully diluted ownership in percent when given, otherwise the basic ownership. Never invent numbers: if a holder is named without a percentage, use null.
- Only use what the documents say. If they say nothing about ownership, return { "holders": [], "asOf": "", "source": "", "found": false }.
- source names the document and page/slide where you found it. note can say share class, vehicle or other details.`;
