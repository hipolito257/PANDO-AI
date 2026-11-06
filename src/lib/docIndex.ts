// Search over every company document (Postgres full-text search).
//
// chunkFile reads a stored file, splits its text by slide / page / sheet into
// ~1,400-character passages and saves them; Postgres indexes each passage's
// words (Spanish and English stems, accents ignored), so it's searchable at once.
// A search can first ask Claude to expand the question into keywords in both
// languages, so a Spanish question finds an English deck and vice versa.
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, companyFiles, docChunks, jobs } from "@/lib/db";
import { decryptBuffer } from "@/lib/blobCrypto";
import { pptxSlideTexts, xlsxSheetTexts, type ExtractionResult } from "@/lib/companyFileExtract";
import { docxPartNames, extractDocxTexts } from "@/lib/documentTranslate";

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

/** Reads a stored file and replaces its passages; they are searchable right away. */
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
        locator: c.locator, text: c.text, tokens: Math.ceil(c.text.length / 4), createdAt: now(),
      }));

    await db.delete(docChunks).where(eq(docChunks.fileId, file.id));
    for (let i = 0; i < rows.length; i += 100) await db.insert(docChunks).values(rows.slice(i, i + 100));
    await db.update(companyFiles).set({
      indexStatus: "indexed", indexError: rows.length ? null : "No readable text in this file",
      chunkCount: rows.length, indexedAt: now(),
    }).where(eq(companyFiles.id, file.id));
    return rows.length;
  } catch (err) {
    await db.update(companyFiles).set({ indexStatus: "error", indexError: err instanceof Error ? err.message.slice(0, 500) : "Indexing failed" })
      .where(eq(companyFiles.id, file.id)).catch(() => {});
    return 0;
  }
}

/** Files that still need to be read and split. */
export async function filesToChunk(limit = 50) {
  return db.select({ id: companyFiles.id, filename: companyFiles.filename }).from(companyFiles)
    .where(inArray(companyFiles.indexStatus, ["none", "chunked"]))
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
    job: running ?? null,
  };
}

// ── Search ───────────────────────────────────────────────────────────────────
export type SearchHit = {
  id: string; companyId: string; companyName: string; fileId: string; filename: string;
  locator: string | null; text: string; score: number;
};

const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9%$.,\- ]+/g, " ").replace(/\s+/g, " ").trim();

// Common words that would match almost any passage (accents already stripped).
const STOP = new Set(("a al algo algun alguna algunas alguno algunos ante antes aqui asi aun cada como con contra cual cuales cuando cuanto cuantos de del desde donde dos el ella ellas ellos en entre era eran es esa esas ese eso esos esta estan estas este esto estos fue fueron ha han hay hasta la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros o otra otras otro otros para pero poco por porque que quien quienes se sea segun ser si sin sobre son su sus tambien tan tanto te tiene tienen todo todos tu tus un una uno unos y ya yo dame dime cual explica " +
  "about above after all also an and any are as at be been being but by can could did do does each for from had has have how i if in into is it its just me more most my no not of on or other our out over own same she should so some such than that the their them then there these they this those through to too under up very was we were what when where which while who why will with would you your tell show give").split(" "));

const keywords = (t: string) => fold(t).split(" ").filter(w => w.length > 1 && !STOP.has(w));

/**
 * Asks Claude for the keywords a matching passage would contain, in Spanish and
 * English (synonyms, the metric names a deck would use). Falls back to the
 * question's own words when there's no key or the call fails.
 */
export async function expandQuery(query: string, apiKey: string | null | undefined): Promise<string[]> {
  const own = keywords(query);
  if (!apiKey) return own;
  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      system: "You turn a search question about company documents (decks, financial models, reports of a private equity firm) into search keywords. Reply with ONLY a JSON array of 6 to 16 short keywords or 2-word phrases, in BOTH Spanish and English: the key terms of the question, their translations, close synonyms and the wording a document would use (e.g. revenue/ingresos/ventas, EBITDA, margin/margen). No explanations.",
      messages: [{ role: "user", content: query.slice(0, 500) }],
    });
    const text = msg.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("");
    const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as unknown[];
    const terms = arr.filter((t): t is string => typeof t === "string").map(t => keywords(t).join(" ")).filter(Boolean);
    return [...new Set([...own, ...terms])].slice(0, 24);
  } catch (err) {
    console.error("[search] query expansion failed", err);
    return own;
  }
}

export async function searchChunks(query: string, opts: { companyId?: string | null; limit?: number; terms?: string[] } = {}): Promise<SearchHit[]> {
  const limit = Math.min(30, opts.limit ?? 12);
  const terms = (opts.terms?.length ? opts.terms : keywords(query)).slice(0, 24);
  if (!terms.length) return [];
  // Any term may match (OR); passages matching more and rarer terms rank first.
  const tsq = sql.join(terms.map(t => sql`(plainto_tsquery('spanish', ${t}) || plainto_tsquery('english', ${t}))`), sql` || `);
  const companyFilter = opts.companyId ? sql`AND c."companyId" = ${opts.companyId}` : sql``;
  const res = await db.execute(sql`
    WITH q AS (SELECT ${tsq} AS query)
    SELECT c."id", c."companyId", co."name" AS "companyName", c."fileId", f."filename", c."locator", c."text",
           ts_rank_cd(c."tsv", q.query, 32) AS "score"
    FROM "DocChunk" c
    JOIN "CompanyFile" f ON f."id" = c."fileId"
    JOIN "Company" co ON co."id" = c."companyId", q
    WHERE c."tsv" @@ q.query ${companyFilter}
    ORDER BY "score" DESC
    LIMIT ${limit}`);
  const rows = res.rows as Record<string, unknown>[];
  const top = Math.max(...rows.map(r => Number(r.score)), 1e-9);
  return rows.map(r => ({
    id: String(r.id), companyId: String(r.companyId), companyName: String(r.companyName), fileId: String(r.fileId),
    filename: String(r.filename), locator: (r.locator as string | null) ?? null, text: String(r.text),
    score: Number(r.score) / top, // relative to the best match
  }));
}
