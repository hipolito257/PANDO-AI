// Fundraising fed from a Google Sheet: one row per investor (or per contact —
// rows with the same investor name are that investor's people). Runs daily
// and on demand. A value from the sheet is applied when it changed in the
// sheet since the last sync, so edits made by hand in the platform stay until
// someone changes that cell in the sheet.
import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";
import { db, investors, investorContacts, investorSheetSyncs, users } from "@/lib/db";
import { downloadSheet, headersOf, norm, parseSheetUrl, parseSize, readWorkbook, type SheetTab } from "@/lib/sheetSync";

export const INVESTOR_SYNC_ID = "default";

export const INVESTOR_FIELDS = [
  { key: "name",          label: "Investor",              required: true, alias: ["investor", "inversionista", "inversor", "name", "nombre", "lp", "institution", "institucion", "firm", "firma", "entity", "entidad", "family office", "fondo", "fund", "empresa", "company", "organizacion", "organization"] },
  { key: "type",          label: "Type",                  alias: ["type", "tipo", "investor type", "tipo de inversionista", "category", "categoria", "segment", "segmento"] },
  { key: "stage",         label: "Stage",                 alias: ["stage", "etapa", "status", "estatus", "estado", "pipeline", "fase"] },
  { key: "country",       label: "Country",               alias: ["country", "pais"] },
  { key: "city",          label: "City",                  alias: ["city", "ciudad"] },
  { key: "website",       label: "Website",               alias: ["website", "web", "sitio", "sitio web", "url", "pagina"] },
  { key: "linkedinUrl",   label: "Investor LinkedIn",     alias: ["company linkedin", "linkedin empresa", "linkedin fondo", "linkedin investor"] },
  { key: "description",   label: "Description",           alias: ["description", "descripcion", "profile", "perfil", "about"] },
  { key: "aum",           label: "AUM",                   alias: ["aum", "assets under management", "activos", "activos bajo administracion"] },
  { key: "focus",         label: "Focus / strategy",      alias: ["focus", "strategy", "estrategia", "sectors", "sectores", "thesis", "tesis", "invests in", "invierte en", "asset classes"] },
  { key: "geographies",   label: "Geographies",           alias: ["geography", "geographies", "geografia", "region", "regiones", "regions"] },
  { key: "targetAmount",  label: "Ticket / target",       alias: ["ticket", "target", "target amount", "monto", "monto objetivo", "ask", "potential", "potential commitment", "compromiso potencial", "commitment target"] },
  { key: "committedAmount", label: "Committed",           alias: ["committed", "comprometido", "commitment", "compromiso", "committed amount", "monto comprometido"] },
  { key: "currency",      label: "Currency",              alias: ["currency", "moneda", "divisa"] },
  { key: "owner",         label: "Pando owner",           alias: ["owner", "responsable", "lead", "pando lead", "coverage", "relationship owner", "encargado"] },
  { key: "nextStep",      label: "Next step",             alias: ["next step", "next steps", "siguiente paso", "proximo paso", "siguientes pasos", "action", "accion"] },
  { key: "nextStepDate",  label: "Next step date",        alias: ["next step date", "fecha", "fecha siguiente paso", "follow up", "follow up date", "fecha seguimiento", "due date"] },
  { key: "notes",         label: "Notes",                 alias: ["notes", "notas", "comments", "comentarios", "observaciones"] },
  { key: "contactName",   label: "Contact name",          alias: ["contact", "contacto", "contact name", "nombre contacto", "nombre del contacto", "persona", "person", "key contact"] },
  { key: "contactRole",   label: "Contact role",          alias: ["role", "puesto", "cargo", "title", "position", "contact role", "contact title"] },
  { key: "contactEmail",  label: "Contact email",         alias: ["email", "correo", "mail", "e mail", "contact email", "correo electronico"] },
  { key: "contactPhone",  label: "Contact phone",         alias: ["phone", "telefono", "tel", "celular", "mobile", "movil", "whatsapp"] },
  { key: "contactLinkedin", label: "Contact LinkedIn",    alias: ["linkedin", "contact linkedin", "linkedin contacto"] },
] as const;

export type InvestorField = (typeof INVESTOR_FIELDS)[number]["key"];
export type InvestorColumnMap = Partial<Record<InvestorField, string>>;
const INV_KEYS = ["type", "stage", "country", "city", "website", "linkedinUrl", "description", "aum", "focus", "geographies",
  "targetAmount", "committedAmount", "currency", "owner", "nextStep", "nextStepDate", "notes"] as const;
const CONTACT_KEYS = ["contactRole", "contactEmail", "contactPhone", "contactLinkedin"] as const;

export function guessInvestorColumns(headers: string[]): InvestorColumnMap {
  const map: InvestorColumnMap = {};
  const used = new Set<string>();
  const hs = headers.map(h => ({ h, n: norm(h) }));
  for (const pass of ["exact", "contains"] as const) {
    for (const f of INVESTOR_FIELDS) {
      if (map[f.key]) continue;
      const hit = hs.find(({ h, n }) => !used.has(h) && n && (pass === "exact"
        ? (f.alias as readonly string[]).includes(n)
        : (f.alias as readonly string[]).some(a => a.length > 3 && (n.includes(a) || a.includes(n)))));
      if (hit) { map[f.key] = hit.h; used.add(hit.h); }
    }
  }
  return map;
}

export function guessInvestorHeaderRow(rows: string[][]): number {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i] ?? [];
    const filled = cells.filter(Boolean).length;
    if (filled < 2) continue;
    const hits = cells.filter(c => INVESTOR_FIELDS.some(f => (f.alias as readonly string[]).includes(norm(c)))).length;
    const s = hits * 10 + Math.min(filled, 9);
    if (s > bestScore) { best = i; bestScore = s; }
  }
  return best + 1;
}

const TYPE_WORDS: Record<string, string[]> = {
  family_office: ["family office", "fo", "familia", "family"],
  afore: ["afore", "pension", "pensiones", "siefore"],
  institutional: ["institutional", "institucional", "endowment", "sovereign", "soberano", "bank", "banco"],
  dfi: ["dfi", "development", "desarrollo", "multilateral", "ifc", "idb", "bid", "nafin", "fonadin", "cmic"],
  fund_of_funds: ["fund of funds", "fondo de fondos", "fof", "fdf"],
  insurance: ["insurance", "aseguradora", "seguros"],
  corporate: ["corporate", "corporativo", "strategic", "estrategico", "empresa"],
  hnwi: ["hnwi", "individual", "persona fisica", "angel", "uhnwi", "private"],
};
const STAGE_WORDS: Record<string, string[]> = {
  identified: ["identified", "identificado", "prospect", "prospecto", "target", "lead", "por contactar", "pending", "new", "nuevo"],
  contacted: ["contacted", "contactado", "outreach", "email sent", "correo enviado", "reached out"],
  meeting: ["meeting", "reunion", "first meeting", "primera reunion", "call", "llamada", "pitch", "intro"],
  diligence: ["diligence", "due diligence", "dd", "ddq", "revision", "analysis", "analisis", "data room"],
  soft_commit: ["soft commit", "soft", "verbal", "interesado", "interested", "lpa", "negotiation", "negociacion", "term sheet"],
  committed: ["committed", "comprometido", "closed", "cerrado", "signed", "firmado", "invested", "invirtio", "won"],
  declined: ["declined", "rechazado", "rechazo", "pass", "no", "lost", "perdido", "not interested", "no interesado", "descartado"],
};
function guessFrom(words: Record<string, string[]>, raw: string): string | null {
  const n = norm(raw);
  if (!n) return null;
  for (const [k, ws] of Object.entries(words)) if (ws.includes(n)) return k;
  for (const [k, ws] of Object.entries(words)) if (ws.some(w => w.length > 2 && n.includes(w))) return k;
  return null;
}
function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); // dd/mm/yyyy (Mexico)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

type SheetInvestor = { key: string; name: string; values: Partial<Record<(typeof INV_KEYS)[number], string>>; contacts: SheetContact[] };
type SheetContact = { key: string; name: string; values: Partial<Record<(typeof CONTACT_KEYS)[number], string>> };
type Snapshot = Record<string, { v: Record<string, string>; c: Record<string, Record<string, string>> }>;
export type SyncChange = { investor: string; field: string; from: string | null; to: string | null; kind: "created" | "updated" | "contact" };
export type SyncSummary = { rows: number; investors: number; created: number; updated: number; contacts: number; changes: SyncChange[]; notInSheet: string[] };

/** Groups the sheet's rows into investors (with their contacts). */
export function readInvestors(tab: SheetTab, headerRow: number, map: InvestorColumnMap): SheetInvestor[] {
  const headers = headersOf(tab, headerRow);
  const col = (f: InvestorField) => (map[f] ? headers.indexOf(map[f]!) : -1);
  const nameCol = col("name");
  if (nameCol < 0) throw new Error("Choose which column has the investor's name.");
  const out = new Map<string, SheetInvestor>();
  for (const row of tab.rows.slice(headerRow)) {
    const name = (row[nameCol] ?? "").trim();
    if (!name) continue;
    const key = norm(name);
    let inv = out.get(key);
    if (!inv) { inv = { key, name, values: {}, contacts: [] }; out.set(key, inv); }
    for (const f of INV_KEYS) {
      const c = col(f);
      const v = c >= 0 ? (row[c] ?? "").trim() : "";
      if (v && !inv.values[f]) inv.values[f] = v; // the first row that has it wins
    }
    const cName = col("contactName") >= 0 ? (row[col("contactName")] ?? "").trim() : "";
    if (cName) {
      const values: SheetContact["values"] = {};
      for (const f of CONTACT_KEYS) { const c = col(f); const v = c >= 0 ? (row[c] ?? "").trim() : ""; if (v) values[f] = v; }
      const cKey = norm(values.contactEmail || cName);
      if (!inv.contacts.some(x => x.key === cKey)) inv.contacts.push({ key: cKey, name: cName, values });
    }
  }
  return [...out.values()];
}

/** Reads the sheet and applies it to the Fundraising section. */
export async function runInvestorSync(trigger: "manual" | "cron"): Promise<SyncSummary> {
  const [sync] = await db.select().from(investorSheetSyncs).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID)).limit(1);
  if (!sync) throw new Error("Connect the Google Sheet first.");
  const now = new Date().toISOString();
  try {
    const tabs = await readWorkbook(await downloadSheet({ fileId: sync.fileId, kind: sync.fileKind as "gsheet" | "drive_file" }));
    const tab = tabs.find(t => t.name === sync.sheetName) ?? tabs[0];
    if (!tab) throw new Error("The file has no visible tabs.");
    const sheet = readInvestors(tab, sync.headerRow, JSON.parse(sync.columnMap || "{}"));
    const prev: Snapshot = sync.snapshot ? JSON.parse(sync.snapshot) : {};
    const summary = await applySheet(sheet, prev);
    summary.rows = Math.max(0, tab.rows.length - sync.headerRow);
    const snap: Snapshot = {};
    for (const s of sheet) snap[s.key] = { v: s.values as Record<string, string>, c: Object.fromEntries(s.contacts.map(c => [c.key, { name: c.name, ...c.values }])) };
    await db.update(investorSheetSyncs).set({
      snapshot: JSON.stringify(snap), lastRunAt: now, lastStatus: "ok", lastError: null,
      lastSummary: JSON.stringify({ ...summary, trigger, changes: summary.changes.slice(0, 300) }),
    }).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID));
    return summary;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "The sync failed";
    await db.update(investorSheetSyncs).set({ lastRunAt: now, lastStatus: "error", lastError: msg.slice(0, 500) }).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID));
    throw err;
  }
}

export async function applySheet(sheet: SheetInvestor[], prev: Snapshot): Promise<SyncSummary> {
  const [all, people, contacts] = await Promise.all([
    db.select().from(investors).orderBy(asc(investors.name)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users),
    db.select().from(investorContacts),
  ]);
  const summary: SyncSummary = { rows: 0, investors: sheet.length, created: 0, updated: 0, contacts: 0, changes: [], notInSheet: [] };
  const now = new Date().toISOString();
  const owner = (raw: string) => {
    const n = norm(raw);
    return people.find(p => norm(p.name) === n || norm(p.email) === n || norm(p.email.split("@")[0]) === n)
      ?? people.find(p => n && (norm(p.name).startsWith(n) || n.startsWith(norm(p.name).split(" ")[0] + " ")))
      ?? null;
  };
  // Sheet text → the value stored on the investor (null = can't read it, skip).
  const convert = (f: (typeof INV_KEYS)[number], raw: string): unknown => {
    switch (f) {
      case "type": return guessFrom(TYPE_WORDS, raw);
      case "stage": return guessFrom(STAGE_WORDS, raw);
      case "aum": case "targetAmount": case "committedAmount": return parseSize(raw, 1);
      case "currency": { const c = raw.toUpperCase().match(/USD|MXN|EUR|GBP|CAD/); return c ? c[0] : null; }
      case "owner": return owner(raw)?.id ?? null;
      case "nextStepDate": return parseDate(raw);
      default: return raw.slice(0, f === "notes" || f === "description" ? 4000 : 300);
    }
  };
  const column = (f: (typeof INV_KEYS)[number]) => (f === "owner" ? "ownerId" : f) as keyof typeof investors.$inferInsert;

  for (const s of sheet) {
    const was = prev[s.key];
    let inv = all.find(i => i.sheetKey === s.key) ?? all.find(i => norm(i.name) === s.key);
    if (!inv) {
      const values: Partial<typeof investors.$inferInsert> = {};
      for (const f of INV_KEYS) {
        const raw = s.values[f];
        if (!raw) continue;
        const v = convert(f, raw);
        if (v !== null && v !== undefined) (values as Record<string, unknown>)[column(f)] = v;
      }
      const id = randomUUID();
      await db.insert(investors).values({
        type: "family_office", stage: "identified", currency: "USD", ...values,
        id, name: s.name.slice(0, 160), sheetKey: s.key, stageChangedAt: now, createdBy: "sheet", createdAt: now, updatedAt: now,
      });
      inv = { id, name: s.name } as typeof all[number];
      summary.created++;
      summary.changes.push({ investor: s.name, field: "investor", from: null, to: "added from the sheet", kind: "created" });
    } else {
      const set: Partial<typeof investors.$inferInsert> = {};
      for (const f of INV_KEYS) {
        const raw = s.values[f];
        if (!raw || was?.v?.[f] === raw) continue; // unchanged in the sheet: keep what's in the platform
        const v = convert(f, raw);
        if (v === null || v === undefined) continue;
        const cur = (inv as Record<string, unknown>)[column(f)];
        if (cur === v) continue;
        (set as Record<string, unknown>)[column(f)] = v;
        summary.changes.push({ investor: inv.name, field: f, from: cur == null ? null : String(cur), to: String(v), kind: "updated" });
      }
      if (inv.sheetKey !== s.key) set.sheetKey = s.key;
      if (Object.keys(set).length) {
        if (set.stage && set.stage !== inv.stage) set.stageChangedAt = now;
        await db.update(investors).set({ ...set, updatedAt: now }).where(eq(investors.id, inv.id));
        if (Object.keys(set).some(k => k !== "sheetKey")) summary.updated++;
      }
    }

    // People at this investor
    const mine = contacts.filter(c => c.investorId === inv!.id);
    for (const sc of s.contacts) {
      const old = was?.c?.[sc.key];
      const email = sc.values.contactEmail?.toLowerCase() ?? null;
      const ex = mine.find(c => (email && c.email?.toLowerCase() === email) || norm(c.name) === norm(sc.name));
      const fields = { name: sc.name, role: sc.values.contactRole ?? null, email, phone: sc.values.contactPhone ?? null, linkedinUrl: sc.values.contactLinkedin ?? null };
      if (!ex) {
        await db.insert(investorContacts).values({ id: randomUUID(), investorId: inv.id, ...fields, isPrimary: mine.length === 0, source: "sheet", createdAt: now, updatedAt: now });
        mine.push({ id: "", investorId: inv.id, ...fields, notes: null, isPrimary: false, source: "sheet", createdAt: now, updatedAt: now });
        summary.contacts++;
        summary.changes.push({ investor: inv.name, field: "contact", from: null, to: sc.name, kind: "contact" });
      } else {
        const set: Record<string, string | null> = {};
        const pairs: [keyof typeof fields, string][] = [["role", "contactRole"], ["email", "contactEmail"], ["phone", "contactPhone"], ["linkedinUrl", "contactLinkedin"]];
        for (const [k, sk] of pairs) {
          const v = fields[k];
          if (!v || (old && old[sk] === (sc.values as Record<string, string>)[sk]) || ex[k] === v) continue;
          set[k] = v;
        }
        if (Object.keys(set).length) {
          await db.update(investorContacts).set({ ...set, updatedAt: now }).where(eq(investorContacts.id, ex.id));
          summary.changes.push({ investor: inv.name, field: "contact", from: ex.name, to: `${ex.name}: ${Object.keys(set).join(", ")} updated`, kind: "contact" });
        }
      }
    }
  }
  const inSheet = new Set(sheet.map(s => s.key));
  summary.notInSheet = all.filter(i => i.sheetKey && !inSheet.has(i.sheetKey)).map(i => i.name).slice(0, 50);
  return summary;
}

/** Connects (or reconnects) the sheet: reads it and guesses the header row and columns. */
export async function connectInvestorSheet(url: string, userId: string, sheetName?: string | null) {
  const ref = parseSheetUrl(url);
  if (!ref) throw new Error("Paste the link of a Google Sheet (or an Excel file in Google Drive).");
  const tabs = await readWorkbook(await downloadSheet(ref));
  if (!tabs.length) throw new Error("The file has no visible tabs.");
  const tab = tabs.find(t => t.name === sheetName) ?? tabs[0];
  const headerRow = guessInvestorHeaderRow(tab.rows);
  const headers = headersOf(tab, headerRow);
  const columnMap = guessInvestorColumns(headers);
  const values = { sourceUrl: url, fileId: ref.fileId, fileKind: ref.kind, sheetName: tab.name, headerRow, columnMap: JSON.stringify(columnMap) };
  const [exists] = await db.select({ id: investorSheetSyncs.id, fileId: investorSheetSyncs.fileId }).from(investorSheetSyncs).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID)).limit(1);
  if (exists) await db.update(investorSheetSyncs).set({ ...values, ...(exists.fileId !== ref.fileId ? { snapshot: null } : {}) }).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID));
  else await db.insert(investorSheetSyncs).values({ id: INVESTOR_SYNC_ID, ...values, createdBy: userId, createdAt: new Date().toISOString() });
  return { tabs: tabs.map(t => t.name), headers, columnMap, headerRow, sheetName: tab.name };
}

/** Headers of the connected tab (for the column mapping screen). */
export async function investorSheetHeaders() {
  const [sync] = await db.select().from(investorSheetSyncs).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID)).limit(1);
  if (!sync) return null;
  const tabs = await readWorkbook(await downloadSheet({ fileId: sync.fileId, kind: sync.fileKind as "gsheet" | "drive_file" }));
  const tab = tabs.find(t => t.name === sync.sheetName) ?? tabs[0];
  return { tabs: tabs.map(t => t.name), headers: tab ? headersOf(tab, sync.headerRow) : [], sample: tab ? tab.rows.slice(sync.headerRow, sync.headerRow + 3) : [] };
}

