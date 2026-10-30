// Keeps a company's comp set in sync with the listed comparables its uploaded
// documents name. Each document is processed once (extraction.compsSynced).
import { db, companies, companyFiles } from "@/lib/db";
import { decryptBuffer } from "@/lib/blobCrypto";
import { extractCompanyData, EXTRACTABLE_FIELDS, type ExtractionResult, type ExtractedComparable } from "@/lib/companyFileExtract";
import { resolveTicker, addCompsToCompany } from "@/lib/companyComps";
import { eq } from "drizzle-orm";

type StoredExtraction = ExtractionResult & { applied?: unknown; compsSynced?: string };
type FileRow = typeof companyFiles.$inferSelect;

function compNote(c: ExtractedComparable, fileName: string): string {
  const figs = [
    c.ev_ebitda != null ? `EV/EBITDA ${c.ev_ebitda}x` : null,
    c.ev_revenue != null ? `EV/Revenue ${c.ev_revenue}x` : null,
    c.pe != null ? `P/E ${c.pe}x` : null,
    c.revenue_growth != null ? `revenue growth ${c.revenue_growth}%` : null,
    c.ebitda_margin != null ? `EBITDA margin ${c.ebitda_margin}%` : null,
  ].filter(Boolean);
  const where = [`"${fileName}"`, c.source].filter(Boolean).join(", ");
  return `Named in ${where}${c.relation ? ` as ${c.relation}` : ""}.${figs.length ? ` Document figures${c.as_of ? ` (${c.as_of})` : ""}: ${figs.join(" · ")}.` : ""}`;
}

/** Adds the comparables of one extracted document to the company's comp set and marks it synced. */
export type FileCompsReport = { file: string; found: string[]; added: string[]; already: string[]; unresolved: string[]; error?: string };

export async function syncFileComps(file: FileRow, extraction: StoredExtraction, companyName: string): Promise<FileCompsReport> {
  const resolved = [];
  const unresolved: string[] = [];
  for (const c of (extraction.comparables ?? []).slice(0, 25)) {
    if (!c?.name?.trim()) continue;
    const quote = await resolveTicker(c.name, c.ticker ?? "", c.exchange ?? "");
    if (quote) resolved.push({ quote, note: compNote(c, file.filename) });
    else unresolved.push(c.name);
  }
  const added = await addCompsToCompany(file.companyId, companyName, resolved);
  extraction.compsSynced = new Date().toISOString();
  await db.update(companyFiles).set({ extraction: JSON.stringify(extraction) }).where(eq(companyFiles.id, file.id));
  return {
    file: file.filename,
    found: (extraction.comparables ?? []).map(c => c.ticker ? `${c.name} (${c.ticker})` : c.name),
    added,
    already: resolved.map(r => r.quote.ticker).filter(t => !added.includes(t)),
    unresolved,
  };
}

/**
 * Brings every document of the company into its comp set: documents extracted
 * before comparables were detected (or never extracted) are extracted now.
 * Processes at most `maxExtractions` new extractions per call to stay within
 * the request time limit; `pending` tells the caller to call again.
 */
export async function syncCompanyDocumentComps(companyId: string, apiKey: string | null, opts: { force?: boolean; maxExtractions?: number } = {}): Promise<{
  reports: FileCompsReport[]; pending: number; documents: number;
}> {
  const company = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
  if (!company) return { reports: [], pending: 0, documents: 0 };
  const files = await db.query.companyFiles.findMany({ where: eq(companyFiles.companyId, companyId) });

  const reports: FileCompsReport[] = [];
  let extractionsLeft = opts.maxExtractions ?? 2;
  let pending = 0;

  for (const f of files) {
    let x: StoredExtraction | null = null;
    try { x = f.extraction ? JSON.parse(f.extraction) : null; } catch { x = null; }
    if (x?.compsSynced && !opts.force) continue;

    if (!x || x.comparables === undefined) {
      if (!apiKey) { reports.push({ file: f.filename, found: [], added: [], already: [], unresolved: [], error: "No Anthropic API key configured to analyse it" }); continue; }
      if (extractionsLeft <= 0) { pending++; continue; }
      extractionsLeft--;
      try {
        const res = await fetch(f.blobUrl);
        if (!res.ok) throw new Error(`Could not read the stored file (${res.status})`);
        const buffer = decryptBuffer(Buffer.from(await res.arrayBuffer()));
        const current = Object.fromEntries(EXTRACTABLE_FIELDS.map(k => [k, (company as Record<string, unknown>)[k]]));
        const fresh = await extractCompanyData({ apiKey, buffer, ext: f.ext, filename: f.filename, companyName: company.name, current });
        // Keep what was already applied from the earlier extraction.
        x = { ...fresh, ...(x?.applied ? { applied: x.applied } : {}) };
        await db.update(companyFiles).set({
          extractionStatus: "done", extraction: JSON.stringify(x), extractionError: null,
          extractionCostUsd: fresh.usage?.costUsd ?? null, extractedAt: new Date().toISOString(),
        }).where(eq(companyFiles.id, f.id));
      } catch (err) {
        console.error("[syncCompanyDocumentComps] extraction failed", f.filename, err);
        reports.push({ file: f.filename, found: [], added: [], already: [], unresolved: [], error: err instanceof Error ? err.message : "Analysis failed" });
        continue;
      }
    }

    try {
      reports.push(await syncFileComps(f, x, company.name));
    } catch (err) {
      console.error("[syncCompanyDocumentComps] comps sync failed", f.filename, err);
      reports.push({ file: f.filename, found: [], added: [], already: [], unresolved: [], error: err instanceof Error ? err.message : "Could not add comparables" });
    }
  }
  return { reports, pending, documents: files.length };
}
