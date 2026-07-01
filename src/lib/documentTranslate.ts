// Shared helpers for the document translation feature. Split into pure,
// stateless pieces so a translation job can be extracted once, translated
// across many short-lived serverless calls (avoiding the 300s function
// timeout on very large documents), and reconstructed once at the end.

export type Direction = "es-en" | "en-es";

export function escapeXmlText(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        messages: [{
          role: "user",
          content: `You are a professional ${sourceLang}-to-${targetLang} document translator for a private equity fund. Translate each string in the JSON array below from ${sourceLang} to ${targetLang}.

RULES:
- Preserve meaning, tone, and register exactly — these may be formal business, financial, or legal documents.
- Keep numbers, dates, currency symbols, percentages, proper nouns, company names, and acronyms unchanged unless they have a standard translated form.
- Preserve any placeholder tokens exactly as-is (e.g. "{{name}}", "%s", "{0}").
- If a string is already fully in ${targetLang}, or has no translatable text (e.g. just a number, date, or symbol), return it unchanged.
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
    const aiText: string = data?.content?.[0]?.text ?? "";
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

// ── DOCX: extract merged paragraph text (flattening runs), and reconstruct ──
// Paragraphs containing images, hyperlinks, or fields are left untouched and
// are NOT included in the extracted segment list.
export function extractDocxTexts(xml: string): string[] {
  const texts: string[] = [];
  for (const m of xml.matchAll(/<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/g)) {
    const inner = m[2];
    if (/<w:drawing\b|<w:hyperlink\b|<w:pict\b|<w:object\b|<w:fldSimple\b|<w:fldChar\b/.test(inner)) continue;
    const pPrMatch = inner.match(/^\s*<w:pPr\b[\s\S]*?<\/w:pPr>/);
    const afterPPr = pPrMatch ? inner.slice(pPrMatch[0].length) : inner;
    const runs = [...afterPPr.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)];
    if (!runs.length) continue;

    let mergedText = "";
    for (const r of runs) {
      mergedText += [...r[0].matchAll(/<w:t(?:\s+[\w:]+="[^"]*")*\s*>([\s\S]*?)<\/w:t>/g)].map(x => x[1]).join("");
    }
    if (!mergedText.trim()) continue;
    texts.push(mergedText);
  }
  return texts;
}

export function reconstructDocxXml(xml: string, translatedTexts: string[]): string {
  let ti = 0;
  return xml.replace(/<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/g, (full, pAttrs, inner) => {
    if (/<w:drawing\b|<w:hyperlink\b|<w:pict\b|<w:object\b|<w:fldSimple\b|<w:fldChar\b/.test(inner)) return full;
    const pPrMatch = inner.match(/^\s*<w:pPr\b[\s\S]*?<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[0] : "";
    const afterPPr = pPrMatch ? inner.slice(pPrMatch[0].length) : inner;
    const runs = [...afterPPr.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)];
    if (!runs.length) return full;

    let mergedText = "";
    for (const r of runs) {
      mergedText += [...r[0].matchAll(/<w:t(?:\s+[\w:]+="[^"]*")*\s*>([\s\S]*?)<\/w:t>/g)].map(x => x[1]).join("");
    }
    if (!mergedText.trim()) return full;

    let firstRPr = "";
    for (const r of runs) {
      const rPrMatch = r[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
      if (rPrMatch) { firstRPr = rPrMatch[0]; break; }
    }

    const newText = escapeXmlText(translatedTexts[ti++] ?? mergedText);
    const newRun = `<w:r>${firstRPr}<w:t xml:space="preserve">${newText}</w:t></w:r>`;
    return `<w:p${pAttrs}>${pPr}${newRun}</w:p>`;
  });
}

// ── PPTX: same idea at the <a:p>/<a:r>/<a:t> level (shapes, tables, notes) ───
export function extractPptxTexts(xml: string): string[] {
  const texts: string[] = [];
  for (const m of xml.matchAll(/<a:p\b([^>]*)>([\s\S]*?)<\/a:p>/g)) {
    const inner = m[2];
    if (/<a:fld\b/.test(inner)) continue;
    const pPrMatch = inner.match(/^\s*<a:pPr\b[\s\S]*?(?:\/>|<\/a:pPr>)/);
    const afterPPr = pPrMatch ? inner.slice(pPrMatch[0].length) : inner;
    const runs = [...afterPPr.matchAll(/<a:r\b[\s\S]*?<\/a:r>/g)];
    if (!runs.length) continue;

    let mergedText = "";
    for (const r of runs) {
      mergedText += [...r[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(x => x[1]).join("");
    }
    if (!mergedText.trim()) continue;
    texts.push(mergedText);
  }
  return texts;
}

export function reconstructPptxXml(xml: string, translatedTexts: string[]): string {
  let ti = 0;
  return xml.replace(/<a:p\b([^>]*)>([\s\S]*?)<\/a:p>/g, (full, pAttrs, inner) => {
    if (/<a:fld\b/.test(inner)) return full;
    const pPrMatch = inner.match(/^\s*<a:pPr\b[\s\S]*?(?:\/>|<\/a:pPr>)/);
    const pPr = pPrMatch ? pPrMatch[0] : "";
    const afterPPr = pPrMatch ? inner.slice(pPrMatch[0].length) : inner;
    const runs = [...afterPPr.matchAll(/<a:r\b[\s\S]*?<\/a:r>/g)];
    if (!runs.length) return full;

    let mergedText = "";
    for (const r of runs) {
      mergedText += [...r[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(x => x[1]).join("");
    }
    if (!mergedText.trim()) return full;

    let firstRPr = "";
    for (const r of runs) {
      const rPrMatch = r[0].match(/<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/);
      if (rPrMatch) { firstRPr = rPrMatch[0]; break; }
    }

    const newText = escapeXmlText(translatedTexts[ti++] ?? mergedText);
    const newRun = `<a:r>${firstRPr}<a:t>${newText}</a:t></a:r>`;
    return `<a:p${pAttrs}>${pPr}${newRun}</a:p>`;
  });
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
