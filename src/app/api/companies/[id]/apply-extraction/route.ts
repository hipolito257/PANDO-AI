import { NextRequest, NextResponse } from "next/server";
import { db, companies, financialSnapshots, founders, activityLog, companyFiles } from "@/lib/db";
import { resolveTicker, addCompsToCompany } from "@/lib/companyComps";
import type { ExtractedComparable } from "@/lib/companyFileExtract";
import { auth } from "@/lib/auth";
import { EXTRACTABLE_FIELDS, NUMERIC_FIELDS } from "@/lib/companyFileExtract";
import { SECTORS, COUNTRIES, STAGES, FUNDING_STAGES } from "@/lib/companyOptions";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// Resolving comparables against Yahoo Finance can take a few seconds each.
export const maxDuration = 120;

type Body = {
  fields?: Record<string, string>;
  financials?: { year: number; revenueUsd: number | null; ebitdaUsd: number | null; employees: number | null }[];
  founders?: { name: string; title?: string; bio?: string }[];
  comparables?: ExtractedComparable[];
  fileId?: string;
  fileName?: string;
};

function compNote(c: ExtractedComparable, fileName?: string): string {
  const figs = [
    c.ev_ebitda != null ? `EV/EBITDA ${c.ev_ebitda}x` : null,
    c.ev_revenue != null ? `EV/Revenue ${c.ev_revenue}x` : null,
    c.pe != null ? `P/E ${c.pe}x` : null,
    c.revenue_growth != null ? `revenue growth ${c.revenue_growth}%` : null,
    c.ebitda_margin != null ? `EBITDA margin ${c.ebitda_margin}%` : null,
  ].filter(Boolean);
  const where = [fileName ? `"${fileName}"` : "a company document", c.source].filter(Boolean).join(", ");
  return `Named in ${where}${c.relation ? ` as ${c.relation}` : ""}.${figs.length ? ` Document figures${c.as_of ? ` (${c.as_of})` : ""}: ${figs.join(" · ")}.` : ""}`;
}

const INTEGER_FIELDS = new Set(["employees"]);
const CHOICES: Record<string, string[]> = { sector: SECTORS, country: COUNTRIES, stage: STAGES, fundingStage: FUNDING_STAGES };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// POST — apply the values the user accepted from a file extraction.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as Body;
  const company = await db.query.companies.findFirst({ where: eq(companies.id, id) });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  // ── Profile fields ──
  const update: Record<string, string | number> = {};
  for (const [field, raw] of Object.entries(body.fields ?? {})) {
    if (!(EXTRACTABLE_FIELDS as readonly string[]).includes(field) || typeof raw !== "string" || !raw.trim()) continue;
    if (CHOICES[field] && !CHOICES[field].includes(raw)) continue;
    if (NUMERIC_FIELDS.has(field)) {
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      update[field] = INTEGER_FIELDS.has(field) ? Math.round(n) : n;
    } else {
      update[field] = raw.trim().slice(0, 2000);
    }
  }

  try {
    if (Object.keys(update).length) {
      await db.update(companies)
        .set({ ...update, updatedAt: new Date().toISOString(), updatedBy: session.user.id })
        .where(eq(companies.id, id));
    }

    // ── Yearly financials (upsert on company + year, annual rows only) ──
    let snapshotsSaved = 0;
    for (const f of body.financials ?? []) {
      const year = Number(f.year);
      if (!Number.isInteger(year) || year < 1990 || year > 2100) continue;
      const employees = num(f.employees);
      const values = {
        revenueUsd: num(f.revenueUsd),
        ebitdaUsd: num(f.ebitdaUsd),
        employees: employees === null ? null : Math.round(employees),
      };
      const existing = await db.query.financialSnapshots.findFirst({
        where: and(eq(financialSnapshots.companyId, id), eq(financialSnapshots.year, year), eq(financialSnapshots.quarter, 0)),
      });
      if (existing) {
        // Only overwrite what the document provided.
        const patch = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));
        if (Object.keys(patch).length) await db.update(financialSnapshots).set(patch).where(eq(financialSnapshots.id, existing.id));
      } else {
        await db.insert(financialSnapshots).values({ id: randomUUID(), companyId: id, year, quarter: 0, ...values });
      }
      snapshotsSaved++;
    }

    // ── Founders (add the ones not already on the profile) ──
    let foundersAdded = 0;
    if (body.founders?.length) {
      const existing = await db.query.founders.findMany({ where: eq(founders.companyId, id) });
      const names = new Set(existing.map(f => f.name.trim().toLowerCase()));
      for (const f of body.founders) {
        const name = f.name?.trim();
        if (!name || names.has(name.toLowerCase())) continue;
        await db.insert(founders).values({
          id: randomUUID(), companyId: id, name: name.slice(0, 200),
          title: f.title?.trim().slice(0, 200) || null, bio: f.bio?.trim().slice(0, 1000) || null,
        });
        names.add(name.toLowerCase());
        foundersAdded++;
      }
    }

    // ── Public comparables named in the document → the company's comp set ──
    let compsAdded: string[] = [];
    const compsUnresolved: string[] = [];
    if (body.comparables?.length) {
      const resolved = [];
      for (const c of body.comparables.slice(0, 25)) {
        if (!c?.name?.trim()) continue;
        const quote = await resolveTicker(c.name, c.ticker ?? "", c.exchange ?? "");
        if (quote) resolved.push({ quote, note: compNote(c, body.fileName) });
        else compsUnresolved.push(c.name);
      }
      compsAdded = await addCompsToCompany(id, company.name, resolved);
    }

    // Remember what this document contributed, for the company's Documents section.
    if (body.fileId) {
      const file = await db.query.companyFiles.findFirst({ where: and(eq(companyFiles.id, body.fileId), eq(companyFiles.companyId, id)) });
      if (file?.extraction) {
        const x = JSON.parse(file.extraction);
        x.applied = {
          at: new Date().toISOString(),
          fields: Object.keys(update).length, years: snapshotsSaved, founders: foundersAdded, comps: compsAdded.length,
        };
        await db.update(companyFiles).set({ extraction: JSON.stringify(x) }).where(eq(companyFiles.id, file.id));
      }
    }

    try {
      await db.insert(activityLog).values({
        id: randomUUID(), userId: session.user.id, userName: session.user.name ?? session.user.email ?? "User",
        action: "applied_file_extraction", entityType: "company", entityId: id, entityName: company.name,
        detail: `${Object.keys(update).length} field(s), ${snapshotsSaved} year(s), ${foundersAdded} founder(s), ${compsAdded.length} comp(s)${body.fileName ? ` from ${body.fileName}` : ""}`,
      });
    } catch { /* non-blocking */ }

    return NextResponse.json({ ok: true, fieldsUpdated: Object.keys(update).length, snapshotsSaved, foundersAdded, compsAdded, compsUnresolved });
  } catch (err) {
    console.error("[apply-extraction]", err);
    return NextResponse.json({ error: "Failed to apply changes" }, { status: 500 });
  }
}
