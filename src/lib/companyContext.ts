// Feeds the files uploaded to a company's profile (decks, models, reports) into
// the document generators, so a 2-pager, deck, Word doc or LBO model for that
// company is grounded in them without re-uploading anything.
import Anthropic from "@anthropic-ai/sdk";
import { db, companyFiles } from "@/lib/db";
import { decryptBuffer } from "@/lib/blobCrypto";
import { buildFileContent } from "@/lib/companyFileExtract";
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
 * Content blocks for the company's files, each wrapped in a labelled header.
 * The last block carries a cache breakpoint so repeated calls within a few
 * minutes (plan revisions, one call per deck section) read the files from cache.
 */
export async function companyFileBlocks(companyId: string | null, fileIds: string[] | null): Promise<{
  blocks: Block[]; names: string[]; skipped: string[];
}> {
  const empty = { blocks: [], names: [], skipped: [] };
  if (!companyId || (fileIds && fileIds.length === 0)) return empty;

  let rows = await db.query.companyFiles.findMany({
    where: eq(companyFiles.companyId, companyId),
    orderBy: [desc(companyFiles.createdAt)],
  }).catch(() => []);
  rows = fileIds ? rows.filter(r => fileIds.includes(r.id)) : rows.slice(0, DEFAULT_FILE_COUNT);

  const blocks: Block[] = [];
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
