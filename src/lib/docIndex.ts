// Semantic search over every company document.
//
// Indexing has two steps so the slow part can be paced:
//   1. chunkFile: read the stored file, split its text by slide / page / sheet
//      into ~1,400-character passages, and save them without embeddings.
//   2. embedPending: send passages to Voyage in batches that fit the rate
//      limit, until the time budget runs out. Whatever is left is picked up by
//      the next index job (started from the Search page, after an extraction,
//      or by the daily cron).
import { randomUUID } from "crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, companyFiles, docChunks, companies, jobs } from "@/lib/db";
import { decryptBuffer } from "@/lib/blobCrypto";
import { pptxSlideTexts, xlsxSheetTexts, type ExtractionResult } from "@/lib/companyFileExtract";
import { docxPartNames, extractDocxTexts } from "@/lib/documentTranslate";
import { embed, EmbedRateLimited, embeddingsAvailable, estimateTokens, MAX_BATCH_TOKENS, msUntilNextSlot } from "@/lib/embeddings";

type Section = { locator: string; text: string };

const CHUNK_CHARS = 1400;
const OVERLAP_CHARS = 150;
const MAX_CHUNKS_PER_FILE = 400;

const now = () => new Date().toISOString();
const clean = (t: string) => t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

async function pdfPages(buffer: Buffer): Promise<Section[]> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map((t, i) => ({ locator: `Page ${i + 1}`, text: t }));
}

export async function fileSections(buffer: Buffer, ext: string): Promise<Section[]> {
  switch (ext) {
    case "pdf": return pdfPages(buffer);
    case "pptx": return pptxSlideTexts(buffer);
    case "xlsx": return xlsxSheetTexts(buffer);
    case "docx": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const PizZip = require("pizzip");
      const zip = new PizZip(buffer);
      const paras = docxPartNames(zip).flatMap(n => extractDocxTexts(zip.files[n].asText()));
      // Group paragraphs into numbered sections so citations point somewhere useful.
      const out: Section[] = [];
      let buf: string[] = [], len = 0;
      for (const p of paras) {
        buf.push(p); len += p.length;
        if (len > 4000) { out.push({ locator: `Section ${out.length + 1}`, text: buf.join("\n") }); buf = []; len = 0; }
      }
      if (buf.length) out.push({ locator: `Section ${out.length + 1}`, text: buf.join("\n") });
      return out;
    }
    case "csv":
    case "txt":
      return [{ locator: "Text", text: buffer.toString("utf-8") }];
    default:
      return []; // images: only the AI summary below is searchable
  }
}

// Split one section into passages at line / sentence boundaries, with a little overlap.
export function splitSection(text: string): string[] {
  const t = clean(text);
  if (t.length <= CHUNK_CHARS) return t ? [t] : [];
  const out: string[] = [];
  let start = 0;
  while (start < t.length) {
    let end = Math.min(t.length, start + CHUNK_CHARS);
    if (end < t.length) {
      const window = t.slice(start + CHUNK_CHARS / 2, end);
      const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "));
      if (cut > 0) end = start + CHUNK_CHARS / 2 + cut + 1;
    }
    out.push(t.slice(start, end).trim());
    if (end >= t.length) break;
    start = Math.max(end - OVERLAP_CHARS, start + 1);
  }
  return out.filter(Boolean);
}

function summarySection(extraction: string | null): Section | null {
  if (!extraction) return null;
  try {
    const x = JSON.parse(extraction) as ExtractionResult;
    const facts = (x.keyFacts ?? []).map(k => `${k.label}: ${k.value} (${k.source})`).join("\n");
    const text = [x.documentType && `Document type: ${x.documentType}`, x.summary, facts].filter(Boolean).join("\n");
    return text.trim() ? { locator: "AI summary", text } : null;
  } catch { return null; }
}

/** Reads a stored file and replaces its passages (without embeddings yet). */
export async function chunkFile(fileId: string): Promise<number> {
  const file = await db.query.companyFiles.findFirst({ where: eq(companyFiles.id, fileId) });
  if (!file) return 0;
  try {
    const res = await fetch(file.blobUrl);
    if (!res.ok) throw new Error(`Could not read the stored file (${res.status})`);
    const buffer = decryptBuffer(Buffer.from(await res.arrayBuffer()));
    const sections = await fileSections(buffer, file.ext);
    const summary = summarySection(file.extraction);
    if (summary) sections.unshift(summary);

    const rows = sections
      .flatMap(s => splitSection(s.text).map(text => ({ locator: s.locator, text })))
      .slice(0, MAX_CHUNKS_PER_FILE)
      .map((c, i) => ({
        id: randomUUID(), companyId: file.companyId, fileId: file.id, position: i,
        locator: c.locator, text: c.text, tokens: estimateTokens(c.text), embedding: null, createdAt: now(),
      }));

    await db.delete(docChunks).where(eq(docChunks.fileId, file.id));
    for (let i = 0; i < rows.length; i += 100) await db.insert(docChunks).values(rows.slice(i, i + 100));
    await db.update(companyFiles).set({
      indexStatus: rows.length ? "chunked" : "indexed", indexError: rows.length ? null : "No readable text in this file",
      chunkCount: rows.length, indexedAt: rows.length ? null : now(),
    }).where(eq(companyFiles.id, file.id));
    return rows.length;
  } catch (err) {
    await db.update(companyFiles).set({ indexStatus: "error", indexError: err instanceof Error ? err.message.slice(0, 500) : "Indexing failed" })
      .where(eq(companyFiles.id, file.id)).catch(() => {});
    return 0;
  }
}

const vecLiteral = (v: number[]) => `[${v.map(x => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;

/** Embeds waiting passages until the deadline. Returns how many were embedded. */
export async function embedPending(opts: {
  deadline: number;
  onProgress?: (done: number, pending: number) => Promise<void>;
  isCancelled?: () => Promise<boolean>;
}): Promise<{ embedded: number; pending: number; rateLimited?: boolean }> {
  let embedded = 0;
  let rateLimited = false;
  const filesTouched = new Set<string>();
  for (;;) {
    if (opts.isCancelled && (await opts.isCancelled())) break;
    // Stop when the next paced request plus its round trip wouldn't fit.
    if (Date.now() + msUntilNextSlot() + 20_000 > opts.deadline) break;

    const candidates = await db.select({
      id: docChunks.id, fileId: docChunks.fileId, text: docChunks.text, tokens: docChunks.tokens, locator: docChunks.locator,
      filename: companyFiles.filename, company: companies.name,
    }).from(docChunks)
      .innerJoin(companyFiles, eq(companyFiles.id, docChunks.fileId))
      .innerJoin(companies, eq(companies.id, docChunks.companyId))
      .where(isNull(docChunks.embedding))
      .orderBy(asc(docChunks.createdAt), asc(docChunks.position))
      .limit(200);
    if (!candidates.length) break;

    const batch: typeof candidates = [];
    let tokens = 0;
    for (const c of candidates) {
      const t = c.tokens + 30;
      if (batch.length && tokens + t > MAX_BATCH_TOKENS) break;
      batch.push(c); tokens += t;
    }
    // The document and company names give each passage context for retrieval.
    const inputs = batch.map(c => `${c.company} — ${c.filename} (${c.locator ?? ""})\n${c.text}`);
    let vectors: number[][];
    try {
      vectors = await embed(inputs, "document");
    } catch (err) {
      // Free-tier rate limit (chat and search queries share it): keep what's done,
      // leave the rest waiting for the next run instead of failing the job.
      if (err instanceof EmbedRateLimited) { rateLimited = true; break; }
      throw err;
    }
    for (let i = 0; i < batch.length; i++) {
      await db.execute(sql`UPDATE "DocChunk" SET "embedding" = ${vecLiteral(vectors[i])}::vector WHERE "id" = ${batch[i].id}`);
      filesTouched.add(batch[i].fileId);
    }
    embedded += batch.length;

    await markIndexedFiles([...filesTouched]);
    if (opts.onProgress) await opts.onProgress(embedded, await pendingCount());
  }
  return { embedded, pending: await pendingCount(), ...(rateLimited ? { rateLimited } : {}) };
}

async function markIndexedFiles(fileIds: string[]) {
  if (!fileIds.length) return;
  const stillPending = await db.selectDistinct({ fileId: docChunks.fileId }).from(docChunks)
    .where(and(inArray(docChunks.fileId, fileIds), isNull(docChunks.embedding)));
  const pendingSet = new Set(stillPending.map(r => r.fileId));
  const done = fileIds.filter(id => !pendingSet.has(id));
  if (done.length) {
    await db.update(companyFiles).set({ indexStatus: "indexed", indexedAt: now(), indexError: null })
      .where(and(inArray(companyFiles.id, done), eq(companyFiles.indexStatus, "chunked")));
  }
}

export async function pendingCount(): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(docChunks).where(isNull(docChunks.embedding));
  return r?.n ?? 0;
}

/** Files that still need to be read and split. */
export async function filesToChunk(limit = 50) {
  return db.select({ id: companyFiles.id, filename: companyFiles.filename }).from(companyFiles)
    .where(inArray(companyFiles.indexStatus, ["none"]))
    .orderBy(asc(companyFiles.createdAt)).limit(limit);
}

export async function indexStatus(companyId?: string | null) {
  const where = companyId ? eq(companyFiles.companyId, companyId) : undefined;
  const files = await db.select({ status: companyFiles.indexStatus, n: sql<number>`count(*)::int` })
    .from(companyFiles).where(where).groupBy(companyFiles.indexStatus);
  const by = Object.fromEntries(files.map(f => [f.status, f.n]));
  const total = files.reduce((s, f) => s + f.n, 0);
  const running = await db.query.jobs.findFirst({
    where: and(eq(jobs.type, "index_documents"), inArray(jobs.status, ["queued", "running"])),
    columns: { id: true, message: true, progress: true },
  });
  return {
    files: total, indexed: by.indexed ?? 0, waiting: (by.none ?? 0) + (by.chunked ?? 0), errors: by.error ?? 0,
    pendingPassages: await pendingCount(), job: running ?? null, available: embeddingsAvailable(),
  };
}

// ── Search ───────────────────────────────────────────────────────────────────
export type SearchHit = {
  id: string; companyId: string; companyName: string; fileId: string; filename: string;
  locator: string | null; text: string; score: number;
};

export async function searchChunks(query: string, opts: { companyId?: string | null; limit?: number } = {}): Promise<SearchHit[]> {
  const limit = Math.min(30, opts.limit ?? 12);
  const [qv] = await embed([query], "query");
  const vec = vecLiteral(qv);
  const companyFilter = opts.companyId ? sql`AND c."companyId" = ${opts.companyId}` : sql``;
  const res = await db.execute(sql`
    SELECT c."id", c."companyId", co."name" AS "companyName", c."fileId", f."filename", c."locator", c."text",
           1 - (c."embedding" <=> ${vec}::vector) AS "score"
    FROM "DocChunk" c
    JOIN "CompanyFile" f ON f."id" = c."fileId"
    JOIN "Company" co ON co."id" = c."companyId"
    WHERE c."embedding" IS NOT NULL ${companyFilter}
    ORDER BY c."embedding" <=> ${vec}::vector
    LIMIT ${limit}`);
  return (res.rows as Record<string, unknown>[]).map(r => ({
    id: String(r.id), companyId: String(r.companyId), companyName: String(r.companyName), fileId: String(r.fileId),
    filename: String(r.filename), locator: (r.locator as string | null) ?? null, text: String(r.text), score: Number(r.score),
  }));
}
