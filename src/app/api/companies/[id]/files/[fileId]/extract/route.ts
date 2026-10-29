import { NextRequest, NextResponse } from "next/server";
import { db, companies, companyFiles, userSettings } from "@/lib/db";
import { auth } from "@/lib/auth";
import { decryptBuffer } from "@/lib/blobCrypto";
import { extractCompanyData, EXTRACTABLE_FIELDS } from "@/lib/companyFileExtract";
import { and, eq } from "drizzle-orm";

// A 70-page deck takes roughly 1–3 minutes.
export const maxDuration = 300;

// POST — run Claude over the file and store the proposed values. Nothing on
// the company is changed here; the user reviews and applies via /apply-extraction.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, fileId } = await params;

  const [file, company, setting] = await Promise.all([
    db.query.companyFiles.findFirst({ where: and(eq(companyFiles.id, fileId), eq(companyFiles.companyId, id)) }),
    db.query.companies.findFirst({ where: eq(companies.id, id) }),
    db.query.userSettings.findFirst({ where: eq(userSettings.userId, session.user.id) }),
  ]);
  if (!file || !company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const apiKey = setting?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "No Anthropic API key configured. Add one in Settings." }, { status: 400 });

  try {
    const res = await fetch(file.blobUrl);
    if (!res.ok) throw new Error(`Could not read the stored file (${res.status})`);
    const buffer = decryptBuffer(Buffer.from(await res.arrayBuffer()));

    const current = Object.fromEntries(EXTRACTABLE_FIELDS.map(f => [f, (company as Record<string, unknown>)[f]]));
    const result = await extractCompanyData({
      apiKey, buffer, ext: file.ext, filename: file.filename, companyName: company.name, current,
    });

    await db.update(companyFiles).set({
      extractionStatus: "done",
      extraction: JSON.stringify(result),
      extractionError: null,
      extractionCostUsd: result.usage?.costUsd ?? null,
      extractedAt: new Date().toISOString(),
    }).where(eq(companyFiles.id, fileId));

    return NextResponse.json(result);
  } catch (err) {
    console.error("[company file extract]", err);
    const message = err instanceof Error ? err.message : "Extraction failed";
    await db.update(companyFiles).set({ extractionStatus: "error", extractionError: message })
      .where(eq(companyFiles.id, fileId)).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
