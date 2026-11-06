// Deal pipeline sync from a Google Sheet (or an .xlsx stored in Google Drive).
//
// A run reads the sheet, maps each row to a deal and proposes the differences.
// It compares against the sheet as it was at the last review (the snapshot), so
// only what changed IN THE SHEET is proposed: a deal someone moved in the
// platform isn't pushed back to the sheet's older value every week.
// Nothing is written to the deals until someone approves the changes.
import { createSign, randomUUID } from "crypto";
import { notify } from "@/lib/push";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, deals, dealMembers, companies, users, sheetSyncs, sheetSyncRuns } from "@/lib/db";
import { listStages, logDeal, notifyDealTeam, nowIso, type DealStageRow } from "@/lib/deals";
import { recordFieldChanges } from "@/lib/provenance";
import { slugify } from "@/lib/utils";

// ── Fields ────────────────────────────────────────────────────────────────────

export const SYNC_FIELDS = [
  { key: "company",     label: "Company",              required: true },
  { key: "codeName",    label: "Project / code name" },
  { key: "stage",       label: "Stage",                required: true },
  { key: "type",        label: "Deal type" },
  { key: "lead",        label: "Deal lead" },
  { key: "dealSize",    label: "Deal size" },
  { key: "currency",    label: "Currency" },
  { key: "onHold",      label: "On hold" },
  { key: "statusNote",  label: "Status / comments" },
  { key: "description", label: "Description" },
  { key: "sector",      label: "Sector (new companies)" },
  { key: "country",     label: "Country (new companies)" },
] as const;
export type SyncField = (typeof SYNC_FIELDS)[number]["key"];
export type ColumnMap = Partial<Record<SyncField, string>>;
export type StageMap = Record<string, string>; // normalized sheet value -> stage key | __hold | __ignore

// Fields a run can change on an existing deal.
const DEAL_FIELDS = ["stage", "onHold", "type", "lead", "dealSize", "currency", "statusNote", "description"] as const;
type DealField = (typeof DEAL_FIELDS)[number];

const SYNONYMS: Record<SyncField, string[]> = {
  company:     ["empresa", "compania", "company", "target", "company name", "nombre empresa", "razon social", "cliente", "nombre"],
  codeName:    ["proyecto", "project", "code name", "codename", "nombre clave", "nombre del proyecto", "project name", "deal", "deal name"],
  stage:       ["etapa", "stage", "status", "estatus", "estado", "fase", "phase", "pipeline stage", "deal stage"],
  type:        ["tipo", "type", "deal type", "tipo de deal", "tipo de transaccion", "transaccion"],
  lead:        ["lead", "deal lead", "responsable", "owner", "lider", "encargado", "socio", "partner", "originador"],
  dealSize:    ["tamano", "size", "deal size", "ticket", "monto", "valor", "ev", "enterprise value", "inversion", "valuacion", "valuation"],
  currency:    ["moneda", "currency", "divisa"],
  onHold:      ["on hold", "hold", "pausa", "en pausa", "pausado"],
  statusNote:  ["comentarios", "comments", "notas", "notes", "next steps", "siguientes pasos", "proximos pasos", "status note", "observaciones", "update", "actualizacion", "comentario"],
  description: ["descripcion", "description", "tesis", "thesis", "resumen"],
  sector:      ["sector", "industria", "industry", "vertical"],
  country:     ["pais", "country", "region", "geografia"],
};

const STAGE_SYNONYMS: Record<string, string[]> = {
  sourcing:  ["sourcing", "origination", "originacion", "prospecto", "prospect", "lead", "pipeline", "nuevo", "new", "identificado", "radar"],
  screening: ["screening", "analisis", "analysis", "evaluacion", "teaser", "nda", "cim", "revision", "review", "preliminar"],
  ic1:       ["ic1", "first ic", "primer comite", "comite 1", "ic 1", "ioi", "non binding", "no vinculante", "loi", "carta de intencion", "oferta"],
  dd:        ["dd", "due diligence", "diligencia", "auditoria", "confirmatory"],
  ic_final:  ["final ic", "ic final", "comite final", "ic2", "ic 2", "binding", "vinculante", "aprobacion"],
  signing:   ["signing", "closing", "firma", "cierre", "spa", "negociacion", "documentacion", "legal"],
  closed:    ["closed", "cerrado", "won", "ganado", "invertido", "invested", "portfolio", "portafolio", "completado"],
  dropped:   ["dropped", "descartado", "lost", "perdido", "pass", "passed", "rechazado", "cancelado", "declined", "muerto", "dead", "no go"],
};
const HOLD_WORDS = ["on hold", "hold", "pausa", "en pausa", "pausado", "stand by", "standby", "congelado"];

export const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ── Reading the file ──────────────────────────────────────────────────────────

export type SheetRef = { fileId: string; kind: "gsheet" | "drive_file" };

export function parseSheetUrl(url: string): SheetRef | null {
  const u = url.trim();
  let m = u.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return { fileId: m[1], kind: "gsheet" };
  m = u.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{20,})/) ?? u.match(/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([a-zA-Z0-9_-]{20,})/);
  if (m) return { fileId: m[1], kind: "drive_file" };
  return null;
}

type ServiceAccount = { client_email: string; private_key: string };

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const sa = JSON.parse(json) as ServiceAccount;
    return sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

/** The service account's address, so the UI can tell people who to share the file with. */
export function serviceAccountEmail(): string | null {
  return serviceAccount()?.client_email ?? null;
}

let tokenCache: { token: string; exp: number } | null = null;

async function googleToken(sa: ServiceAccount): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key.replace(/\\n/g, "\n"), "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  if (!res.ok) throw new Error(`Google sign-in for the service account failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function downloadViaServiceAccount(ref: SheetRef, sa: ServiceAccount): Promise<Buffer | null> {
  const token = await googleToken(sa);
  const headers = { Authorization: `Bearer ${token}` };
  const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${ref.fileId}?fields=mimeType&supportsAllDrives=true`, { headers });
  if (meta.status === 404 || meta.status === 403) return null; // not shared with the service account
  if (!meta.ok) throw new Error(`Google Drive answered ${meta.status}`);
  const { mimeType } = (await meta.json()) as { mimeType: string };
  const url = mimeType === "application/vnd.google-apps.spreadsheet"
    ? `https://www.googleapis.com/drive/v3/files/${ref.fileId}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`
    : `https://www.googleapis.com/drive/v3/files/${ref.fileId}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Couldn't download the file from Google Drive (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function downloadViaLink(ref: SheetRef): Promise<Buffer | null> {
  const url = ref.kind === "gsheet"
    ? `https://docs.google.com/spreadsheets/d/${ref.fileId}/export?format=xlsx`
    : `https://drive.google.com/uc?export=download&id=${ref.fileId}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  // A private file answers with Google's sign-in page instead of the workbook.
  return buf.subarray(0, 2).toString() === "PK" ? buf : null;
}

export async function downloadSheet(ref: SheetRef): Promise<Buffer> {
  const sa = serviceAccount();
  if (sa) {
    const buf = await downloadViaServiceAccount(ref, sa);
    if (buf) return buf;
  }
  const buf = await downloadViaLink(ref);
  if (buf) return buf;
  throw new Error(sa
    ? `The platform can't open this file. Share it (Viewer) with ${sa.client_email}, or set it to "Anyone with the link".`
    : `The platform can't open this file. In Google Drive, set sharing to "Anyone with the link" (Viewer).`);
}

export type SheetTab = { name: string; rows: string[][] };

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown };
    if (o.richText) return o.richText.map(r => r.text).join("").trim();
    if ("result" in o) return cellText(o.result);
    if (o.text !== undefined) return cellText(o.text);
    if (o.error) return "";
    return "";
  }
  return String(v).trim();
}

export async function readWorkbook(buf: Buffer): Promise<SheetTab[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const tabs: SheetTab[] = [];
  wb.eachSheet((ws: { name: string; state?: string; eachRow: (opts: object, cb: (row: { number: number; values: unknown[] }) => void) => void }) => {
    if (ws.state && ws.state !== "visible") return;
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, row => {
      const vals = (row.values as unknown[]).slice(1).map(cellText); // exceljs rows are 1-based
      rows[row.number - 1] = vals;
    });
    for (let i = 0; i < rows.length; i++) rows[i] = rows[i] ?? [];
    tabs.push({ name: ws.name, rows: rows.slice(0, 5000) });
  });
  return tabs;
}

// ── Mapping guesses ───────────────────────────────────────────────────────────

function headerScore(cells: string[]): number {
  let score = 0;
  for (const c of cells) {
    const n = norm(c);
    if (n && Object.values(SYNONYMS).some(list => list.includes(n))) score++;
  }
  return score;
}

/** 1-based row number of the header: the early row that looks most like column titles. */
export function guessHeaderRow(rows: string[][]): number {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const filled = rows[i].filter(Boolean).length;
    if (filled < 2) continue;
    const s = headerScore(rows[i]) * 10 + Math.min(filled, 9);
    if (s > bestScore) { best = i; bestScore = s; }
  }
  return best + 1;
}

export function headersOf(tab: SheetTab, headerRow: number): string[] {
  return (tab.rows[headerRow - 1] ?? []).map((h, i) => h || `Column ${i + 1}`);
}

export function guessColumnMap(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<string>();
  // Exact synonym matches first, then "contains" matches for what's left.
  for (const pass of ["exact", "contains"] as const) {
    for (const f of SYNC_FIELDS) {
      if (map[f.key]) continue;
      const hit = headers.find(h => {
        if (used.has(h)) return false;
        const n = norm(h);
        return SYNONYMS[f.key].some(s => (pass === "exact" ? n === s : s.length > 3 && (n.includes(s) || (n.length > 3 && s.includes(n)))));
      });
      if (hit) { map[f.key] = hit; used.add(hit); }
    }
  }
  return map;
}

export function guessStage(value: string, stages: DealStageRow[]): string | null {
  const n = norm(value);
  if (!n) return null;
  if (HOLD_WORDS.includes(n)) return "__hold";
  const tokens = ` ${n} `;
  let best: string | null = null, bestScore = 0;
  for (const s of stages) {
    const words = [norm(s.label), norm(s.key), ...(STAGE_SYNONYMS[s.key] ?? [])];
    for (const w of words) {
      if (!w) continue;
      // Exact value > whole-word match ("nda firmado" has the word "nda") > substring of a longer word.
      const score = n === w ? 1000 : tokens.includes(` ${w} `) ? 100 + w.length : w.length > 3 && n.includes(w) ? w.length : 0;
      if (score > bestScore) { best = s.key; bestScore = score; }
    }
  }
  return best;
}

/** Distinct stage values in the sheet with their current or guessed mapping. */
export function stageValues(tab: SheetTab, headerRow: number, map: ColumnMap, stages: DealStageRow[], current: StageMap = {}) {
  const col = headersOf(tab, headerRow).indexOf(map.stage ?? "\u0000");
  if (col < 0) return [];
  const counts = new Map<string, { value: string; count: number }>();
  for (const row of tab.rows.slice(headerRow)) {
    const v = row[col]?.trim();
    if (!v) continue;
    const k = norm(v);
    const e = counts.get(k) ?? { value: v, count: 0 };
    e.count++;
    counts.set(k, e);
  }
  return [...counts.entries()].map(([k, e]) => ({ key: k, value: e.value, count: e.count, mapped: current[k] ?? guessStage(e.value, stages) }));
}

// ── Values ────────────────────────────────────────────────────────────────────

export type RowValues = Partial<Record<SyncField, string>>;

const TRUTHY = ["si", "yes", "y", "x", "true", "1", "verdadero", ...HOLD_WORDS];

export function parseSize(raw: string, unit: number): number | null {
  const s = raw.replace(/[$€£\s]/g, "").replace(/(usd|mxn|eur|us|dlls?|mdp|pesos|dolares)/gi, m => (/mdp/i.test(m) ? "mm" : ""));
  const m = s.match(/^(-?[\d.,]+)(bn|b|mm|m|mn|mill|millones|k|mil)?$/i);
  if (!m) return null;
  let num = m[1];
  // "1.234.567" / "1,234,567" thousands, "12,5" decimal comma
  if (/^\d{1,3}([.,]\d{3})+$/.test(num)) num = num.replace(/[.,]/g, "");
  else num = num.replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, "");
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  const suf = (m[2] ?? "").toLowerCase();
  const mult = suf === "bn" || suf === "b" ? 1e9 : ["mm", "m", "mn", "mill", "millones"].includes(suf) ? 1e6 : suf === "k" || suf === "mil" ? 1e3 : unit;
  return n * mult;
}

function parseType(raw: string): string | null {
  const n = norm(raw);
  if (!n) return null;
  if (/add ?on|bolt|tuck/.test(n)) return "add_on";
  if (/minor|minoritari|growth/.test(n)) return "minority";
  if (/sell|venta|vendedor|desinversion/.test(n)) return "sell_side";
  if (/buy|compra|adquisicion|control|lbo|mayoritari/.test(n)) return "buy_side";
  return null;
}

function parseCurrency(raw: string): string | null {
  const n = norm(raw);
  if (!n) return null;
  if (/mxn|peso|mdp/.test(n)) return "MXN";
  if (/eur/.test(n)) return "EUR";
  if (/usd|dolar|dollar|us/.test(n) || raw.trim() === "$") return "USD";
  return /^[a-z]{3}$/.test(n) ? n.toUpperCase() : null;
}

type UserRow = { id: string; name: string; email: string };

function matchUser(raw: string, people: UserRow[]): UserRow | null {
  const n = norm(raw);
  if (!n) return null;
  const byEmail = people.find(p => p.email.toLowerCase() === raw.trim().toLowerCase());
  if (byEmail) return byEmail;
  const exact = people.filter(p => norm(p.name) === n);
  if (exact.length === 1) return exact[0];
  const partial = people.filter(p => { const pn = norm(p.name); return pn.startsWith(`${n} `) || pn.includes(n) || n.includes(pn); });
  return partial.length === 1 ? partial[0] : null;
}

// ── Proposing changes ─────────────────────────────────────────────────────────

export type ProposedChange = {
  id: string;
  kind: "update" | "create" | "missing" | "warning";
  row?: number;
  key?: string;
  dealId?: string;
  dealName?: string;
  companyName?: string;
  field?: DealField;
  from?: string | null;
  to?: string | null;
  fromLabel?: string;
  toLabel?: string;
  create?: {
    companyId: string | null; company: string; codeName: string; stage: string; type: string | null;
    leadUserId: string | null; dealSize: number | null; currency: string | null; onHold: boolean;
    statusNote: string | null; description: string | null; sector: string | null; country: string | null;
  };
  message?: string;
};

type Snapshot = Record<string, Partial<Record<DealField | "exists", string | null>>>;

export type SyncConfig = typeof sheetSyncs.$inferSelect;

const parseJson = <T,>(s: string | null | undefined, fallback: T): T => {
  try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
};

/** Reads the sheet and works out what changed, without writing anything to the deals. */
export async function computeChanges(sync: SyncConfig, given?: SheetTab[]) {
  const tabs = given ?? await readWorkbook(await downloadSheet({ fileId: sync.fileId, kind: sync.fileKind as SheetRef["kind"] }));
  const tab = tabs.find(t => t.name === sync.sheetName) ?? tabs[0];
  if (!tab) throw new Error("The file has no sheets");
  if (sync.sheetName && tab.name !== sync.sheetName) throw new Error(`The tab "${sync.sheetName}" isn't in the file anymore`);

  const map = parseJson<ColumnMap>(sync.columnMap, {});
  const stageMap = parseJson<StageMap>(sync.stageMap, {});
  const snap = parseJson<Snapshot>(sync.snapshot, {});
  const headers = headersOf(tab, sync.headerRow);
  const col = (f: SyncField) => (map[f] ? headers.indexOf(map[f]!) : -1);
  if (col("company") < 0 || col("stage") < 0) throw new Error("The Company and Stage columns aren't mapped (or were renamed in the sheet)");

  const [stages, people, allDeals, allCompanies] = await Promise.all([
    listStages(),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users),
    db.query.deals.findMany({ with: { company: { columns: { id: true, name: true } }, lead: { columns: { id: true, name: true } } } }),
    db.select({ id: companies.id, name: companies.name }).from(companies),
  ]);
  const stageLabel = (k: string | null | undefined) => stages.find(s => s.key === k)?.label ?? k ?? "—";
  const stageOf = (raw: string) => (raw ? (stageMap[norm(raw)] ?? guessStage(raw, stages)) : null);
  const managesHold = col("onHold") >= 0 || Object.values(stageMap).includes("__hold")
    || tab.rows.slice(sync.headerRow).some(r => stageOf(r[col("stage")] ?? "") === "__hold")
    || Object.values(snap).some(r => r.onHold !== undefined); // was managed before: a deal leaving "on hold" resumes

  const changes: ProposedChange[] = [];
  const newSnap: Snapshot = {};
  const warn = (message: string, row?: number) => changes.push({ id: randomUUID(), kind: "warning", message, row });
  const unmappedStages = new Set<string>();
  const unknownLeads = new Set<string>();
  const seen = new Set<string>();
  const keyUpdates: { id: string; key: string }[] = [];
  let rowCount = 0;

  tab.rows.forEach((cells, i) => {
    const rowNo = i + 1;
    if (rowNo <= sync.headerRow) return;
    const v: RowValues = {};
    for (const f of SYNC_FIELDS) { const c = col(f.key); if (c >= 0) v[f.key] = cells[c]?.trim() ?? ""; }
    if (!v.company && !v.codeName) return;
    if (!v.company) { warn(`Row ${rowNo}: no company name, skipped`, rowNo); return; }
    rowCount++;

    const key = norm(v.codeName || v.company);
    if (seen.has(key)) { warn(`Row ${rowNo}: "${v.codeName || v.company}" appears more than once in the sheet; only the first row is used`, rowNo); return; }
    seen.add(key);

    // What the sheet says each deal field should be.
    const want: Partial<Record<DealField, string | null>> = {};
    const stageRaw = v.stage ?? "";
    const mapped = stageOf(stageRaw);
    if (mapped && mapped !== "__hold" && mapped !== "__ignore" && stages.some(s => s.key === mapped)) want.stage = mapped;
    else if (stageRaw && !mapped) unmappedStages.add(stageRaw);
    if (managesHold) {
      const holdCol = col("onHold") >= 0 && TRUTHY.includes(norm(v.onHold));
      want.onHold = String(holdCol || mapped === "__hold");
    }
    if (v.type !== undefined) { const t = parseType(v.type); if (t) want.type = t; }
    if (v.lead !== undefined && v.lead) {
      const u = matchUser(v.lead, people);
      if (u) want.lead = u.id; else unknownLeads.add(v.lead);
    }
    if (v.dealSize !== undefined) {
      const size = v.dealSize ? parseSize(v.dealSize, sync.sizeUnit) : null;
      if (!v.dealSize || size !== null) want.dealSize = size === null ? null : String(size); // unreadable text is left alone
    }
    if (v.currency !== undefined) { const c = parseCurrency(v.currency); if (c) want.currency = c; }
    if (v.statusNote !== undefined) want.statusNote = v.statusNote || null;
    if (v.description !== undefined) want.description = v.description || null;
    newSnap[key] = { ...want, exists: "1" };

    const deal = allDeals.find(d => d.sheetKey === key)
      ?? allDeals.find(d => !d.sheetKey && norm(d.codeName) === key)
      ?? allDeals.find(d => !d.sheetKey && norm(d.company?.name) === norm(v.company));

    if (!deal) {
      // Proposed before and turned down: only proposed again once the row changes.
      const prev = snap[key];
      if (prev?.exists && DEAL_FIELDS.every(f => (prev[f] ?? null) === (want[f] ?? null))) return;
      // A row that's only "on hold" goes on the first stage, paused.
      if (!want.stage && want.onHold === "true") want.stage = stages.find(s => s.kind === "open")?.key;
      if (!want.stage) return;       // can't place it on the board; already reported as an unmapped stage
      const company = allCompanies.find(c => norm(c.name) === norm(v.company));
      changes.push({
        id: randomUUID(), kind: "create", row: rowNo, key, dealName: v.codeName || v.company, companyName: company?.name ?? v.company,
        create: {
          companyId: company?.id ?? null, company: v.company!, codeName: v.codeName || v.company!, stage: want.stage,
          type: want.type ?? null, leadUserId: want.lead ?? null,
          dealSize: want.dealSize ? Number(want.dealSize) : null, currency: want.currency ?? null,
          onHold: want.onHold === "true", statusNote: want.statusNote ?? null, description: want.description ?? null,
          sector: v.sector || null, country: v.country || null,
        },
      });
      return;
    }
    if (deal.sheetKey !== key) keyUpdates.push({ id: deal.id, key });

    const current: Record<DealField, string | null> = {
      stage: deal.stage, onHold: String(deal.onHold), type: deal.type, lead: deal.leadUserId,
      dealSize: deal.dealSize == null ? null : String(deal.dealSize), currency: deal.currency,
      statusNote: deal.statusNote, description: deal.description,
    };
    const before = snap[key] ?? {};
    for (const f of DEAL_FIELDS) {
      if (!(f in want)) continue;
      const to = want[f] ?? null;
      if (f in before && (before[f] ?? null) === to) continue; // unchanged in the sheet since the last review
      const from = current[f];
      const same = f === "dealSize" ? (from === null ? to === null : to !== null && Math.abs(Number(from) - Number(to)) < 0.5) : (from ?? "") === (to ?? "");
      if (same) continue;
      const label = (x: string | null) => {
        if (x === null || x === "") return "—";
        if (f === "stage") return stageLabel(x);
        if (f === "onHold") return x === "true" ? "On hold" : "Active";
        if (f === "lead") return people.find(p => p.id === x)?.name ?? x;
        if (f === "dealSize") return Number(x).toLocaleString("en-US");
        return x.length > 160 ? `${x.slice(0, 160)}…` : x;
      };
      changes.push({
        id: randomUUID(), kind: "update", row: rowNo, key, dealId: deal.id, dealName: deal.codeName, companyName: deal.company?.name,
        field: f, from, to, fromLabel: label(from), toLabel: label(to),
      });
    }
  });

  // Deals that were in the sheet at the last review and aren't anymore.
  for (const d of allDeals) {
    if (d.sheetKey && !seen.has(d.sheetKey) && snap[d.sheetKey]?.exists) {
      changes.push({ id: randomUUID(), kind: "missing", key: d.sheetKey, dealId: d.id, dealName: d.codeName, companyName: d.company?.name,
        message: `"${d.codeName}" is no longer in the sheet. Nothing was changed on the deal.` });
    }
  }
  for (const s of unmappedStages) warn(`Stage "${s}" isn't mapped to a platform stage; those rows' stage was skipped. Map it in the sync settings.`);
  for (const l of unknownLeads) warn(`Lead "${l}" doesn't match anyone on the team; the lead was left as is.`);

  // Linking a deal to its row isn't a data change, so it happens right away.
  for (const k of keyUpdates) await db.update(deals).set({ sheetKey: k.key }).where(eq(deals.id, k.id));

  return { changes, snapshot: newSnap, rowCount, tab: tab.name };
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export type RunTrigger = "manual" | "cron" | "hook";

export async function runSync(syncId: string, trigger: RunTrigger, tabs?: SheetTab[]) {
  const [sync] = await db.select().from(sheetSyncs).where(eq(sheetSyncs.id, syncId)).limit(1);
  if (!sync) throw new Error("Sync not found");
  const startedAt = nowIso();
  await db.update(sheetSyncs).set({ lastRunAt: startedAt }).where(eq(sheetSyncs.id, syncId));
  const id = randomUUID();
  try {
    const { changes, snapshot, rowCount } = await computeChanges(sync, tabs);
    const actionable = changes.filter(c => c.kind === "update" || c.kind === "create").length;
    // A newer reading replaces a review nobody got to: it includes the same changes.
    await db.update(sheetSyncRuns).set({ status: "superseded", resolvedAt: startedAt })
      .where(and(eq(sheetSyncRuns.syncId, syncId), eq(sheetSyncRuns.status, "pending_review")));
    const status = actionable ? "pending_review" : "no_changes";
    await db.insert(sheetSyncRuns).values({
      id, syncId, trigger, status, rowCount, changes: JSON.stringify(changes), snapshot: JSON.stringify(snapshot), createdAt: startedAt,
    });
    // With nothing to approve, the reading becomes the new baseline right away.
    if (!actionable) await db.update(sheetSyncs).set({ snapshot: JSON.stringify(snapshot) }).where(eq(sheetSyncs.id, syncId));
    await db.update(sheetSyncs).set({ lastStatus: status, lastError: null }).where(eq(sheetSyncs.id, syncId));
    await pruneRuns(syncId);
    if (actionable) {
      await notify("all", "sheet", {
        title: `Google Sheet: ${actionable} change${actionable === 1 ? "" : "s"} to review`,
        body: "The deal tracker changed. Review and approve the changes.", url: "/deals/sync", tag: "sheet-sync",
      });
    }
    return { id, status, changes: actionable, rowCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.insert(sheetSyncRuns).values({ id, syncId, trigger, status: "error", error: message.slice(0, 1000), createdAt: startedAt });
    await db.update(sheetSyncs).set({ lastStatus: "error", lastError: message.slice(0, 1000) }).where(eq(sheetSyncs.id, syncId));
    return { id, status: "error", error: message, changes: 0, rowCount: 0 };
  }
}

async function pruneRuns(syncId: string) {
  const old = await db.select({ id: sheetSyncRuns.id }).from(sheetSyncRuns)
    .where(eq(sheetSyncRuns.syncId, syncId)).orderBy(desc(sheetSyncRuns.createdAt)).offset(60);
  if (old.length) await db.delete(sheetSyncRuns).where(inArray(sheetSyncRuns.id, old.map(o => o.id)));
}

const INTERVAL_MS: Record<string, number> = {
  immediate: 20 * 3600_000, // the daily cron also catches edits the hook missed
  daily: 20 * 3600_000,
  weekly: (6 * 24 + 20) * 3600_000,
  monthly: 27 * 24 * 3600_000,
};

export async function dueSyncs() {
  const rows = await db.select().from(sheetSyncs);
  const now = Date.now();
  return rows.filter(s => INTERVAL_MS[s.frequency] && (!s.lastRunAt || now - new Date(s.lastRunAt).getTime() >= INTERVAL_MS[s.frequency]));
}

// ── Applying ──────────────────────────────────────────────────────────────────

export async function applyRun(runId: string, selectedIds: string[] | null, user: { id: string; name: string }) {
  const [run] = await db.select().from(sheetSyncRuns).where(eq(sheetSyncRuns.id, runId)).limit(1);
  if (!run) throw new Error("Run not found");
  if (run.status !== "pending_review") throw new Error("These changes were already reviewed or replaced by a newer reading");
  const all = parseJson<ProposedChange[]>(run.changes, []);
  const chosen = all.filter(c => (c.kind === "update" || c.kind === "create") && (!selectedIds || selectedIds.includes(c.id)));
  const stages = await listStages();
  const now = nowIso();
  const label = "Google Sheet";
  let applied = 0;

  // Updates, grouped per deal.
  const byDeal = new Map<string, ProposedChange[]>();
  for (const c of chosen.filter(c => c.kind === "update" && c.dealId)) byDeal.set(c.dealId!, [...(byDeal.get(c.dealId!) ?? []), c]);
  for (const [dealId, list] of byDeal) {
    const deal = await db.query.deals.findFirst({ where: eq(deals.id, dealId) });
    if (!deal) continue;
    const set: Partial<typeof deals.$inferInsert> = { updatedAt: now };
    const notes: string[] = [];
    for (const c of list) {
      const to = c.to ?? null;
      if (c.field === "stage") {
        if (!to || !stages.some(s => s.key === to)) continue;
        set.stage = to; set.stageChangedAt = now;
      } else if (c.field === "onHold") set.onHold = to === "true";
      else if (c.field === "type") { if (to) set.type = to; else continue; }
      else if (c.field === "lead") set.leadUserId = to;
      else if (c.field === "dealSize") set.dealSize = to === null ? null : Number(to);
      else if (c.field === "currency") { if (to) set.currency = to.slice(0, 5); else continue; }
      else if (c.field === "statusNote") set.statusNote = to ? to.slice(0, 1000) : null;
      else if (c.field === "description") set.description = to ? to.slice(0, 4000) : null;
      else continue;
      notes.push(`${FIELD_TEXT[c.field!]}: ${c.fromLabel} → ${c.toLabel}`);
      applied++;
    }
    if (!notes.length) continue;
    if (deal.sheetKey !== list[0].key && list[0].key) set.sheetKey = list[0].key;
    await db.update(deals).set(set).where(eq(deals.id, dealId));
    if (set.leadUserId) await ensureLead(dealId, set.leadUserId);
    await logDeal(user.id, user.name, set.stage ? "deal_stage_changed" : "edited_deal", dealId, deal.codeName, `from ${label}: ${notes.join("; ")}`);
    if (set.stage) {
      const st = stages.find(s => s.key === set.stage)?.label ?? set.stage;
      await notifyDealTeam(dealId, user.id, { title: `${deal.codeName} → ${st}`, body: `Updated from the Google Sheet (approved by ${user.name}).` });
    }
  }

  // New deals (and their companies when the platform doesn't have them yet).
  for (const c of chosen.filter(c => c.kind === "create" && c.create)) {
    const x = c.create!;
    let companyId = x.companyId;
    if (companyId && !(await db.query.companies.findFirst({ where: eq(companies.id, companyId), columns: { id: true } }))) companyId = null;
    if (!companyId) {
      companyId = randomUUID();
      const name = x.company.slice(0, 200);
      await db.insert(companies).values({
        id: companyId, name, slug: `${slugify(name) || "company"}-${Date.now().toString(36)}`,
        sector: x.sector, country: x.country || "Mexico", status: "pipeline", createdBy: user.id, updatedBy: user.id,
      });
      await recordFieldChanges(companyId, { type: "import", label, userId: user.id, userName: user.name },
        [{ field: "name", oldValue: null, newValue: name }, { field: "sector", oldValue: null, newValue: x.sector }, { field: "country", oldValue: null, newValue: x.country }]);
    }
    const dealId = randomUUID();
    const lead = x.leadUserId ?? user.id;
    await db.insert(deals).values({
      id: dealId, companyId, codeName: x.codeName.slice(0, 120), type: x.type ?? "buy_side",
      stage: stages.some(s => s.key === x.stage) ? x.stage : stages[0]?.key ?? "sourcing", stageChangedAt: now,
      onHold: x.onHold, statusNote: x.statusNote?.slice(0, 1000) ?? null, leadUserId: lead,
      dealSize: x.dealSize, currency: x.currency ?? "USD", description: x.description?.slice(0, 4000) ?? null,
      sheetKey: c.key ?? null, createdBy: user.id, createdAt: now, updatedAt: now,
    });
    await db.insert(dealMembers).values({ id: randomUUID(), dealId, userId: lead, role: "lead", allocation: 40, createdAt: now });
    await logDeal(user.id, user.name, "created_deal", dealId, x.codeName, `from ${label} (row ${c.row})`);
    applied++;
  }

  await resolveRun(run, "applied", user.id, applied);
  return { applied };
}

export async function dismissRun(runId: string, userId: string) {
  const [run] = await db.select().from(sheetSyncRuns).where(eq(sheetSyncRuns.id, runId)).limit(1);
  if (!run) throw new Error("Run not found");
  if (run.status !== "pending_review") throw new Error("These changes were already reviewed or replaced by a newer reading");
  await resolveRun(run, "dismissed", userId, 0);
}

// Once reviewed, the sheet as read becomes the baseline: changes that were left
// unselected aren't proposed again unless the sheet changes them again.
async function resolveRun(run: typeof sheetSyncRuns.$inferSelect, status: "applied" | "dismissed", userId: string, appliedCount: number) {
  // Only the newest successful reading can be pending (newer ones supersede it), so it's safe to take its snapshot.
  await db.update(sheetSyncRuns).set({ status, resolvedBy: userId, resolvedAt: nowIso(), appliedCount }).where(eq(sheetSyncRuns.id, run.id));
  await db.update(sheetSyncs).set({ ...(run.snapshot ? { snapshot: run.snapshot } : {}), lastStatus: status }).where(eq(sheetSyncs.id, run.syncId));
}

async function ensureLead(dealId: string, userId: string) {
  const existing = await db.query.dealMembers.findFirst({ where: and(eq(dealMembers.dealId, dealId), eq(dealMembers.userId, userId)) });
  if (existing) await db.update(dealMembers).set({ role: "lead" }).where(eq(dealMembers.id, existing.id));
  else await db.insert(dealMembers).values({ id: randomUUID(), dealId, userId, role: "lead", allocation: 40, createdAt: nowIso() });
}

const FIELD_TEXT: Record<DealField, string> = {
  stage: "Stage", onHold: "Status", type: "Type", lead: "Lead", dealSize: "Size", currency: "Currency", statusNote: "Comments", description: "Description",
};

export function newHookToken() {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}
