// Executive summary of a deal, as on the first page of an IC memo: company
// overview (bullets), financial overview (revenue bars + EBITDA margin line,
// CAGR box, extra KPI rows) and transaction overview (label / value / note).
// Stored as JSON on Deal.summary; everything in it is edited by the team.

export type Bullet = { text: string; level: 0 | 1 };   // **bold** allowed in text
export type FinYear = { label: string; revenue: number | null; margin: number | null; projected: boolean };
export type FinRow = { label: string; values: string[] }; // one value per year
export type CagrRow = { label: string; value: string };
export type TxRow = { label: string; value: string; note: string; highlight?: boolean };

export type DealSummary = {
  companyOverview: Bullet[];
  financial: {
    unit: string;          // e.g. "MXN $m"
    scenario: string;      // e.g. "Base Case"
    years: FinYear[];
    rows: FinRow[];        // e.g. "Total stores"
    cagr: CagrRow[];
    footnote: string;
  };
  transaction: TxRow[];
  footnotes: string;
  updatedAt?: string;
  updatedBy?: string;
};

export const DEFAULT_TX_ROWS: TxRow[] = [
  { label: "Base EqV", value: "", note: "" },
  { label: "Debt", value: "", note: "" },
  { label: "Equity", value: "", note: "" },
  { label: "Returns", value: "", note: "", highlight: true },
];

export function emptySummary(): DealSummary {
  return {
    companyOverview: [],
    financial: { unit: "USD $m", scenario: "Base Case", years: [], rows: [], cagr: [], footnote: "" },
    transaction: DEFAULT_TX_ROWS.map(r => ({ ...r })),
    footnotes: "",
  };
}

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : v == null ? "" : String(v).slice(0, max));
const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Cleans anything (saved JSON, a client payload, an AI draft) into a valid summary. */
export function normalizeSummary(raw: unknown): DealSummary {
  const base = emptySummary();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const f = (r.financial ?? {}) as Record<string, unknown>;
  const years = Array.isArray(f.years) ? f.years.slice(0, 16).map(y => {
    const o = (y ?? {}) as Record<string, unknown>;
    return { label: str(o.label, 20), revenue: num(o.revenue), margin: num(o.margin), projected: !!o.projected };
  }) : [];
  return {
    companyOverview: Array.isArray(r.companyOverview) ? r.companyOverview.slice(0, 40).map(b => {
      const o = (b ?? {}) as Record<string, unknown>;
      return { text: str(o.text, 1000), level: o.level === 1 ? 1 : 0 } as Bullet;
    }).filter(b => b.text.trim()) : [],
    financial: {
      unit: str(f.unit, 30) || base.financial.unit,
      scenario: str(f.scenario, 40),
      years,
      rows: Array.isArray(f.rows) ? f.rows.slice(0, 6).map(x => {
        const o = (x ?? {}) as Record<string, unknown>;
        const vals = Array.isArray(o.values) ? o.values.map(v => str(v, 30)) : [];
        return { label: str(o.label, 60), values: years.map((_, i) => vals[i] ?? "") };
      }) : [],
      cagr: Array.isArray(f.cagr) ? f.cagr.slice(0, 4).map(x => {
        const o = (x ?? {}) as Record<string, unknown>;
        return { label: str(o.label, 30), value: str(o.value, 20) };
      }) : [],
      footnote: str(f.footnote, 500),
    },
    transaction: Array.isArray(r.transaction) ? r.transaction.slice(0, 20).map(x => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { label: str(o.label, 60), value: str(o.value, 200), note: str(o.note, 300), highlight: !!o.highlight };
    }) : base.transaction,
    footnotes: str(r.footnotes, 1000),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : undefined,
    updatedBy: typeof r.updatedBy === "string" ? r.updatedBy : undefined,
  };
}

export function parseSummary(json: string | null | undefined): DealSummary | null {
  if (!json) return null;
  try { return normalizeSummary(JSON.parse(json)); } catch { return null; }
}

/** Compound annual growth between two years of the chart, e.g. "38.1%". */
export function cagrBetween(years: FinYear[], from: number, to: number): string {
  const a = years[from], b = years[to];
  const n = to - from;
  if (!a || !b || n <= 0 || !a.revenue || !b.revenue || a.revenue <= 0) return "";
  return `${((Math.pow(b.revenue / a.revenue, 1 / n) - 1) * 100).toFixed(1)}%`;
}

/** Default CAGR rows: first to last actual year, and last actual to last projected. */
export function autoCagr(years: FinYear[]): CagrRow[] {
  const short = (l: string) => `'${l.replace(/^[A-Za-z]+/, "").slice(-2)}`;
  const actual = years.map((y, i) => ({ y, i })).filter(x => !x.y.projected && x.y.revenue);
  const out: CagrRow[] = [];
  if (actual.length >= 2) {
    const a = actual[0], b = actual[actual.length - 1];
    out.push({ label: `${short(a.y.label)} - ${short(b.y.label)}`, value: cagrBetween(years, a.i, b.i) });
  }
  const lastA = actual[actual.length - 1];
  const lastP = years.map((y, i) => ({ y, i })).filter(x => x.y.projected && x.y.revenue).pop();
  if (lastA && lastP && lastP.i > lastA.i) {
    out.push({ label: `${short(lastA.y.label)} - ${lastP.y.label.match(/^[A-Za-z]/) ? lastP.y.label[0] : ""}${short(lastP.y.label)}`, value: cagrBetween(years, lastA.i, lastP.i) });
  }
  return out;
}

/** Instructions + JSON shape for Claude to draft the summary from the company's documents. */
export const DRAFT_SYSTEM = `You are an associate at a private equity firm writing the Executive Summary page of an investment committee memo, from the company's documents and data provided.

Return ONLY a JSON object with this shape:
{
  "companyOverview": [ { "text": "...", "level": 0 } ],
  "financial": {
    "unit": "MXN $m",
    "scenario": "Base Case",
    "years": [ { "label": "2023", "revenue": 1143, "margin": 18.0, "projected": false } ],
    "rows": [ { "label": "Total stores", "values": ["150", "192"] } ],
    "cagr": [ { "label": "'20 - '25", "value": "38.1%" } ],
    "footnote": ""
  },
  "transaction": [ { "label": "Base EqV", "value": "MXN $2,925m", "note": "5.9x LTM EBITDA of MXN $480m", "highlight": false } ],
  "footnotes": ""
}

Rules:
- companyOverview: 3 to 7 bullets in the style "**Founded in 2015**, the Company is…". level 0 = main bullet, level 1 = sub-bullet under the previous main one. Put the key phrase of each bullet in **bold**. Concise, factual, numbers with units.
- financial.years: actual and projected years in order (projected: true for forecasts; prefix projected labels with "E", e.g. "E2027"). revenue in the stated unit (e.g. millions), margin = EBITDA margin in percent (18.0 means 18%). Use the documents' own numbers; never invent. Leave years out rather than guessing.
- financial.rows: at most 2 operating KPIs that the documents give by year (e.g. stores, customers); values aligned with years, "" where unknown. Omit if none.
- cagr: revenue CAGR for the historical period and the projection period when available.
- transaction: rows like Base EqV, Debt, Equity, Roll-over, Returns (IRR / MOIC) with value and a short note, only when the documents or the valuation give them; mark the Returns row highlight: true. If there are no transaction terms, return the labels with empty values.
- Write in the language of the documents (English if mixed). No em dashes.`;
