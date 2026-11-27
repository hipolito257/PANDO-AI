// Works out how to read an investors workbook without asking: which tabs hold
// investors (or the people at them), where each tab's titles are, which column
// is which, whether a tab means a type ("AFOREs") or a stage ("Committed"), and
// how the sheet's own words for stages and types translate. Claude reads the
// first rows of every tab; a keyword guess is the fallback when AI isn't available.
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { norm, type SheetTab } from "@/lib/sheetSync";
import { INVESTOR_STAGES, INVESTOR_TYPES } from "@/lib/fundraising";

const MODEL = "claude-sonnet-5-5";

export const PLAN_FIELDS = [
  { key: "name",            label: "Investor",          hint: "name of the investor institution / family office / fund / person investing. On a tab listing people, the column that says which investor each person belongs to." },
  { key: "type",            label: "Type",              hint: "kind of investor (family office, AFORE, institutional, DFI, fund of funds, insurance, corporate, individual)" },
  { key: "stage",           label: "Stage",             hint: "where the investor is in the fundraising process / status" },
  { key: "country",         label: "Country",           hint: "" },
  { key: "city",            label: "City",              hint: "" },
  { key: "website",         label: "Website",           hint: "the investor's website" },
  { key: "linkedinUrl",     label: "Investor LinkedIn", hint: "LinkedIn page of the institution (not of a person)" },
  { key: "description",     label: "Description",       hint: "who they are / profile" },
  { key: "aum",             label: "AUM",               hint: "assets under management" },
  { key: "focus",           label: "Focus / strategy",  hint: "what they invest in: asset classes, sectors, thesis" },
  { key: "geographies",     label: "Geographies",       hint: "" },
  { key: "targetAmount",    label: "Ticket / target",   hint: "amount Pando hopes they commit, potential ticket" },
  { key: "committedAmount", label: "Committed",         hint: "amount already committed" },
  { key: "currency",        label: "Currency",          hint: "" },
  { key: "owner",           label: "Pando owner",       hint: "person at Pando responsible for the relationship" },
  { key: "nextStep",        label: "Next step",         hint: "" },
  { key: "nextStepDate",    label: "Next step date",    hint: "date of the next step / follow-up" },
  { key: "notes",           label: "Notes",             hint: "comments, status notes, history" },
  { key: "contactName",     label: "Contact name",      hint: "a person at the investor" },
  { key: "contactRole",     label: "Contact role",      hint: "that person's title / position" },
  { key: "contactEmail",    label: "Contact email",     hint: "" },
  { key: "contactPhone",    label: "Contact phone",     hint: "" },
  { key: "contactLinkedin", label: "Contact LinkedIn",  hint: "LinkedIn of the person" },
] as const;
export type PlanField = (typeof PLAN_FIELDS)[number]["key"];

export type TabPlan = {
  name: string;
  use: boolean;
  why: string;
  headerRow: number;                                // 1-based
  type: string | null;                              // the whole tab is one investor type
  stage: string | null;                             // the whole tab is one stage
  columns: Partial<Record<PlanField, number>>;      // 1-based column numbers
};
export type SheetPlan = { summary: string; tabs: TabPlan[]; by: "ai" | "guess" | "manual" };
export type ValueMap = {
  stage: Record<string, string>; type: Record<string, string>;
  guessed?: Record<string, string>; // investor key -> type worked out by AI when the file has no type
};

const TYPE_KEYS = INVESTOR_TYPES.map(t => t.key) as string[];
const STAGE_KEYS = INVESTOR_STAGES.map(s => s.key) as string[];
const cell = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim().slice(0, 50);

/** The workbook's layout: tab names and each tab's title row. Editing data doesn't change it;
 *  adding/renaming tabs or columns does, and then the plan is redone. */
export function fingerprint(tabs: SheetTab[], plan?: SheetPlan | null) {
  const text = tabs.map(t => {
    const tp = plan?.tabs.find(x => x.name === t.name);
    const titles = tp
      ? Array.from(t.rows[tp.headerRow - 1] ?? [], cell).join("|")
      : t.rows.slice(0, 12).map(r => Array.from(r, cell).join("|")).join("/");
    return `${t.name}::${titles}`;
  }).join("\n");
  return createHash("sha1").update(text).digest("hex");
}

// ── Keyword guess (no AI) ──────────────────────────────────────────────────────
const ALIASES: Record<PlanField, string[]> = {
  name: ["investor", "inversionista", "inversor", "name", "nombre", "lp", "institution", "institucion", "firm", "firma", "entity", "entidad", "family office", "fondo", "fund", "empresa", "company", "organizacion", "organization", "cliente", "prospecto"],
  type: ["type", "tipo", "investor type", "tipo de inversionista", "category", "categoria", "segment", "segmento"],
  stage: ["stage", "etapa", "status", "estatus", "estado", "pipeline", "fase"],
  country: ["country", "pais"], city: ["city", "ciudad"],
  website: ["website", "web", "sitio", "sitio web", "url", "pagina"],
  linkedinUrl: ["company linkedin", "linkedin empresa", "linkedin fondo"],
  description: ["description", "descripcion", "profile", "perfil", "about"],
  aum: ["aum", "assets under management", "activos", "activos bajo administracion"],
  focus: ["focus", "strategy", "estrategia", "sectors", "sectores", "thesis", "tesis", "invests in", "invierte en"],
  geographies: ["geography", "geographies", "geografia", "region", "regiones"],
  targetAmount: ["ticket", "target", "monto", "monto objetivo", "ask", "potential", "potencial", "compromiso potencial"],
  committedAmount: ["committed", "comprometido", "commitment", "compromiso", "monto comprometido"],
  currency: ["currency", "moneda", "divisa"],
  owner: ["owner", "responsable", "lead", "pando lead", "coverage", "encargado"],
  nextStep: ["next step", "next steps", "siguiente paso", "proximo paso", "siguientes pasos"],
  nextStepDate: ["next step date", "fecha", "fecha siguiente paso", "follow up", "fecha seguimiento"],
  notes: ["notes", "notas", "comments", "comentarios", "observaciones"],
  contactName: ["contact", "contacto", "contact name", "nombre contacto", "persona", "person", "key contact"],
  contactRole: ["role", "puesto", "cargo", "title", "position", "titulo"],
  contactEmail: ["email", "correo", "mail", "e mail", "correo electronico"],
  contactPhone: ["phone", "telefono", "tel", "celular", "mobile", "movil", "whatsapp"],
  contactLinkedin: ["linkedin", "contact linkedin", "linkedin contacto"],
};
export const TYPE_WORDS: Record<string, string[]> = {
  family_office: ["family office", "family offices", "fo", "familia", "family"],
  afore: ["afore", "afores", "pension", "pensiones", "siefore"],
  institutional: ["institutional", "institucional", "institucionales", "endowment", "sovereign", "soberano", "bank", "banco"],
  dfi: ["dfi", "dfis", "development", "desarrollo", "multilateral", "ifc", "idb", "bid", "nafin", "fonadin"],
  fund_of_funds: ["fund of funds", "fondo de fondos", "fof", "fdf"],
  insurance: ["insurance", "aseguradora", "aseguradoras", "seguros"],
  corporate: ["corporate", "corporativo", "corporativos", "strategic", "estrategico"],
  hnwi: ["hnwi", "individual", "individuals", "persona fisica", "personas fisicas", "angel", "uhnwi"],
};
export const STAGE_WORDS: Record<string, string[]> = {
  identified: ["identified", "identificado", "prospect", "prospecto", "target", "por contactar", "new", "nuevo"],
  contacted: ["contacted", "contactado", "outreach", "email sent", "correo enviado", "reached out"],
  meeting: ["meeting", "reunion", "first meeting", "primera reunion", "call", "llamada", "pitch", "intro"],
  diligence: ["diligence", "due diligence", "dd", "ddq", "data room"],
  soft_commit: ["soft commit", "verbal", "interesado", "interested", "lpa", "negotiation", "negociacion"],
  committed: ["committed", "comprometido", "closed", "cerrado", "signed", "firmado", "invested", "won"],
  declined: ["declined", "rechazado", "pass", "lost", "perdido", "not interested", "no interesado", "descartado"],
};
export function guessFrom(words: Record<string, string[]>, raw: string): string | null {
  const n = norm(raw);
  if (!n) return null;
  for (const [k, ws] of Object.entries(words)) if (ws.includes(n)) return k;
  for (const [k, ws] of Object.entries(words)) if (ws.some(w => w.length > 2 && n.includes(w))) return k;
  return null;
}

function guessHeaderRow(rows: string[][]): number {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = Array.from(rows[i] ?? [], c => c ?? "");
    const filled = cells.filter(Boolean).length;
    if (filled < 2) continue;
    const hits = cells.filter(c => Object.values(ALIASES).some(a => a.includes(norm(c)))).length;
    const s = hits * 10 + Math.min(filled, 9);
    if (s > bestScore) { best = i; bestScore = s; }
  }
  return best + 1;
}
function guessColumns(headers: string[]): TabPlan["columns"] {
  const out: TabPlan["columns"] = {};
  const used = new Set<number>();
  const hs = Array.from(headers, h => norm(h ?? ""));
  for (const pass of ["exact", "contains"] as const) {
    for (const f of PLAN_FIELDS) {
      if (out[f.key]) continue;
      const i = hs.findIndex((n, idx) => !used.has(idx) && !!n && (pass === "exact"
        ? ALIASES[f.key].includes(n)
        : ALIASES[f.key].some(a => a.length > 3 && (n.includes(a) || a.includes(n)))));
      if (i >= 0) { out[f.key] = i + 1; used.add(i); }
    }
  }
  return out;
}
export function guessPlan(tabs: SheetTab[]): SheetPlan {
  return {
    by: "guess",
    summary: "Read with column-title matching (AI wasn't available).",
    tabs: tabs.map(t => {
      const headerRow = guessHeaderRow(t.rows);
      const columns = guessColumns(Array.from(t.rows[headerRow - 1] ?? [], c => c ?? ""));
      return { name: t.name, use: !!columns.name, why: columns.name ? "Has an investor column" : "No investor column found",
        headerRow, type: guessFrom(TYPE_WORDS, t.name), stage: null, columns };
    }),
  };
}

// ── AI ─────────────────────────────────────────────────────────────────────────
const PLAN_SYSTEM = `You are setting up the import of a fundraising workbook into Pando's CRM. Pando is a Mexican private equity firm raising a fund; the workbook tracks prospective investors (LPs) and the people at them. It can have any layout: several tabs, titles not on the first row, Spanish or English, one tab per investor type, a separate tab of contacts, summary tabs, etc.

For EVERY tab, decide:
- use: true if it lists investors (one per row, or one row per person at an investor). false for summaries, dashboards, instructions, lookups, charts, empty or unrelated tabs.
- headerRow: the 1-based row number holding the column titles (the rows above it are titles or notes).
- columns: which column (1-based number) holds each field below. Only map a column when you are confident; leave fields out otherwise. Never map one column to two fields. "name" is required for a used tab: the investor institution's name (on a people tab, the column saying which investor each person belongs to).
- type: if the whole tab is one kind of investor (e.g. tab "AFOREs", "Family Offices", "DFIs"), that type key, else null.
- stage: if the whole tab is one stage (e.g. "Committed", "Descartados"), that stage key, else null.
- why: a few words on what the tab is.

Fields: ${PLAN_FIELDS.map(f => `${f.key} (${f.label}${f.hint ? `: ${f.hint}` : ""})`).join("; ")}.
Type keys: ${TYPE_KEYS.join(", ")}. Stage keys: ${STAGE_KEYS.join(", ")}.

Answer with ONLY a JSON object:
{ "summary": "2-3 sentences, in plain English, on how the workbook is organised and how you'll read it",
  "tabs": [ { "name": "exact tab name", "use": true, "why": "", "headerRow": 1, "type": null, "stage": null, "columns": { "name": 1 } } ] }`;

const VALUES_SYSTEM = `Translate the words a fundraising spreadsheet uses into Pando's CRM values.
Stage keys: ${INVESTOR_STAGES.map(s => `${s.key} (${s.label})`).join(", ")}.
Type keys: ${INVESTOR_TYPES.map(t => `${t.key} (${t.label})`).join(", ")}.
For each given value pick the closest key, or null when it doesn't express a stage/type (e.g. blank-like, "TBD").
Answer with ONLY JSON: { "stage": { "<value>": "<key or null>" }, "type": { "<value>": "<key or null>" } }`;

function tabPreview(t: SheetTab) {
  const lines: string[] = [];
  for (let i = 0; i < t.rows.length && lines.length < 14; i++) {
    const cells = Array.from(t.rows[i] ?? [], cell);
    if (!cells.some(Boolean)) continue;
    lines.push(`row ${i + 1}: ${cells.slice(0, 30).map((c, j) => `[${j + 1}] ${c}`).join(" | ")}`);
  }
  return `TAB "${t.name}" (${t.rows.length} rows)\n${lines.join("\n") || "(empty)"}`;
}

async function askJson(apiKey: string, system: string, user: string) {
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({ model: MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: user }] });
  if (msg.stop_reason === "refusal") throw new Error("refused");
  const text = msg.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

/** Keeps only what makes sense for the actual tabs (and falls back to the guess per tab). */
export function validatePlan(raw: unknown, tabs: SheetTab[], by: SheetPlan["by"]): SheetPlan {
  const r = (raw ?? {}) as { summary?: unknown; tabs?: unknown };
  const guess = guessPlan(tabs);
  const given = Array.isArray(r.tabs) ? (r.tabs as Record<string, unknown>[]) : [];
  return {
    by,
    summary: typeof r.summary === "string" ? r.summary.slice(0, 800) : guess.summary,
    tabs: tabs.map((t, idx) => {
      const g = given.find(x => x?.name === t.name) ?? given.find(x => norm(x?.name) === norm(t.name));
      if (!g) return guess.tabs[idx];
      const width = Math.max(...t.rows.slice(0, 40).map(row => row?.length ?? 0), 0);
      const headerRow = Number.isInteger(g.headerRow) && (g.headerRow as number) >= 1 && (g.headerRow as number) <= Math.max(1, t.rows.length) ? (g.headerRow as number) : guess.tabs[idx].headerRow;
      const columns: TabPlan["columns"] = {};
      const used = new Set<number>();
      const cols = (g.columns ?? {}) as Record<string, unknown>;
      for (const f of PLAN_FIELDS) {
        const c = Number(cols[f.key]);
        if (Number.isInteger(c) && c >= 1 && c <= width && !used.has(c)) { columns[f.key] = c; used.add(c); }
      }
      const type = typeof g.type === "string" && TYPE_KEYS.includes(g.type) ? g.type : null;
      const stage = typeof g.stage === "string" && STAGE_KEYS.includes(g.stage) ? g.stage : null;
      return { name: t.name, use: g.use === true && !!columns.name, why: typeof g.why === "string" ? g.why.slice(0, 200) : "", headerRow, type, stage, columns };
    }),
  };
}

/** How to read the workbook: AI when an API key is available, else the keyword guess. */
export async function makePlan(tabs: SheetTab[], apiKey: string | null | undefined): Promise<SheetPlan> {
  if (!apiKey) return guessPlan(tabs);
  try {
    const raw = await askJson(apiKey, PLAN_SYSTEM, tabs.slice(0, 25).map(tabPreview).join("\n\n"));
    return validatePlan(raw, tabs, "ai");
  } catch (err) {
    console.error("[investor sheet plan]", err);
    return guessPlan(tabs);
  }
}

/** Translates the sheet's own stage/type words the keyword guess can't place. */
export async function makeValueMap(plan: SheetPlan, tabs: SheetTab[], apiKey: string | null | undefined, prev: ValueMap | null): Promise<ValueMap> {
  const map: ValueMap = { stage: { ...(prev?.stage ?? {}) }, type: { ...(prev?.type ?? {}) }, guessed: { ...(prev?.guessed ?? {}) } };
  const unknown: { stage: Set<string>; type: Set<string> } = { stage: new Set(), type: new Set() };
  for (const tp of plan.tabs.filter(x => x.use)) {
    const t = tabs.find(x => x.name === tp.name);
    if (!t) continue;
    for (const field of ["stage", "type"] as const) {
      const c = tp.columns[field];
      if (!c) continue;
      for (const row of t.rows.slice(tp.headerRow)) {
        const v = cell(row?.[c - 1]);
        if (!v || map[field][norm(v)] !== undefined) continue;
        if (guessFrom(field === "stage" ? STAGE_WORDS : TYPE_WORDS, v) && norm(v).length < 25) continue;
        unknown[field].add(v);
      }
    }
  }
  if (!apiKey || (!unknown.stage.size && !unknown.type.size)) return map;
  try {
    const raw = await askJson(apiKey, VALUES_SYSTEM, JSON.stringify({ stage: [...unknown.stage].slice(0, 80), type: [...unknown.type].slice(0, 80) }));
    for (const field of ["stage", "type"] as const) {
      const keys = field === "stage" ? STAGE_KEYS : TYPE_KEYS;
      for (const [v, k] of Object.entries((raw?.[field] ?? {}) as Record<string, unknown>)) {
        map[field][norm(v)] = typeof k === "string" && keys.includes(k) ? k : "";
      }
    }
  } catch (err) {
    console.error("[investor sheet values]", err);
  }
  return map;
}

const CLASSIFY_SYSTEM = `You classify prospective investors (LPs) of Pando, a Mexican private equity firm, by type.
Types: ${INVESTOR_TYPES.map(t => `${t.key} (${t.label})`).join(", ")}.
Guidance: in Mexico the AFORE operators often appear just by brand (XXI Banorte, Sura, Profuturo, Principal, Citibanamex / Banamex, Inbursa, Coppel, Azteca, PensionISSSTE, Invercap) and are "afore". Banks, endowments, sovereign funds and asset managers investing their balance sheet are "institutional". Development banks and multilaterals (IFC, IDB Invest, BID, Nafin, Bancomext, CAF, DFC, FMO, Proparco, DEG, BII) are "dfi". Funds of funds and fund-of-funds programmes (e.g. Fondo de Fondos) are "fund_of_funds". Insurers are "insurance". Operating companies investing strategically are "corporate". Wealthy individuals are "hnwi". Family offices and holding companies of families are "family_office". When unsure, pick the most likely type from the name.
Answer with ONLY JSON mapping each given id to a type key: { "<id>": "<type key>" }`;

/** Types for investors the file gives no type for (by name, country, notes). */
export async function classifyTypes(items: { key: string; name: string; country?: string; city?: string; notes?: string }[], apiKey: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (let i = 0; i < items.length; i += 120) {
    const chunk = items.slice(i, i + 120);
    const lines = chunk.map((x, j) => `${j + 1}. ${x.name}${x.city || x.country ? ` | ${[x.city, x.country].filter(Boolean).join(", ")}` : ""}${x.notes ? ` | ${x.notes.slice(0, 120)}` : ""}`);
    try {
      const raw = await askJson(apiKey, CLASSIFY_SYSTEM, lines.join("\n"));
      for (const [id, k] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
        const item = chunk[Number(id) - 1];
        if (item && typeof k === "string" && TYPE_KEYS.includes(k)) out[item.key] = k;
      }
    } catch (err) {
      console.error("[investor type classify]", err);
    }
  }
  return out;
}
