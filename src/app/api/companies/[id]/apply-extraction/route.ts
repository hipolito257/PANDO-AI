import { NextRequest, NextResponse } from "next/server";
import { db, companies, financialSnapshots, founders, activityLog, companyFiles } from "@/lib/db";
import { auth } from "@/lib/auth";
import { EXTRACTABLE_FIELDS, NUMERIC_FIELDS } from "@/lib/companyFileExtract";
import { SECTORS, COUNTRIES, STAGES, FUNDING_STAGES } from "@/lib/companyOptions";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { diffCompany, recordFieldChanges, type Change } from "@/lib/provenance";
import type { ExtractionResult } from "@/lib/companyFileExtract";

export const maxDuration = 60;

type Body = {
  fields?: Record<string, string>;
  financials?: { year: number; revenueUsd: number | null; ebitdaUsd: number | null; employees: number | null }[];
  founders?: { name: string; title?: string; bio?: string }[];
  fileId?: string;
  fileName?: string;
};


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

  // Where each value came from inside the document (slide, page, sheet), read
  // from the stored extraction rather than trusting the client.
  const file = body.fileId
    ? await db.query.companyFiles.findFirst({ where: and(eq(companyFiles.id, body.fileId), eq(companyFiles.companyId, id)) })
    : null;
  let x: (ExtractionResult & { applied?: unknown }) | null = null;
  try { x = file?.extraction ? JSON.parse(file.extraction) : null; } catch { x = null; }
  const fileLabel = file?.filename ?? body.fileName ?? "Document";
  const where = (src?: string) => (src?.trim() ? `${fileLabel} · ${src.trim()}` : fileLabel);
  const fieldSrc = Object.fromEntries((x?.fields ?? []).map(f => [f.field, { label: where(f.source), note: f.originalText || f.note || undefined }]));
  const yearSrc = new Map((x?.financials ?? []).map(f => [f.year, where(f.source)]));
  const founderSrc = new Map((x?.founders ?? []).map(f => [f.name.trim().toLowerCase(), where(f.source)]));
  const source = {
    type: "document" as const, ref: file?.id ?? null, label: fileLabel,
    userId: session.user.id, userName: session.user.name ?? session.user.email ?? "User",
  };
  const finChanges: Change[] = [];
  const founderChanges: Change[] = [];

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
      for (const [metric, v] of Object.entries(values)) {
        if (v === null) continue;
        finChanges.push({ field: `fin:${year}:${metric}`, oldValue: existing?.[metric as keyof typeof values] ?? null, newValue: v, label: yearSrc.get(year) });
      }
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
        founderChanges.push({ field: "founder", oldValue: null, newValue: f.title?.trim() ? `${name} (${f.title.trim()})` : name, label: founderSrc.get(name.toLowerCase()) });
      }
    }

    await recordFieldChanges(id, source, [...diffCompany(company as Record<string, unknown>, update, fieldSrc), ...finChanges, ...founderChanges]);

    // Remember what this document contributed, for the company's Documents section.
    if (file && x) {
      {
        x.applied = {
          at: new Date().toISOString(),
          fields: Object.keys(update).length, years: snapshotsSaved, founders: foundersAdded,
        };
        await db.update(companyFiles).set({ extraction: JSON.stringify(x) }).where(eq(companyFiles.id, file.id));
      }
    }

    try {
      await db.insert(activityLog).values({
        id: randomUUID(), userId: session.user.id, userName: session.user.name ?? session.user.email ?? "User",
        action: "applied_file_extraction", entityType: "company", entityId: id, entityName: company.name,
        detail: `${Object.keys(update).length} field(s), ${snapshotsSaved} year(s), ${foundersAdded} founder(s)${body.fileName ? ` from ${body.fileName}` : ""}`,
      });
    } catch { /* non-blocking */ }

    return NextResponse.json({ ok: true, fieldsUpdated: Object.keys(update).length, snapshotsSaved, foundersAdded });
  } catch (err) {
    console.error("[apply-extraction]", err);
    return NextResponse.json({ error: "Failed to apply changes" }, { status: 500 });
  }
}
