// Fundraising fed from a workbook (Google Sheet or Excel in Drive), all tabs.
// How each tab is read comes from a plan the platform works out itself
// (src/lib/investorSheetPlan.ts) and redoes when the workbook's layout changes.
// A value is applied when it changed in the sheet since the last sync, so edits
// made by hand in the platform stay until someone changes that cell in the sheet.
import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";
import { db, investors, investorContacts, investorSheetSyncs, users } from "@/lib/db";
import { downloadSheet, norm, parseSheetUrl, parseSize, readWorkbook, type SheetTab } from "@/lib/sheetSync";
import { INVESTOR_STAGES, INVESTOR_TYPES } from "@/lib/fundraising";
import {
  PLAN_FIELDS, STAGE_WORDS, TYPE_WORDS, classifyTypes, fingerprint, guessFrom, makePlan, makeValueMap, validatePlan,
  type PlanField, type SheetPlan, type TabPlan, type ValueMap,
} from "@/lib/investorSheetPlan";

export const INVESTOR_SYNC_ID = "default";
export const INVESTOR_FIELDS = PLAN_FIELDS;

const INV_KEYS = ["type", "stage", "country", "city", "website", "linkedinUrl", "description", "aum", "focus", "geographies",
  "targetAmount", "committedAmount", "currency", "owner", "nextStep", "nextStepDate", "notes"] as const;
const CONTACT_KEYS = ["contactRole", "contactEmail", "contactPhone", "contactLinkedin"] as const;
type InvKey = (typeof INV_KEYS)[number];

type SheetContact = { key: string; name: string; values: Partial<Record<(typeof CONTACT_KEYS)[number], string>> };
export type SheetInvestor = { key: string; name: string; values: Partial<Record<InvKey, string>>; contacts: SheetContact[]; tabs: string[]; guessType?: string };
type Snapshot = Record<string, { v: Record<string, string>; c: Record<string, Record<string, string>> }>;
export type SyncChange = { investor: string; field: string; from: string | null; to: string | null; kind: "created" | "updated" | "contact" };
export type SyncSummary = { rows: number; investors: number; created: number; updated: number; contacts: number; tabs: string[]; changes: SyncChange[]; notInSheet: string[] };

function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); // dd/mm/yyyy (Mexico)
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Reads every used tab with its plan and merges them into investors (with their people). */
export function readWorkbookInvestors(tabs: SheetTab[], plan: SheetPlan): { list: SheetInvestor[]; rows: number } {
  const out = new Map<string, SheetInvestor>();
  let rows = 0;
  for (const tp of plan.tabs.filter(t => t.use && t.columns.name)) {
    const tab = tabs.find(t => t.name === tp.name);
    if (!tab) continue;
    const at = (row: string[], f: PlanField) => { const c = tp.columns[f]; return c ? String(row?.[c - 1] ?? "").trim() : ""; };
    for (const row of tab.rows.slice(tp.headerRow)) {
      const name = at(row, "name");
      if (!name || name.length > 160) continue;
      rows++;
      const key = norm(name);
      let inv = out.get(key);
      if (!inv) { inv = { key, name, values: {}, contacts: [], tabs: [] }; out.set(key, inv); }
      if (!inv.tabs.includes(tp.name)) inv.tabs.push(tp.name);
      for (const f of INV_KEYS) {
        const v = at(row, f);
        if (v && !inv.values[f]) inv.values[f] = v; // the first row / tab that has it wins
      }
      // A tab that is one type or one stage ("AFOREs", "Committed") gives it to its rows.
      if (tp.type && !inv.values.type) inv.values.type = tp.type;
      if (tp.stage && !inv.values.stage) inv.values.stage = tp.stage;
      const cName = at(row, "contactName");
      if (cName) {
        const values: SheetContact["values"] = {};
        for (const f of CONTACT_KEYS) { const v = at(row, f); if (v) values[f] = v; }
        const cKey = norm(values.contactEmail || cName);
        if (!inv.contacts.some(x => x.key === cKey)) inv.contacts.push({ key: cKey, name: cName, values });
      }
    }
  }
  return { list: [...out.values()], rows };
}

async function loadSync() {
  const [sync] = await db.select().from(investorSheetSyncs).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID)).limit(1);
  return sync ?? null;
}
const readTabs = (fileId: string, kind: string) => downloadSheet({ fileId, kind: kind as "gsheet" | "drive_file" }).then(readWorkbook);

/** The plan for these tabs: the saved one if the layout hasn't changed, otherwise a new one. */
async function ensurePlan(sync: NonNullable<Awaited<ReturnType<typeof loadSync>>>, tabs: SheetTab[], apiKey: string | null, force = false) {
  const fp = fingerprint(tabs);
  let plan: SheetPlan | null = sync.plan ? JSON.parse(sync.plan) : null;
  let valueMap: ValueMap | null = sync.valueMap ? JSON.parse(sync.valueMap) : null;
  const layoutChanged = sync.planFingerprint !== fp;
  if (force || !plan || (layoutChanged && plan.by !== "manual")) {
    plan = await makePlan(tabs, apiKey);
  } else if (layoutChanged) {
    plan = validatePlan(plan, tabs, "manual"); // keep the team's adjustments, drop what no longer fits
  }
  valueMap = await makeValueMap(plan, tabs, apiKey, force ? null : valueMap);
  await db.update(investorSheetSyncs).set({ plan: JSON.stringify(plan), planFingerprint: fp, valueMap: JSON.stringify(valueMap) })
    .where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID));
  return { plan, valueMap };
}

/** Reads the workbook and applies it to the Fundraising section. */
export async function runInvestorSync(trigger: "manual" | "cron", apiKey: string | null = process.env.ANTHROPIC_API_KEY ?? null, opts: { replan?: boolean } = {}): Promise<SyncSummary> {
  const sync = await loadSync();
  if (!sync) throw new Error("Connect the Google Sheet first.");
  const now = new Date().toISOString();
  try {
    const tabs = await readTabs(sync.fileId, sync.fileKind);
    if (!tabs.length) throw new Error("The file has no visible tabs.");
    const { plan, valueMap } = await ensurePlan(sync, tabs, apiKey, opts.replan);
    const { list, rows } = readWorkbookInvestors(tabs, plan);
    // No type in the file: let AI work it out from the name (asked once per investor, then remembered).
    const guessed = { ...(valueMap.guessed ?? {}) };
    const missing = list.filter(i => !i.values.type && !guessed[i.key]);
    if (missing.length && apiKey) {
      Object.assign(guessed, await classifyTypes(missing.map(i => ({ key: i.key, name: i.name, country: i.values.country, city: i.values.city, notes: i.values.notes ?? i.values.focus })), apiKey));
      valueMap.guessed = guessed;
      await db.update(investorSheetSyncs).set({ valueMap: JSON.stringify(valueMap) }).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID));
    }
    for (const i of list) if (!i.values.type && guessed[i.key]) i.guessType = guessed[i.key];
    if (!list.length) throw new Error("No investors were found in the file. Check how the tabs were read below.");
    const prev: Snapshot = sync.snapshot ? JSON.parse(sync.snapshot) : {};
    const summary = await applySheet(list, prev, valueMap);
    summary.rows = rows;
    summary.tabs = plan.tabs.filter(t => t.use).map(t => t.name);
    const snap: Snapshot = {};
    for (const s of list) snap[s.key] = { v: s.values as Record<string, string>, c: Object.fromEntries(s.contacts.map(c => [c.key, { name: c.name, ...c.values }])) };
    await db.update(investorSheetSyncs).set({
      snapshot: JSON.stringify(snap), lastRunAt: now, lastStatus: "ok", lastError: null,
      lastSummary: JSON.stringify({ ...summary, trigger, changes: summary.changes.slice(0, 400) }),
    }).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID));
    return summary;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "The sync failed";
    await db.update(investorSheetSyncs).set({ lastRunAt: now, lastStatus: "error", lastError: msg.slice(0, 500) }).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID));
    throw err;
  }
}

export async function applySheet(sheet: SheetInvestor[], prev: Snapshot, valueMap: ValueMap = { stage: {}, type: {} }): Promise<SyncSummary> {
  const [all, people, contacts] = await Promise.all([
    db.select().from(investors).orderBy(asc(investors.name)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users),
    db.select().from(investorContacts),
  ]);
  const summary: SyncSummary = { rows: 0, investors: sheet.length, created: 0, updated: 0, contacts: 0, tabs: [], changes: [], notInSheet: [] };
  const now = new Date().toISOString();
  const owner = (raw: string) => {
    const n = norm(raw);
    return people.find(p => norm(p.name) === n || norm(p.email) === n || norm(p.email.split("@")[0]) === n)
      ?? people.find(p => n && (norm(p.name).startsWith(n) || n.startsWith(norm(p.name).split(" ")[0] + " ")))
      ?? null;
  };
  const typeKeys = INVESTOR_TYPES.map(t => t.key) as string[];
  const stageKeys = INVESTOR_STAGES.map(s => s.key) as string[];
  // Sheet text → the value stored on the investor (null = can't read it, skip).
  const convert = (f: InvKey, raw: string): unknown => {
    switch (f) {
      case "type": return typeKeys.includes(raw) ? raw : valueMap.type[norm(raw)] || guessFrom(TYPE_WORDS, raw);
      case "stage": return stageKeys.includes(raw) ? raw : valueMap.stage[norm(raw)] || guessFrom(STAGE_WORDS, raw);
      case "aum": case "targetAmount": case "committedAmount": return parseSize(raw, 1);
      case "currency": { const c = raw.toUpperCase().match(/USD|MXN|EUR|GBP|CAD/); return c ? c[0] : null; }
      case "owner": return owner(raw)?.id ?? null;
      case "nextStepDate": return parseDate(raw);
      default: return raw.slice(0, f === "notes" || f === "description" ? 4000 : f === "focus" ? 1000 : 300);
    }
  };
  const column = (f: InvKey) => (f === "owner" ? "ownerId" : f) as keyof typeof investors.$inferInsert;

  for (const s of sheet) {
    const was = prev[s.key];
    let inv = all.find(i => i.sheetKey === s.key) ?? all.find(i => norm(i.name) === s.key);
    if (!inv) {
      const values: Partial<typeof investors.$inferInsert> = {};
      for (const f of INV_KEYS) {
        const raw = s.values[f];
        if (!raw) continue;
        const v = convert(f, raw);
        if (v !== null && v !== undefined && v !== "") (values as Record<string, unknown>)[column(f)] = v;
      }
      if (!values.type && s.guessType) values.type = s.guessType;
      const id = randomUUID();
      await db.insert(investors).values({
        type: "family_office", stage: "identified", currency: "USD", ...values,
        id, name: s.name.slice(0, 160), sheetKey: s.key, stageChangedAt: now, createdBy: "sheet", createdAt: now, updatedAt: now,
      });
      inv = { id, name: s.name } as typeof all[number];
      all.push(inv);
      summary.created++;
      summary.changes.push({ investor: s.name, field: "investor", from: null, to: `added from ${s.tabs.join(", ")}`, kind: "created" });
    } else {
      const set: Partial<typeof investors.$inferInsert> = {};
      for (const f of INV_KEYS) {
        const raw = s.values[f];
        if (!raw || was?.v?.[f] === raw) continue; // unchanged in the sheet: keep what's in the platform
        const v = convert(f, raw);
        if (v === null || v === undefined || v === "") continue;
        const cur = (inv as Record<string, unknown>)[column(f)];
        if (cur === v) continue;
        (set as Record<string, unknown>)[column(f)] = v;
        summary.changes.push({ investor: inv.name, field: f, from: cur == null ? null : String(cur), to: String(v), kind: "updated" });
      }
      // Still on the default type and the file has none: use the type AI worked out.
      if (!s.values.type && s.guessType && inv.type === "family_office" && s.guessType !== "family_office" && !set.type) {
        set.type = s.guessType;
        summary.changes.push({ investor: inv.name, field: "type (AI)", from: inv.type, to: s.guessType, kind: "updated" });
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
      const fields = { name: sc.name.slice(0, 120), role: sc.values.contactRole ?? null, email, phone: sc.values.contactPhone ?? null, linkedinUrl: sc.values.contactLinkedin ?? null };
      if (!ex) {
        await db.insert(investorContacts).values({ id: randomUUID(), investorId: inv.id, ...fields, isPrimary: mine.length === 0, source: "sheet", createdAt: now, updatedAt: now });
        mine.push({ id: "", investorId: inv.id, ...fields, notes: null, isPrimary: false, source: "sheet", createdAt: now, updatedAt: now });
        summary.contacts++;
        summary.changes.push({ investor: inv.name, field: "contact", from: null, to: sc.name, kind: "contact" });
      } else if (ex.id) {
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

/** Connects the workbook, works out how to read it and syncs right away. */
export async function connectInvestorSheet(url: string, userId: string, apiKey: string | null) {
  const ref = parseSheetUrl(url);
  if (!ref) throw new Error("Paste the link of a Google Sheet (or an Excel file in Google Drive).");
  const tabs = await readWorkbook(await downloadSheet(ref));
  if (!tabs.length) throw new Error("The file has no visible tabs.");
  const sync = await loadSync();
  const values = { sourceUrl: url, fileId: ref.fileId, fileKind: ref.kind, sheetName: null, plan: null, planFingerprint: null, valueMap: null };
  if (sync) await db.update(investorSheetSyncs).set({ ...values, ...(sync.fileId !== ref.fileId ? { snapshot: null } : {}) }).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID));
  else await db.insert(investorSheetSyncs).values({ id: INVESTOR_SYNC_ID, ...values, createdBy: userId, createdAt: new Date().toISOString() });
  return runInvestorSync("manual", apiKey);
}

/** Saves the team's adjustments to how the tabs are read. */
export async function saveInvestorPlan(raw: unknown) {
  const sync = await loadSync();
  if (!sync) throw new Error("Connect the Google Sheet first.");
  const tabs = await readTabs(sync.fileId, sync.fileKind);
  const plan = validatePlan({ ...(raw as object), summary: sync.plan ? JSON.parse(sync.plan).summary : "" }, tabs, "manual");
  await db.update(investorSheetSyncs).set({ plan: JSON.stringify(plan), planFingerprint: fingerprint(tabs) }).where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID));
  return plan;
}

/** Each tab's titles and first rows, for the "how your file was read" screen. */
export async function investorSheetTabs() {
  const sync = await loadSync();
  if (!sync) return null;
  const tabs = await readTabs(sync.fileId, sync.fileKind);
  const plan: SheetPlan | null = sync.plan ? JSON.parse(sync.plan) : null;
  return tabs.map(t => {
    const tp: TabPlan | undefined = plan?.tabs.find(x => x.name === t.name);
    const headerRow = tp?.headerRow ?? 1;
    const width = Math.max(...t.rows.slice(0, 40).map(r => r?.length ?? 0), 0);
    const header = Array.from({ length: width }, (_, i) => String(t.rows[headerRow - 1]?.[i] ?? "").trim());
    return { name: t.name, rows: t.rows.length, headers: header.map((h, i) => h || `Column ${i + 1}`), sample: t.rows.slice(headerRow, headerRow + 2).map(r => Array.from({ length: width }, (_, i) => String(r?.[i] ?? "").slice(0, 40))) };
  });
}
