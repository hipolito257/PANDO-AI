// The kinds of background job the app can start (POST /api/jobs { type, input }).
// Each handler runs on the server after the request returns; see jobs.ts.
import { put } from "@vercel/blob";
import { and, eq, gt, inArray, ne } from "drizzle-orm";
import { db, companies, companyFiles, jobs, userSettings } from "@/lib/db";
import { decryptBuffer, encryptBuffer } from "@/lib/blobCrypto";
import { extractCompanyData, EXTRACTABLE_FIELDS } from "@/lib/companyFileExtract";
import { syncFileComps, syncCompanyDocumentComps } from "@/lib/companyDocComps";
import { runDeckBuild, type DeckBuildInput } from "@/lib/deckBuild";
import { JobCancelled, type JobContext } from "@/lib/jobs";
import { chunkFile, filesToChunk } from "@/lib/docIndex";

const BLOB_STORE_ID = process.env.BLOBPUBLIC_STORE_ID ?? process.env.BLOB_STORE_ID ?? "";

async function apiKeyFor(userId: string): Promise<string> {
  const setting = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  const key = setting?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("No Anthropic API key configured. Add one in Settings.");
  return key;
}

// ── Company document extraction ──────────────────────────────────────────────
export type ExtractInput = { companyId: string; fileId: string };

export async function extractCompanyFile(input: ExtractInput, ctx: JobContext) {
  const { companyId, fileId } = input;
  const [file, company] = await Promise.all([
    db.query.companyFiles.findFirst({ where: and(eq(companyFiles.id, fileId), eq(companyFiles.companyId, companyId)) }),
    db.query.companies.findFirst({ where: eq(companies.id, companyId) }),
  ]);
  if (!file || !company) throw new Error("Document not found");
  const apiKey = await apiKeyFor(ctx.userId);

  await db.update(companyFiles).set({ extractionStatus: "running", extractionError: null }).where(eq(companyFiles.id, fileId));
  try {
    await ctx.progress(`Reading ${file.filename}…`, 10);
    const res = await fetch(file.blobUrl);
    if (!res.ok) throw new Error(`Could not read the stored file (${res.status})`);
    const buffer = decryptBuffer(Buffer.from(await res.arrayBuffer()));

    await ctx.progress("Extracting data with Claude (long decks take 1–3 min)…", 25);
    const current = Object.fromEntries(EXTRACTABLE_FIELDS.map(f => [f, (company as Record<string, unknown>)[f]]));
    const result = await extractCompanyData({ apiKey, buffer, ext: file.ext, filename: file.filename, companyName: company.name, current });
    if (await ctx.isCancelled()) throw new JobCancelled();

    await db.update(companyFiles).set({
      extractionStatus: "done", extraction: JSON.stringify(result), extractionError: null,
      extractionCostUsd: result.usage?.costUsd ?? null, extractedAt: new Date().toISOString(),
    }).where(eq(companyFiles.id, fileId));

    // Refresh its search passages (searchable as soon as they are saved).
    await ctx.progress("Preparing the document for search…", 85);
    await chunkFile(fileId).catch(err => console.error("[extractCompanyFile] chunking failed", err));

    await ctx.progress("Adding comparables named in the document…", 90);
    let compsReport = null;
    try {
      compsReport = await syncFileComps(file, result, company.name);
    } catch (err) {
      console.error("[extractCompanyFile] comps sync failed", err);
    }
    return { fileId, filename: file.filename, companyId, compsReport, costUsd: result.usage?.costUsd ?? null };
  } catch (err) {
    const cancelled = err instanceof JobCancelled;
    await db.update(companyFiles).set({
      extractionStatus: cancelled ? (file.extraction ? "done" : "none") : "error",
      extractionError: cancelled ? null : err instanceof Error ? err.message : "Extraction failed",
    }).where(eq(companyFiles.id, fileId)).catch(() => {});
    throw err;
  }
}

// ── Comparables from company documents ───────────────────────────────────────
export type CompsSyncInput = { companyId: string; force?: boolean };

async function syncDocumentComps(input: CompsSyncInput, ctx: JobContext) {
  const apiKey = await apiKeyFor(ctx.userId).catch(() => null);
  const reports = [];
  let documents = 0;
  // Each round analyses at most a couple of new documents; keep going while
  // there are more, within this job's time.
  for (let round = 0; round < 6; round++) {
    if (await ctx.isCancelled()) throw new JobCancelled();
    await ctx.progress(round === 0 ? "Checking documents for comparables…" : "Analysing more documents…", 10 + round * 14);
    const r = await syncCompanyDocumentComps(input.companyId, apiKey, { force: !!input.force && round === 0 });
    documents = r.documents;
    reports.push(...r.reports);
    if (!r.pending) break;
  }
  return { companyId: input.companyId, documents, reports };
}

// ── Document search index ────────────────────────────────────────────────────
export type IndexInput = { fileIds?: string[] };
const INDEX_BUDGET_MS = 250_000; // the jobs route allows 300 s

async function indexDocuments(input: IndexInput, ctx: JobContext) {
  const started = Date.now();
  const other = await db.query.jobs.findFirst({
    where: and(eq(jobs.type, "index_documents"), inArray(jobs.status, ["running"]), ne(jobs.id, ctx.jobId),
      gt(jobs.heartbeatAt, new Date(Date.now() - 90_000).toISOString())),
    columns: { id: true },
  });
  if (other) return { skipped: true, reason: "Another indexing job is already running" };

  let read = 0;
  const forced = input.fileIds?.length ? input.fileIds.map(id => ({ id })) : [];
  const toRead = [...forced, ...(await filesToChunk(200))];
  for (let i = 0; i < toRead.length; i++) {
    if (await ctx.isCancelled()) throw new JobCancelled();
    if (Date.now() - started > INDEX_BUDGET_MS) break; // the rest is picked up by the next run
    await ctx.progress(`Reading documents (${i + 1}/${toRead.length})…`, 5 + Math.round((i / toRead.length) * 93));
    read += (await chunkFile(toRead[i].id)) > 0 ? 1 : 0;
  }
  return { filesRead: read };
}

// ── Presentation build ───────────────────────────────────────────────────────
async function buildDeck(input: DeckBuildInput, ctx: JobContext) {
  const out = await runDeckBuild(input, ctx);
  await ctx.progress("Saving the presentation…", 97);
  // Decks are confidential: stored encrypted like other uploads; downloaded via /api/jobs/[id]/download.
  const blob = await put(`job-results/${ctx.jobId}.pptx.enc`, encryptBuffer(out.pptx), {
    access: "public", addRandomSuffix: true, storeId: BLOB_STORE_ID,
  } as Parameters<typeof put>[2]);
  return {
    blobUrl: blob.url, filename: out.filename, slideCount: out.slideCount, warnings: out.warnings,
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
}

// ── Registry ─────────────────────────────────────────────────────────────────
type Handler = {
  run: (input: never, ctx: JobContext) => Promise<unknown>;
  title: (input: never) => string | Promise<string>;
  companyId: (input: never) => string | null;
};

async function companyName(id: string | null | undefined): Promise<string> {
  if (!id) return "";
  const c = await db.query.companies.findFirst({ where: eq(companies.id, id), columns: { name: true } });
  return c?.name ?? "";
}

export const JOB_HANDLERS: Record<string, Handler> = {
  extract_company_file: {
    run: extractCompanyFile as Handler["run"],
    title: (async (i: ExtractInput) => {
      const f = await db.query.companyFiles.findFirst({ where: eq(companyFiles.id, i.fileId), columns: { filename: true } });
      return `Extract data: ${f?.filename ?? "document"}`;
    }) as Handler["title"],
    companyId: ((i: ExtractInput) => i.companyId) as Handler["companyId"],
  },
  sync_document_comps: {
    run: syncDocumentComps as Handler["run"],
    title: (async (i: CompsSyncInput) => `Comparables from documents: ${await companyName(i.companyId)}`) as Handler["title"],
    companyId: ((i: CompsSyncInput) => i.companyId) as Handler["companyId"],
  },
  index_documents: {
    run: indexDocuments as Handler["run"],
    title: (() => "Index documents for search") as Handler["title"],
    companyId: (() => null) as Handler["companyId"],
  },
  deck_build: {
    run: buildDeck as Handler["run"],
    title: (async (i: DeckBuildInput) => `Presentation: ${i.approvedPlan?.deck_title || (await companyName(i.companyId)) || "deck"}`) as Handler["title"],
    companyId: ((i: DeckBuildInput) => i.companyId ?? null) as Handler["companyId"],
  },
};
