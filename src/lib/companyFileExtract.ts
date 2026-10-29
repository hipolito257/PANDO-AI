// Turns an uploaded company file (deck, Excel, Word, image) into Claude content
// blocks and asks Claude to pull structured company data out of it.
//
//  - PDF:  sent as-is as a document block — Claude reads each page's text AND
//          sees it as an image, so charts and tables are understood.
//  - PPTX: unzipped per slide (in presentation order): paragraph text, tables
//          (row by row), native chart data (series values straight from the
//          chart XML — exact numbers), speaker notes, and embedded images
//          (screenshots of Excel, pasted charts) sent as image blocks.
//  - XLSX: every sheet as tab-separated rows including numbers and formula
//          results, not just string cells.
//  - DOCX / CSV / TXT: plain text.  PNG / JPG / WEBP / GIF: image block.
import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import { extractDocxTexts, docxPartNames } from "@/lib/documentTranslate";
import { SECTORS, COUNTRIES, STAGES, FUNDING_STAGES } from "@/lib/companyOptions";

export const EXTRACT_MODEL = "claude-sonnet-5-5";
// USD per million tokens for EXTRACT_MODEL.
const PRICE_INPUT = 2, PRICE_OUTPUT = 10, PRICE_CACHE_WRITE = 2.5, PRICE_CACHE_READ = 0.2;

export const SUPPORTED_EXTS = ["pdf", "pptx", "xlsx", "docx", "csv", "txt", "png", "jpg", "jpeg", "webp", "gif"];
export const LEGACY_EXTS: Record<string, string> = { ppt: "pptx or PDF", xls: "xlsx", doc: "docx or PDF", key: "PDF", numbers: "xlsx" };

const MAX_PDF_BYTES   = 23 * 1024 * 1024;  // base64 inflates ~33%; the API caps a request at 32 MB
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // API limit per image
const MIN_IMAGE_BYTES = 15 * 1024;         // smaller embedded images are almost always logos / icons
const MAX_IMAGES      = 80;
const MAX_TEXT_CHARS  = 600_000;           // ~150K tokens of text

const IMAGE_MEDIA: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};

export const EXTRACTABLE_FIELDS = [
  "description", "sector", "subsector", "country", "city", "stage", "fundingStage", "website", "linkedinUrl",
  "revenueUsd", "revenueGrowth", "ebitdaUsd", "ebitdaMargin", "employees", "employeeGrowth",
  "totalFunding", "lastFundingAmt", "lastFundingDate",
] as const;
export type ExtractableField = (typeof EXTRACTABLE_FIELDS)[number];

export const NUMERIC_FIELDS = new Set<string>([
  "revenueUsd", "revenueGrowth", "ebitdaUsd", "ebitdaMargin", "employees", "employeeGrowth", "totalFunding", "lastFundingAmt",
]);

// Money is reported in the document's own currency (whole units); the review
// screen converts to USD with an exchange rate the user confirms.
export const MONEY_FIELDS = new Set<string>(["revenueUsd", "ebitdaUsd", "totalFunding", "lastFundingAmt"]);

export type ExtractedField = { field: ExtractableField; value: string; currency: string; originalText: string; source: string; note: string };
export type ExtractedFinancial = {
  year: number; period: "actual" | "forecast" | "budget" | "ltm";
  revenue: number | null; ebitda: number | null; employees: number | null;
  currency: string; source: string; note: string;
};
export type FxRate = { currency: string; unitsPerUsd: number; basis: string };
export type ExtractedFounder = { name: string; title: string; bio: string; source: string };
export type ExtractionResult = {
  documentType: string;
  summary: string;
  fields: ExtractedField[];
  financials: ExtractedFinancial[];
  founders: ExtractedFounder[];
  keyFacts: { label: string; value: string; source: string }[];
  fxRates: FxRate[];
  warnings: string[];
  // Added server-side
  usage?: { inputTokens: number; outputTokens: number; costUsd: number; model: string };
  preprocessingNotes?: string[];
};

// ── Content building ─────────────────────────────────────────────────────────

type Block = Anthropic.ContentBlockParam;

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

// Text of every <a:p> paragraph inside a DrawingML fragment.
function drawingParagraphs(xml: string): string[] {
  const out: string[] = [];
  for (const p of xml.match(/<a:p[\s>][\s\S]*?<\/a:p>/g) ?? []) {
    const text = (p.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g) ?? [])
      .map(t => decodeXml(t.replace(/<[^>]+>/g, "")))
      .join("");
    if (text.trim()) out.push(text.trim());
  }
  return out;
}

// Tables row by row ("cell | cell | cell"); returns the tables and the xml with them removed.
function extractTables(xml: string): { tables: string[]; rest: string } {
  const tables: string[] = [];
  const rest = xml.replace(/<a:tbl>[\s\S]*?<\/a:tbl>/g, tbl => {
    const rows = (tbl.match(/<a:tr[\s>][\s\S]*?<\/a:tr>/g) ?? []).map(tr =>
      (tr.match(/<a:tc[\s>][\s\S]*?<\/a:tc>|<a:tc\/>/g) ?? []).map(tc => drawingParagraphs(tc).join(" ")).join(" | "),
    );
    if (rows.some(r => r.replace(/[|\s]/g, ""))) tables.push(rows.join("\n"));
    return "";
  });
  return { tables, rest };
}

// Series names, categories and values straight from a chart part.
function describeChart(xml: string): string {
  const title = drawingParagraphs((xml.match(/<c:title>[\s\S]*?<\/c:title>/) ?? [""])[0]).join(" ");
  const ptValues = (frag: string | undefined) => {
    const vals: string[] = [];
    for (const pt of frag?.match(/<c:pt idx="(\d+)"[^>]*>[\s\S]*?<\/c:pt>/g) ?? []) {
      const idx = Number(pt.match(/idx="(\d+)"/)![1]);
      vals[idx] = decodeXml((pt.match(/<c:v>([\s\S]*?)<\/c:v>/) ?? ["", ""])[1]);
    }
    return vals;
  };
  const lines: string[] = [`Chart${title ? `: ${title}` : ""}`];
  const fmt = xml.match(/<c:formatCode>([\s\S]*?)<\/c:formatCode>/);
  if (fmt) lines.push(`  number format: ${decodeXml(fmt[1])}`);
  for (const ser of xml.match(/<c:ser>[\s\S]*?<\/c:ser>/g) ?? []) {
    const nameFrag = ser.match(/<c:tx>[\s\S]*?<\/c:tx>/)?.[0] ?? "";
    const name = decodeXml(nameFrag.match(/<c:v>([\s\S]*?)<\/c:v>/)?.[1] ?? drawingParagraphs(nameFrag).join(" ")) || "Series";
    const cats = ptValues(ser.match(/<c:(?:cat|xVal)>[\s\S]*?<\/c:(?:cat|xVal)>/)?.[0]);
    const vals = ptValues(ser.match(/<c:(?:val|yVal)>[\s\S]*?<\/c:(?:val|yVal)>/)?.[0]);
    const pairs = vals.map((v, i) => (v === undefined ? null : `${cats[i] ?? `#${i + 1}`}=${v}`)).filter(Boolean);
    lines.push(`  ${name}: ${pairs.join(", ")}`);
  }
  return lines.join("\n");
}

function relsOf(zip: any, partPath: string): { id: string; type: string; target: string }[] {
  const relsPath = path.posix.join(path.posix.dirname(partPath), "_rels", path.posix.basename(partPath) + ".rels");
  const xml: string | undefined = zip.files[relsPath]?.asText();
  if (!xml) return [];
  return (xml.match(/<Relationship\s[^>]*\/?>/g) ?? [])
    .filter(r => !/TargetMode="External"/.test(r))
    .map(r => ({
      id: r.match(/\sId="([^"]+)"/)?.[1] ?? "",
      type: r.match(/\sType="([^"]+)"/)?.[1] ?? "",
      target: r.match(/\sTarget="([^"]+)"/)?.[1] ?? "",
    }));
}

function resolvePart(fromPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromPart), target));
}

function slidesInOrder(zip: any): string[] {
  const pres = "ppt/presentation.xml";
  const presXml: string = zip.files[pres]?.asText() ?? "";
  const rels = new Map(relsOf(zip, pres).map(r => [r.id, resolvePart(pres, r.target)]));
  const ordered = (presXml.match(/<p:sldId\s[^>]*>/g) ?? [])
    .map(s => rels.get(s.match(/r:id="([^"]+)"/)?.[1] ?? ""))
    .filter((p): p is string => !!p && !!zip.files[p]);
  if (ordered.length) return ordered;
  return Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
}

function pptxBlocks(buffer: Buffer, notes: string[]): Block[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  const zip = new PizZip(buffer);
  const blocks: Block[] = [];
  const seenMedia = new Set<string>();
  let imageCount = 0, skippedImages = 0, chartCount = 0;

  slidesInOrder(zip).forEach((slidePath, i) => {
    const xml: string = zip.files[slidePath].asText();
    const { tables, rest } = extractTables(xml);
    const parts: string[] = [`=== Slide ${i + 1} ===`];
    const paragraphs = drawingParagraphs(rest);
    if (paragraphs.length) parts.push(paragraphs.join("\n"));
    tables.forEach((t, ti) => parts.push(`Table ${ti + 1}:\n${t}`));

    const slideImages: Block[] = [];
    for (const rel of relsOf(zip, slidePath)) {
      const target = resolvePart(slidePath, rel.target);
      if (rel.type.endsWith("/chart")) {
        const chartXml: string | undefined = zip.files[target]?.asText();
        if (chartXml) { parts.push(describeChart(chartXml)); chartCount++; }
      } else if (rel.type.endsWith("/notesSlide")) {
        const notesXml: string | undefined = zip.files[target]?.asText();
        // Notes slides repeat the slide number placeholder; drop bare numbers.
        const noteText = notesXml ? drawingParagraphs(notesXml).filter(t => !/^\d+$/.test(t)) : [];
        if (noteText.length) parts.push(`Speaker notes:\n${noteText.join("\n")}`);
      } else if (rel.type.endsWith("/image")) {
        const ext = target.split(".").pop()?.toLowerCase() ?? "";
        const media = IMAGE_MEDIA[ext];
        if (!media || seenMedia.has(target) || !zip.files[target]) continue;
        seenMedia.add(target);
        const data: Buffer = Buffer.from(zip.files[target].asUint8Array());
        if (data.length < MIN_IMAGE_BYTES) continue;
        if (data.length > MAX_IMAGE_BYTES || imageCount >= MAX_IMAGES) { skippedImages++; continue; }
        imageCount++;
        slideImages.push({ type: "image", source: { type: "base64", media_type: media, data: data.toString("base64") } });
      }
    }
    if (slideImages.length) parts.push(`(${slideImages.length} image(s) from this slide follow)`);
    blocks.push({ type: "text", text: parts.join("\n\n") }, ...slideImages);
  });

  if (!blocks.length) throw new Error("No slides found in this PowerPoint file.");
  notes.push(`PowerPoint: ${blocks.filter(b => b.type === "text").length} slides, ${chartCount} native chart(s), ${imageCount} image(s) sent.`);
  if (skippedImages) notes.push(`${skippedImages} image(s) skipped (over 5 MB or more than ${MAX_IMAGES} images). Upload as PDF if key data lives in those images.`);
  return blocks;
}

function cellToText(v: any): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellToText(v.result);
    if ("richText" in v) return v.richText.map((r: any) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("error" in v) return String(v.error);
    return "";
  }
  return String(v).replace(/[\t\r\n]+/g, " ");
}

async function xlsxText(buffer: Buffer, notes: string[]): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out: string[] = [];
  wb.eachSheet((sheet: any) => {
    out.push(`=== Sheet: ${sheet.name}${sheet.state && sheet.state !== "visible" ? " (hidden)" : ""} ===`);
    sheet.eachRow({ includeEmpty: false }, (row: any, rowNumber: number) => {
      const values: any[] = Array.isArray(row.values) ? row.values.slice(1) : [];
      const cells = values.map(cellToText);
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.some(c => c)) out.push(`R${rowNumber}\t${cells.join("\t")}`);
    });
  });
  notes.push(`Excel: ${wb.worksheets.length} sheet(s) read.`);
  return out.join("\n");
}

function capText(text: string, notes: string[]): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  notes.push(`Document text was ${Math.round(text.length / 1000)}K characters; only the first ${MAX_TEXT_CHARS / 1000}K were analysed.`);
  return text.slice(0, MAX_TEXT_CHARS);
}

export async function buildFileContent(buffer: Buffer, ext: string): Promise<{ blocks: Block[]; notes: string[] }> {
  const notes: string[] = [];
  switch (ext) {
    case "pdf":
      if (buffer.length > MAX_PDF_BYTES) {
        throw new Error(`This PDF is ${(buffer.length / 1048576).toFixed(0)} MB; the limit for analysis is 23 MB. Compress it (e.g. "Reduce file size" in Acrobat or Preview) or upload the PPTX instead.`);
      }
      return { blocks: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") } }], notes };
    case "pptx":
      return { blocks: pptxBlocks(buffer, notes), notes };
    case "xlsx":
      return { blocks: [{ type: "text", text: capText(await xlsxText(buffer, notes), notes) }], notes };
    case "docx": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const PizZip = require("pizzip");
      const zip = new PizZip(buffer);
      const text = docxPartNames(zip).flatMap(n => extractDocxTexts(zip.files[n].asText())).join("\n");
      return { blocks: [{ type: "text", text: capText(text, notes) }], notes };
    }
    case "csv":
    case "txt":
      return { blocks: [{ type: "text", text: capText(buffer.toString("utf-8"), notes) }], notes };
    default: {
      const media = IMAGE_MEDIA[ext];
      if (!media) throw new Error(`Unsupported file type: .${ext}`);
      if (buffer.length > MAX_IMAGE_BYTES) throw new Error("Images must be under 5 MB to be analysed.");
      return { blocks: [{ type: "image", source: { type: "base64", media_type: media, data: buffer.toString("base64") } }], notes };
    }
  }
}

// ── Claude call ──────────────────────────────────────────────────────────────

const str = { type: "string" };
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };
const obj = (properties: Record<string, unknown>) => ({
  type: "object", additionalProperties: false, properties, required: Object.keys(properties),
});

const OUTPUT_SCHEMA = obj({
  documentType: str,
  summary: str,
  fields: {
    type: "array",
    items: obj({ field: { type: "string", enum: [...EXTRACTABLE_FIELDS] }, value: str, currency: str, originalText: str, source: str, note: str }),
  },
  financials: {
    type: "array",
    items: obj({
      year: { type: "integer" },
      period: { type: "string", enum: ["actual", "forecast", "budget", "ltm"] },
      revenue: nullableNumber, ebitda: nullableNumber,
      employees: { anyOf: [{ type: "integer" }, { type: "null" }] },
      currency: str, source: str, note: str,
    }),
  },
  founders: { type: "array", items: obj({ name: str, title: str, bio: str, source: str }) },
  keyFacts: { type: "array", items: obj({ label: str, value: str, source: str }) },
  fxRates: { type: "array", items: obj({ currency: str, unitsPerUsd: { type: "number" }, basis: str }) },
  warnings: { type: "array", items: str },
});

function buildInstructions(companyName: string, filename: string, current: Record<string, unknown>): string {
  const known = Object.entries(current)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`).join("\n");
  return `You are an analyst at a private equity firm. The file above ("${filename}") was uploaded to the profile of the company "${companyName}". Extract the facts about ${companyName} that the document actually states, so the team can update the company's profile.

Today's date: ${new Date().toISOString().slice(0, 10)}.

Current profile values (for comparison only; never copy them into your answer unless the document states them):
${known || "(empty profile)"}

Rules:
- Only report what the document states or what follows by simple arithmetic from it (e.g. a margin from revenue and EBITDA). Never use outside knowledge, never guess. If something isn't in the document, leave it out.
- "source" must say where you found it: "Slide 12", "Page 8", "Sheet 'P&L' row 14", "Slide 5 chart 'Revenue'", etc.
- "originalText" is the figure exactly as written, with its units and currency (e.g. "MXN 250.4M", "$12.5mm", "1,240 FTEs").
- Money amounts stay in the document's ORIGINAL currency, written as whole units (MXN 250.4M → 250400000 with currency "MXN"; $12.5mm → 12500000 with currency "USD"). Do not convert currencies yourself.
- For every currency other than USD that you used, add an entry to fxRates with an approximate exchange rate (units of that currency per 1 USD) for the period the figures cover, and say in "basis" what it is (e.g. "Approx. 2024 average"). The team will confirm the rate before saving.
- If a chart or table doesn't state its units, infer them from context (titles, other slides) and say so in "note" and "warnings".
- Percentages are plain numbers (42 means 42%).

fields — one entry per profile field you can fill; "value" is a string:
- description: 1–2 sentences on what the company does and its business model.
- sector: exactly one of ${JSON.stringify(SECTORS)}. country: exactly one of ${JSON.stringify(COUNTRIES)}. stage: exactly one of ${JSON.stringify(STAGES)}. fundingStage: exactly one of ${JSON.stringify(FUNDING_STAGES)}. Omit the field if none fits.
- subsector, city, website, linkedinUrl: plain text / full URL.
- revenueUsd, ebitdaUsd: latest full-year ACTUAL figure (not a forecast), in the original currency (set "currency"). Say the year in "note".
- revenueGrowth: latest actual YoY revenue growth %. ebitdaMargin: latest actual EBITDA margin %.
- employees: current headcount. employeeGrowth: YoY headcount growth %.
- totalFunding: total capital raised to date. lastFundingAmt: most recent round. Both in the original currency (set "currency"). lastFundingDate: YYYY-MM-DD or YYYY-MM.
- "currency" is the ISO code for money fields and an empty string for all other fields.

financials — one row per fiscal year that has revenue, EBITDA or headcount, amounts in the original currency (ISO code in "currency"). Mark each as actual, forecast (projections), budget, or ltm. Use null for missing numbers.

founders — founders and key executives the document names, with title and a one-line bio if given.

keyFacts — up to 15 other decision-relevant metrics (GMV, customers, ARR, churn, CAC, unit economics, market size, use of funds, valuation asked, etc.).

warnings — inconsistencies between figures, numbers that conflict with the current profile values, unclear units, or anything the team should double-check.

summary — 3–5 sentences on what this document is and the most important takeaways. documentType — e.g. "Investor deck", "Financial model", "Teaser", "CIM", "Management accounts".`;
}

export async function extractCompanyData(opts: {
  apiKey: string; buffer: Buffer; ext: string; filename: string; companyName: string; current: Record<string, unknown>;
}): Promise<ExtractionResult> {
  const { blocks, notes } = await buildFileContent(opts.buffer, opts.ext);
  const client = new Anthropic({ apiKey: opts.apiKey });

  const stream = client.messages.stream({
    model: EXTRACT_MODEL,
    max_tokens: 32000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [{
      role: "user",
      content: [...blocks, { type: "text", text: buildInstructions(opts.companyName, opts.filename, opts.current) }],
    }],
  });
  const msg = await stream.finalMessage();

  if (msg.stop_reason === "refusal") throw new Error("The model declined to analyse this document.");
  if (msg.stop_reason === "max_tokens") throw new Error("The analysis ran out of room. Try splitting the document into smaller files.");

  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("");
  let result: ExtractionResult;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("Could not read the model's answer. Please try again.");
  }

  // Drop classification values outside the allowed lists.
  const allowed: Record<string, string[]> = { sector: SECTORS, country: COUNTRIES, stage: STAGES, fundingStage: FUNDING_STAGES };
  result.fxRates = result.fxRates.filter(r => r.currency !== "USD" && Number.isFinite(r.unitsPerUsd) && r.unitsPerUsd > 0);
  result.fields = result.fields.filter(f =>
    f.value.trim() &&
    (!allowed[f.field] || allowed[f.field].includes(f.value)) &&
    (!NUMERIC_FIELDS.has(f.field) || Number.isFinite(Number(f.value))),
  );

  const u = msg.usage;
  const cacheWrite = u.cache_creation_input_tokens ?? 0, cacheRead = u.cache_read_input_tokens ?? 0;
  const costUsd = (u.input_tokens * PRICE_INPUT + cacheWrite * PRICE_CACHE_WRITE + cacheRead * PRICE_CACHE_READ + u.output_tokens * PRICE_OUTPUT) / 1e6;
  result.usage = { inputTokens: u.input_tokens + cacheWrite + cacheRead, outputTokens: u.output_tokens, costUsd, model: EXTRACT_MODEL };
  result.preprocessingNotes = notes;
  return result;
}
