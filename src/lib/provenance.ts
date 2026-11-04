// Provenance: record where each company data point came from.
// Every write path (manual edit, document extraction, AI research, radar)
// calls recordFieldChanges with the old and new values; unchanged values are
// skipped. Recording never blocks or fails the write itself.
import { randomUUID } from "crypto";
import { db, fieldChanges } from "@/lib/db";

export type SourceType = "manual" | "document" | "ai_web" | "radar" | "import";

export type Source = {
  type: SourceType;
  ref?: string | null;     // CompanyFile id for documents
  label?: string | null;   // human label, e.g. "deck.pdf"
  userId?: string | null;
  userName?: string | null;
};

export type Change = {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  label?: string | null;   // per-field override of source.label, e.g. "deck.pdf · Slide 12"
  note?: string | null;
};

// Company columns whose history we keep (score is recomputed constantly, so it's left out).
export const TRACKED_FIELDS = [
  "name", "sector", "subsector", "country", "city", "stage", "website", "linkedinUrl", "description",
  "revenueUsd", "revenueGrowth", "ebitdaUsd", "ebitdaMargin", "employees", "employeeGrowth",
  "totalFunding", "lastFundingAmt", "lastFundingDate", "fundingStage", "status",
] as const;

const asText = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  return String(v).slice(0, 4000);
};

const same = (a: string | null, b: string | null) => {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const na = Number(a), nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) < 1e-9 * Math.max(1, Math.abs(na));
};

export async function recordFieldChanges(companyId: string, source: Source, changes: Change[]): Promise<number> {
  const now = new Date().toISOString();
  const rows = changes.flatMap(c => {
    const oldValue = asText(c.oldValue), newValue = asText(c.newValue);
    if (same(oldValue, newValue)) return [];
    return [{
      id: randomUUID(), companyId, field: c.field, oldValue, newValue,
      sourceType: source.type, sourceRef: source.ref ?? null,
      sourceLabel: (c.label ?? source.label ?? null)?.slice(0, 300) ?? null,
      note: c.note?.slice(0, 1000) || null,
      userId: source.userId ?? null, userName: source.userName ?? null, createdAt: now,
    }];
  });
  if (!rows.length) return 0;
  try {
    await db.insert(fieldChanges).values(rows);
  } catch (err) {
    console.error("[provenance] could not record changes", err);
    return 0;
  }
  return rows.length;
}

// Diff a company row against an update object, over the tracked columns.
export function diffCompany(before: Record<string, unknown>, update: Record<string, unknown>, perField?: Record<string, { label?: string; note?: string }>): Change[] {
  return TRACKED_FIELDS.filter(f => f in update).map(f => ({
    field: f, oldValue: before[f], newValue: update[f], label: perField?.[f]?.label, note: perField?.[f]?.note,
  }));
}
