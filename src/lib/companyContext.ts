// Feeds the files uploaded to a company's profile (decks, models, reports) into
// the document generators, so a 2-pager, deck, Word doc or LBO model for that
// company is grounded in them without re-uploading anything.
import Anthropic from "@anthropic-ai/sdk";
import { db, companyFiles } from "@/lib/db";
import { decryptBuffer } from "@/lib/blobCrypto";
import { buildFileContent, type ExtractionResult } from "@/lib/companyFileExtract";
import { desc, eq } from "drizzle-orm";

const DEFAULT_FILE_COUNT = 3;
// Keeps attached company files well inside the 32 MB request cap, leaving room
// for whatever the user attaches on the generator page.
const MAX_BASE64_TOTAL = 18 * 1024 * 1024;

type Block = Anthropic.ContentBlockParam;

/**
 * Reads the "companyFileIds" form field: a JSON array picks exactly those files
 * (an empty array means none); when the field is absent the newest files are used.
 */
export function parseCompanyFileIds(raw: FormDataEntryValue | null): string[] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

function blockSize(b: Block): number {
  if ((b.type === "document" || b.type === "image") && b.source.type === "base64") return b.source.data.length;
  if (b.type === "text") return b.text.length;
  return 0;
}

/**
 * Digest of everything extracted from ALL of the company's documents (summary,
 * key facts, financials as reported, comparables named). Cheap enough to send
 * on every request, so any feature working on the company knows what its
 * documents say even when their full content isn't attached.
 */
export async function companyKnowledgeText(companyId: string | null, maxChars = 12000): Promise<string> {
  if (!companyId) return "";
  const rows = await db.query.companyFiles.findMany({
    where: eq(companyFiles.companyId, companyId),
    orderBy: [desc(companyFiles.createdAt)],
  }).catch(() => []);
  const parts: string[] = [];
  for (const f of rows) {
    if (f.extractionStatus !== "done" || !f.extraction) continue;
    let x: ExtractionResult;
    try { x = JSON.parse(f.extraction); } catch { continue; }
    const lines = [`From "${f.filename}" (${x.documentType}, uploaded ${f.createdAt?.slice(0, 10) ?? "n/a"}):`, x.summary];
    if (x.keyFacts?.length) lines.push(`Key facts: ${x.keyFacts.map(k => `${k.label}: ${k.value}`).join("; ")}`);
    if (x.financials?.length) {
      lines.push(`Financials as reported: ${x.financials.map(r => `${r.year} ${r.period} revenue ${r.revenue ?? "n/a"} EBITDA ${r.ebitda ?? "n/a"} ${r.currency}`).join("; ")}`);
    }
    if (x.founders?.length) lines.push(`People: ${x.founders.map(p => `${p.name}${p.title ? ` (${p.title})` : ""}`).join(", ")}`);
    if (x.comparables?.length) lines.push(`Comparables named: ${x.comparables.map(c => `${c.name}${c.ticker ? ` (${c.ticker})` : ""}`).join(", ")}`);
    parts.push(lines.join("\n"));
  }
  if (!parts.length) return "";
  const text = `WHAT THE COMPANY'S DOCUMENTS SAY (extracted from ${parts.length} document(s) on its profile):\n\n${parts.join("\n\n")}`;
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * Content blocks for the company's files, each wrapped in a labelled header.
 * The last block carries a cache breakpoint so repeated calls within a few
 * minutes (plan revisions, one call per deck section) read the files from cache.
 */
export async function companyFileBlocks(companyId: string | null, fileIds: string[] | null): Promise<{
  blocks: Block[]; names: string[]; skipped: string[];
}> {
  const empty = { blocks: [], names: [], skipped: [] };
  if (!companyId) return empty;
  const knowledge = await companyKnowledgeText(companyId);
  if (fileIds && fileIds.length === 0) {
    return knowledge ? { blocks: [{ type: "text", text: knowledge, cache_control: { type: "ephemeral" } }], names: [], skipped: [] } : empty;
  }

  let rows = await db.query.companyFiles.findMany({
    where: eq(companyFiles.companyId, companyId),
    orderBy: [desc(companyFiles.createdAt)],
  }).catch(() => []);
  rows = fileIds ? rows.filter(r => fileIds.includes(r.id)) : rows.slice(0, DEFAULT_FILE_COUNT);

  const blocks: Block[] = knowledge ? [{ type: "text", text: knowledge }] : [];
  const names: string[] = [];
  const skipped: string[] = [];
  let total = 0;

  for (const f of rows) {
    try {
      const res = await fetch(f.blobUrl);
      if (!res.ok) throw new Error(`blob ${res.status}`);
      const { blocks: fileBlocks } = await buildFileContent(decryptBuffer(Buffer.from(await res.arrayBuffer())), f.ext);
      const size = fileBlocks.reduce((n, b) => n + blockSize(b), 0);
      if (total + size > MAX_BASE64_TOTAL) { skipped.push(f.filename); continue; }
      total += size;
      blocks.push(
        { type: "text", text: `===== COMPANY FILE ON RECORD: "${f.filename}" (uploaded ${f.createdAt?.slice(0, 10) ?? "n/a"}) =====` },
        ...fileBlocks,
        { type: "text", text: `===== END OF "${f.filename}" =====` },
      );
      names.push(f.filename);
    } catch (err) {
      console.error("[companyFileBlocks]", f.filename, err);
      skipped.push(f.filename);
    }
  }

  const last = blocks[blocks.length - 1];
  if (last?.type === "text") last.cache_control = { type: "ephemeral" };
  return { blocks, names, skipped };
}

/** Prompt line telling the model how to treat the company files. */
export function companyFilesInstruction(names: string[]): string | null {
  if (!names.length) return null;
  return `COMPANY FILES ON RECORD: ${names.map(n => `"${n}"`).join(", ")}. Their content is included above. They were uploaded to this company's profile by the team and are a primary, authoritative source for facts, figures and narrative about the company: use their real numbers, names and claims rather than inventing data. Where they disagree with the database summary, follow the files and mention the discrepancy if it matters.`;
}
