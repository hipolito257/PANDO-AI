// Shared helpers for the document translation feature. Split into pure,
// stateless pieces so a translation job can be extracted once, translated
// across many short-lived serverless calls (avoiding the 300s function
// timeout on very large documents), and reconstructed once at the end.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { XMLParser, XMLBuilder } = require("fast-xml-parser");

export type Direction = "es-en" | "en-es";

// ── Claude translation call, internally chunked + parallelized ───────────────
export async function callTranslateBatch(texts: string[], apiKey: string, direction: Direction): Promise<string[]> {
  if (!texts.length) return [];
  const targetLang = direction === "es-en" ? "English" : "Spanish";
  const sourceLang = direction === "es-en" ? "Spanish" : "English";
  const CHUNK = 40;
  const CONCURRENCY = 5;

  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += CHUNK) chunks.push(texts.slice(i, i + CHUNK));

  async function translateOne(chunk: string[]): Promise<string[]> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8192,
        messages: [{
          role: "user",
          content: `You are a professional ${sourceLang}-to-${targetLang} document translator for a private equity fund. Translate each string in the JSON array below from ${sourceLang} to ${targetLang}.

RULES:
- Preserve meaning, tone, and register exactly — these may be formal business, financial, or legal documents.
- Translate everything into ${targetLang}, including abbreviations, acronyms, units, and job titles — give the standard ${targetLang} form where one exists (e.g. an acronym that expands to a translatable phrase should have its expansion translated, even if the acronym letters themselves stay the same).${targetLang === "Spanish" ? `
- Use correct, fully-accented Spanish orthography: written accent marks (á, é, í, ó, ú) and the ñ/Ñ wherever standard spelling requires them (e.g. "año" not "ano", "años" not "anos", "compañía" not "compania", "según" not "segun"). Never drop an accent or tilde to produce plain ASCII.` : ""}
- The ONLY things that must stay unchanged are proper names: company names, people's names, brand names, and product names. Do not translate these even if they look like ordinary words.
- Keep numbers, dates, currency symbols, and percentages unchanged (format only, not surrounding words).
- Preserve any placeholder tokens exactly as-is (e.g. "{{name}}", "%s", "{0}").
- If a string is just a number, date, symbol, or proper name with no other translatable text, return it unchanged.
- Return ONLY a JSON array of the same length and in the same order as the input, containing the translated strings. No markdown, no explanation, no extra text.

INPUT:
${JSON.stringify(chunk)}`,
        }],
      }),
      signal: AbortSignal.timeout(110000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error: ${res.status} ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const blocks: { type?: string; text?: string }[] = Array.isArray(data?.content) ? data.content : [];
    const aiText = blocks.filter(b => b?.type === "text").map(b => b.text ?? "").join("");
    const jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("Translation response did not contain a JSON array");

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length !== chunk.length) {
      throw new Error("Translation batch length mismatch");
    }
    return parsed.map((v: unknown) => (typeof v === "string" ? v : String(v)));
  }

  const results: string[][] = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const group = chunks.slice(i, i + CONCURRENCY);
    const groupResults = await Promise.all(group.map(translateOne));
    for (let j = 0; j < groupResults.length; j++) results[i + j] = groupResults[j];
  }

  return results.flat();
}

// ── DOCX/PPTX: AST-based extraction & reconstruction ─────────────────────────
// We parse the OOXML with a real XML parser (preserving element order and all
// attributes) instead of regex, and only ever mutate the text content of leaf
// <w:t>/<a:t> nodes in place. Every other node — runs, run properties, tracked
// changes (w:ins/w:del/pPrChange/rPrChange), drawings, hyperlinks, fields,
// tables, textboxes — is copied back untouched, so formatting is guaranteed to
// stay pixel-identical. Regex-based paragraph slicing previously mis-parsed
// nested <w:pPr> (from tracked paragraph-format changes), silently corrupting
// or dropping content such as entire footnotes.

const XML_PARSE_OPTS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: false,
  processEntities: true,
};
const XML_BUILD_OPTS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  suppressEmptyNode: false,
  unpairedTags: [] as string[],
};

type XNode = Record<string, any>;

function tagOf(node: XNode): string | null {
  for (const k of Object.keys(node)) if (k !== ":@") return k;
  return null;
}

// Walks the tree collecting one entry per paragraph: the ordered list of its
// own <w:t>/<a:t> leaf nodes. A paragraph nested inside another (e.g. a
// textbox's txbxContent inside a drawing) is treated as its own independent
// entry — its text is not merged into the surrounding paragraph.
function collectParagraphTextNodes(root: XNode[], pTag: string, tTag: string, fldTag: string | null): XNode[][] {
  const paragraphs: XNode[][] = [];

  function collectLeaves(nodes: XNode[], out: XNode[]) {
    for (const node of nodes) {
      if (node["#text"] !== undefined) continue;
      const tag = tagOf(node);
      if (!tag) continue;
      if (tag === pTag) { processParagraph(node); continue; }
      if (fldTag && tag === fldTag) continue; // field code (e.g. slide number) — leave untranslated
      if (tag === tTag) { out.push(node); continue; }
      if (Array.isArray(node[tag])) collectLeaves(node[tag], out);
    }
  }

  function processParagraph(pNode: XNode) {
    const tag = tagOf(pNode)!;
    const textNodes: XNode[] = [];
    collectLeaves(pNode[tag] ?? [], textNodes);
    paragraphs.push(textNodes);
  }

  function walk(nodes: XNode[]) {
    for (const node of nodes) {
      if (node["#text"] !== undefined) continue;
      const tag = tagOf(node);
      if (!tag) continue;
      if (tag === pTag) { processParagraph(node); continue; }
      if (Array.isArray(node[tag])) walk(node[tag]);
    }
  }

  walk(root);
  return paragraphs;
}

function nodeText(tNode: XNode, tTag: string): string {
  return (tNode[tTag] ?? []).map((c: XNode) => c["#text"] ?? "").join("");
}

function setNodeText(tNode: XNode, tTag: string, text: string) {
  tNode[tTag] = text.length ? [{ "#text": text }] : [];
  if (/^\s|\s$/.test(text)) {
    tNode[":@"] = { ...(tNode[":@"] ?? {}), "@_xml:space": "preserve" };
  }
}

// Snaps a proportional split point to the nearest word boundary (within 8
// chars) so a translated sentence spread across multiple runs (e.g. part
// bold, part not) doesn't get cut mid-word.
function snapToSpace(text: string, idx: number): number {
  if (idx <= 0) return 0;
  if (idx >= text.length) return text.length;
  if (text[idx] === " ") return idx;
  for (let d = 1; d <= 8; d++) {
    if (text[idx - d] === " ") return idx - d + 1;
    if (text[idx + d] === " ") return idx + d;
  }
  return idx;
}

// Splits translated text across the N original run-text lengths, proportional
// to each run's original share of the paragraph, so each run keeps its own
// formatting (bold/italic/color spans) instead of collapsing into one run.
function distributeTranslated(translated: string, originalLens: number[]): string[] {
  if (originalLens.length <= 1) return [translated];
  const total = originalLens.reduce((a, b) => a + b, 0);
  if (total === 0) {
    const maxIdx = originalLens.indexOf(Math.max(...originalLens));
    return originalLens.map((_, i) => (i === maxIdx ? translated : ""));
  }
  const cuts: number[] = [];
  let cum = 0;
  for (let i = 0; i < originalLens.length - 1; i++) {
    cum += originalLens[i];
    let idx = snapToSpace(translated, Math.round((cum / total) * translated.length));
    if (cuts.length && idx < cuts[cuts.length - 1]) idx = cuts[cuts.length - 1];
    cuts.push(idx);
  }
  const parts: string[] = [];
  let prev = 0;
  for (const c of cuts) { parts.push(translated.slice(prev, c)); prev = c; }
  parts.push(translated.slice(prev));
  return parts;
}

function extractXmlTexts(xml: string, pTag: string, tTag: string, fldTag: string | null): string[] {
  const ast = new XMLParser(XML_PARSE_OPTS).parse(xml);
  const paragraphs = collectParagraphTextNodes(ast, pTag, tTag, fldTag);
  const texts: string[] = [];
  for (const nodes of paragraphs) {
    if (!nodes.length) continue;
    const merged = nodes.map(n => nodeText(n, tTag)).join("");
    if (!merged.trim()) continue;
    texts.push(merged);
  }
  return texts;
}

function reconstructXml(xml: string, translatedTexts: string[], pTag: string, tTag: string, fldTag: string | null): string {
  const ast = new XMLParser(XML_PARSE_OPTS).parse(xml);
  const paragraphs = collectParagraphTextNodes(ast, pTag, tTag, fldTag);
  let ti = 0;
  for (const nodes of paragraphs) {
    if (!nodes.length) continue;
    const originalTexts = nodes.map(n => nodeText(n, tTag));
    const merged = originalTexts.join("");
    if (!merged.trim()) continue;
    const translated = translatedTexts[ti++] ?? merged;
    const parts = distributeTranslated(translated, originalTexts.map(t => t.length));
    nodes.forEach((n, i) => setNodeText(n, tTag, parts[i] ?? ""));
  }
  return new XMLBuilder(XML_BUILD_OPTS).build(ast);
}

export function extractDocxTexts(xml: string): string[] {
  return extractXmlTexts(xml, "w:p", "w:t", null);
}
export function reconstructDocxXml(xml: string, translatedTexts: string[]): string {
  return reconstructXml(xml, translatedTexts, "w:p", "w:t", null);
}
export function extractPptxTexts(xml: string): string[] {
  return extractXmlTexts(xml, "a:p", "a:t", "a:fld");
}
export function reconstructPptxXml(xml: string, translatedTexts: string[]): string {
  return reconstructXml(xml, translatedTexts, "a:p", "a:t", "a:fld");
}

export function docxPartNames(zip: any): string[] {
  return Object.keys(zip.files).filter(n => /^word\/(document|header\d*|footer\d*|footnotes|endnotes).*\.xml$/.test(n));
}
export function pptxPartNames(zip: any): string[] {
  return Object.keys(zip.files).filter(n => /^ppt\/(slides|notesSlides)\/.*\.xml$/.test(n));
}

// ── XLSX: flat list of string cells (in deterministic traversal order) + sheet names ──
export async function extractXlsxSegments(buffer: Buffer): Promise<{ cellTexts: string[]; sheetNames: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const cellTexts: string[] = [];
  wb.eachSheet((sheet: any) => {
    sheet.eachRow({ includeEmpty: false }, (row: any) => {
      row.eachCell({ includeEmpty: false }, (cell: any) => {
        if (typeof cell.value === "string" && cell.value.trim()) cellTexts.push(cell.value);
      });
    });
  });
  const sheetNames = wb.worksheets.map((s: any) => s.name);
  return { cellTexts, sheetNames };
}

export async function applyXlsxSegments(buffer: Buffer, cellTexts: string[], sheetNames: string[]): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  let ci = 0;
  wb.eachSheet((sheet: any) => {
    sheet.eachRow({ includeEmpty: false }, (row: any) => {
      row.eachCell({ includeEmpty: false }, (cell: any) => {
        if (typeof cell.value === "string" && cell.value.trim()) {
          if (cellTexts[ci] !== undefined) cell.value = cellTexts[ci];
          ci++;
        }
      });
    });
  });
  wb.worksheets.forEach((s: any, i: number) => { if (sheetNames[i]) s.name = sheetNames[i]; });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface TranslateJob {
  id: string;
  ext: "docx" | "pptx" | "xlsx";
  direction: Direction;
  filename: string;
  sourceBlobUrl: string;
  parts: { name: string; length: number }[];
  total: number;
  segments: string[];
  translated: (string | null)[];
  createdAt: number;
}
