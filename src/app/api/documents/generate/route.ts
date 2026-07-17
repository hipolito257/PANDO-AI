import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentTemplates, companies, compSets, publicComps } from "@/lib/schema";
import path from "path";
import fs from "fs";
import { fmtMoneyDoc } from "@/lib/utils";

export const maxDuration = 300;

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "templates");

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtB(n: unknown): string {
  if (n == null) return "N/D";
  const v = Number(n);
  return isNaN(v) ? "N/D" : fmtMoneyDoc(v);
}
function fmtPct(n: unknown): string {
  if (n == null) return "N/D";
  const v = Number(n);
  return isNaN(v) ? "N/D" : `${(v * 100).toFixed(1)}%`;
}
function fmtX(n: unknown): string {
  if (n == null) return "N/D";
  const v = Number(n);
  return isNaN(v) ? "N/D" : `${v.toFixed(1)}x`;
}
function today(): string {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

// ── Normalize PPTX XML runs: merge adjacent plain runs within each paragraph ──
// PPTX splits text across multiple <a:r> runs (spell-check, cursor position, etc.)
// e.g. "Goldman Sachs" stored as <a:r><a:t>Goldman </a:t></a:r><a:r><a:t>Sachs</a:t></a:r>
// After normalization it's a single run, making string find/replace reliable.
function normalizeXmlRuns(xml: string): string {
  // Merge adjacent <a:r> that contain ONLY <a:t> (no rPr / no formatting)
  // Runs with formatting (<a:rPr ...>) are left untouched to preserve styling
  let changed = true;
  let result = xml;
  while (changed) {
    const prev = result;
    // Pattern: </a:t></a:r> immediately followed by <a:r><a:t> (optional whitespace)
    // Both runs must be plain (no rPr between <a:r> and <a:t>)
    result = result.replace(
      /<a:r>\s*<a:t>([\s\S]*?)<\/a:t>\s*<\/a:r>\s*<a:r>\s*<a:t>([\s\S]*?)<\/a:t>\s*<\/a:r>/g,
      "<a:r><a:t>$1$2</a:t></a:r>",
    );
    changed = result !== prev;
  }
  return result;
}

// ── Extract text from PPTX, structured per slide/shape ────────────────────────
// Returns a human-readable outline that Claude can target precisely.
function extractPptxStructured(buffer: Buffer): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  try {
    const zip = new PizZip(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)![0]);
        const nb = parseInt(b.match(/\d+/)![0]);
        return na - nb;
      });

    const lines: string[] = [];
    for (let si = 0; si < slideFiles.length; si++) {
      const slideXml = normalizeXmlRuns(zip.files[slideFiles[si]].asText());
      const slideLines: string[] = [`=== SLIDE ${si + 1} ===`];

      // Extract each shape's text
      const shapeRegex = /<p:sp\b[\s\S]*?<\/p:sp>/g;
      let shapeMatch: RegExpExecArray | null;
      let shapeIdx = 0;
      while ((shapeMatch = shapeRegex.exec(slideXml)) !== null) {
        const shapeXml = shapeMatch[0];

        // Get shape name if available
        const nameMatch = shapeXml.match(/cNvPr[^>]*name="([^"]+)"/);
        const shapeName = nameMatch ? nameMatch[1] : `Shape ${++shapeIdx}`;

        // Extract text runs per paragraph, joining them
        const paragraphs: string[] = [];
        const paraRegex = /<a:p\b[\s\S]*?<\/a:p>/g;
        let paraMatch: RegExpExecArray | null;
        while ((paraMatch = paraRegex.exec(shapeXml)) !== null) {
          const paraText = [...paraMatch[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
            .map(m => m[1]).join("").trim();
          if (paraText) paragraphs.push(paraText);
        }

        if (paragraphs.length) {
          slideLines.push(`  [${shapeName}]: ${paragraphs.join(" | ")}`);
        }
      }

      if (slideLines.length > 1) lines.push(...slideLines);
    }

    return lines.join("\n").slice(0, 40000);
  } catch { return ""; }
}

// ── Normalize DOCX XML runs: flatten each paragraph into a single run ────────
// Word routinely splits one visual sentence across multiple <w:r> runs —
// not just from spell-check, but whenever formatting changes mid-paragraph
// (e.g. a bold label "Overview. " followed by plain body text is TWO runs).
// A literal find/replace across raw XML can only ever match text that is
// contiguous in a single run, so any find string spanning a formatting
// boundary silently fails to match — the actual root cause of DOCX generation
// leaving the template unchanged. Fix: merge every paragraph's runs into one,
// using the first run's formatting for the merged text. Paragraphs containing
// images, hyperlinks, or fields are left untouched so nothing gets destroyed.
function normalizeWordRuns(xml: string): string {
  return xml.replace(/<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/g, (full, pAttrs, inner) => {
    if (/<w:drawing\b|<w:hyperlink\b|<w:pict\b|<w:object\b|<w:fldSimple\b|<w:fldChar\b/.test(inner)) {
      return full;
    }

    const pPrMatch = inner.match(/^\s*<w:pPr\b[\s\S]*?<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[0] : "";
    const afterPPr = pPrMatch ? inner.slice(pPrMatch[0].length) : inner;

    const runs = [...afterPPr.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)];
    if (runs.length === 0) return full;

    let firstRPr = "";
    let mergedText = "";
    for (const r of runs) {
      const runXml = r[0];
      if (!firstRPr) {
        const rPrMatch = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
        if (rPrMatch) firstRPr = rPrMatch[0];
      }
      const texts = [...runXml.matchAll(/<w:t(?:\s+[\w:]+="[^"]*")*\s*>([\s\S]*?)<\/w:t>/g)].map(m => m[1]);
      mergedText += texts.join("");
    }

    if (!mergedText) return full;

    const newRun = `<w:r>${firstRPr}<w:t xml:space="preserve">${mergedText}</w:t></w:r>`;
    return `<w:p${pAttrs}>${pPr}${newRun}</w:p>`;
  });
}

// ── Extract text from DOCX, structured per paragraph ──────────────────────────
// Normalizes runs first so paragraph text is contiguous and exactly matches
// what applyReplacementsToOffice will search against — required for reliable
// find/replace (raw entities like &amp; are kept as-is, not decoded).
function extractDocxStructured(buffer: Buffer): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  try {
    const zip = new PizZip(buffer);
    const file = zip.files["word/document.xml"];
    if (!file) return "";
    const xml = normalizeWordRuns(file.asText());

    const lines: string[] = [];
    const paraRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
    let m: RegExpExecArray | null;
    while ((m = paraRegex.exec(xml)) !== null) {
      const paraText = [...m[0].matchAll(/<w:t(?:\s+[\w:]+="[^"]*")*\s*>([\s\S]*?)<\/w:t>/g)]
        .map(x => x[1]).join("");
      if (paraText.trim()) lines.push(paraText);
    }
    return lines.join("\n").slice(0, 40000);
  } catch { return ""; }
}

// ── Extract text from Office docs (DOCX / PPTX / XLSX) ────────────────────────
function extractOfficeText(buffer: Buffer, ext: string): string {
  if (ext === "pptx") return extractPptxStructured(buffer);
  if (ext === "docx") return extractDocxStructured(buffer);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  try {
    const zip = new PizZip(buffer);
    const xmlFiles = Object.keys(zip.files).filter(name => {
      if (ext === "xlsx") return !!name.match(/^xl\/worksheets\/sheet\d+\.xml$/) || name === "xl/sharedStrings.xml";
      return false;
    });
    return xmlFiles.map(fname => {
      try {
        return zip.files[fname].asText()
          .replace(/<[^>]*>/g, " ")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#xA;/g, "\n")
          .replace(/\s+/g, " ").trim();
      } catch { return ""; }
    }).filter(Boolean).join("\n").slice(0, 10000);
  } catch { return ""; }
}

// Escape XML special chars so replacements don't corrupt the document XML
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Apply text replacements to Office docs ────────────────────────────────────
function applyReplacementsToOffice(
  buffer: Buffer, type: string,
  replacements: { find: string; replace: string }[]
): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  const zip = new PizZip(buffer);
  const xmlFiles = Object.keys(zip.files).filter(name => {
    if (type === "pptx") return !!name.match(/^ppt\/(slides|noteSlides)\/.*\.xml$/);
    if (type === "docx") return !!name.match(/^word\/(document|header\d*|footer\d*).*\.xml$/);
    return false;
  });
  let totalMatched = 0;
  for (const fname of xmlFiles) {
    try {
      let content = type === "pptx"
        ? normalizeXmlRuns(zip.files[fname].asText())
        : type === "docx"
        ? normalizeWordRuns(zip.files[fname].asText())
        : zip.files[fname].asText();
      for (const { find, replace } of replacements) {
        if (find && find.length > 1 && content.includes(find)) {
          totalMatched++;
          // Escape replacement value so special chars don't break the XML
          content = content.split(find).join(escapeXml(replace));
        }
      }
      zip.file(fname, content);
    } catch { /* skip */ }
  }
  console.log(`[applyReplacementsToOffice] ${type}: ${totalMatched}/${replacements.length} replacements matched at least one file`);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

// ── Apply replacements to XLSX ─────────────────────────────────────────────────
async function applyReplacementsToXlsx(
  buffer: Buffer, replacements: { find: string; replace: string }[]
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  wb.eachSheet((sheet: any) => {
    sheet.eachRow({ includeEmpty: false }, (row: any) => {
      row.eachCell({ includeEmpty: false }, (cell: any) => {
        if (typeof cell.value === "string") {
          let v = cell.value;
          for (const { find, replace } of replacements) {
            if (find) v = v.split(find).join(replace);
          }
          cell.value = v;
        }
      });
    });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── Generate with {{}} placeholders (docxtemplater) ───────────────────────────
function generateWithPlaceholders(buffer: Buffer, values: Record<string, string>): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Docxtemplater = require("docxtemplater");
  const zip = new PizZip(buffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true, linebreaks: true,
    nullGetter: (part: { value: string }) => `[${part.value}]`,
  });
  doc.render(values);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}

// ── Context file → Claude content block ───────────────────────────────────────
// Claude natively reads: PDFs as "document", images as "image",
// everything else we extract text and send as plain text.
interface ContextFile { name: string; buffer: Buffer; mimeType: string; }

function buildContextBlock(file: ContextFile): any {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  // PDFs → Claude document block (reads natively, much more accurate)
  if (file.mimeType === "application/pdf" || ext === "pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: file.buffer.toString("base64") },
      title: file.name,
    };
  }

  // Images → Claude image block
  const imgMime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
  if (imgMime[ext as keyof typeof imgMime]) {
    return {
      type: "image",
      source: { type: "base64", media_type: imgMime[ext as keyof typeof imgMime], data: file.buffer.toString("base64") },
    };
  }

  // Office docs → extract text
  if (["docx", "pptx", "xlsx"].includes(ext)) {
    const text = extractOfficeText(file.buffer, ext);
    return text
      ? { type: "text", text: `--- ${file.name} ---\n${text}\n---` }
      : null;
  }

  // Plain text / CSV / other
  const text = file.buffer.toString("utf-8").slice(0, 10000);
  return text.trim()
    ? { type: "text", text: `--- ${file.name} ---\n${text}\n---` }
    : null;
}

// ── Generate a new XLSX with Claude-decided structure and data ────────────────
async function generateXlsxNewContent(
  templateBuffer: Buffer,
  company: CompanyRow | null,
  peers: { ticker: string; evRevenue?: number|null; evEbitda?: number|null }[],
  contextFiles: ContextFile[],
  apiKey: string,
  userPrompt: string | null
): Promise<Buffer> {
  const medRev  = median(peers.map(p => Number(p.evRevenue)).filter(n => !isNaN(n) && n > 0));
  const medEbit = median(peers.map(p => Number(p.evEbitda)).filter(n => !isNaN(n) && n > 0));

  const companyCard = company ? `
Company: ${company.name} | Sector: ${company.sector ?? "N/D"} | Country: ${company.country}
Revenue: ${fmtB(company.revenueUsd)} | Growth: ${fmtPct(company.revenueGrowth)}
EBITDA: ${fmtB(company.ebitdaUsd)} | Margin: ${fmtPct(company.ebitdaMargin)}
Employees: ${company.employees ?? "N/D"} | Stage: ${company.stage ?? "N/D"}
Total funding: ${fmtB(company.totalFunding)} | Description: ${company.description ?? "N/D"}
EV/Revenue peers: ${medRev ? fmtX(medRev) : "N/D"} | EV/EBITDA peers: ${medEbit ? fmtX(medEbit) : "N/D"}
Date: ${today()}
`.trim() : null;

  const contentBlocks: any[] = [];
  if (contextFiles.length > 0) {
    contentBlocks.push({ type: "text", text: `Reference documents (${contextFiles.length}):` });
    for (const f of contextFiles) {
      const block = buildContextBlock(f);
      if (block) contentBlocks.push(block);
    }
  }

  contentBlocks.push({
    type: "text",
    text: `You are a financial analyst at PANDO, a private equity fund.

YOUR TASK: Generate a COMPLETELY NEW Excel with original data.
- Do NOT copy the structure of any existing template.
- YOU decide which sheets to create, which columns to use, which data to include.
- Use the company data and reference documents for the content.
- The Excel should be useful for investment analysis.

${companyCard ? `COMPANY DATA:\n${companyCard}` : ""}
${userPrompt ? `\nUSER INSTRUCTIONS:\n${userPrompt}` : ""}

LANGUAGE — CRITICAL: Write every sheet name, header, and cell value in English, even if the reference documents or company data are in Spanish or another language. Translate anything you pull from those sources into English. Never mix languages in the output.

MONEY FORMAT: Write every money figure exactly like this: "USD $200 m" (millions), "USD $850 k" (thousands), "USD $1.2 bn" (billions) — currency code, then symbol+number, then a space and lowercase suffix (k/m/bn). Use "MXN $" or "EUR €" instead of "USD $" when the figure is explicitly in pesos or euros. Never write "$200M", "200 million dollars", or similar.

RESPONSE FORMAT — return ONLY this JSON (no extra text, no markdown):
{
  "sheets": [
    {
      "name": "Sheet name",
      "headers": ["Col1", "Col2", "Col3"],
      "rows": [
        ["value1", "value2", "value3"],
        ["value4", "value5", "value6"]
      ]
    }
  ]
}

Generate between 1 and 4 sheets with real, complete data. Do not use placeholders.`
  });

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
      messages: [{ role: "user", content: contentBlocks }],
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json();
  const aiText: string = data?.content?.[0]?.text ?? "";

  const jsonMatch = aiText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude did not return valid JSON for the Excel");

  const plan: { sheets: { name: string; headers: string[]; rows: (string|number)[][] }[] } = JSON.parse(jsonMatch[0]);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();

  for (const sheetDef of plan.sheets) {
    const ws = wb.addWorksheet(sheetDef.name);

    // Define columns with width up-front (required for ExcelJS to track them)
    ws.columns = sheetDef.headers.map((h: string, idx: number) => {
      const maxLen = Math.max(
        h.length,
        ...sheetDef.rows.map((r: (string|number)[]) => String(r[idx] ?? "").length)
      );
      return { header: "", key: `c${idx}`, width: Math.min(Math.max(maxLen + 4, 12), 40) };
    });

    // Header row — bold, dark green background (PANDO brand)
    const headerRow = ws.addRow(sheetDef.headers);
    headerRow.eachCell((cell: any) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF004F46" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = { bottom: { style: "thin", color: { argb: "FF437742" } } };
    });
    headerRow.height = 22;

    // Data rows
    for (const row of sheetDef.rows) {
      const dataRow = ws.addRow(row);
      dataRow.eachCell((cell: any, colIdx: number) => {
        cell.font = { name: "Calibri", size: 10 };
        cell.alignment = { vertical: "middle", horizontal: colIdx === 1 ? "left" : "center" };
      });
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── Main AI call: build document from template + context ──────────────────────
interface CompanyRow {
  name: string; sector?: string|null; subsector?: string|null; country: string;
  city?: string|null; stage?: string|null; website?: string|null; description?: string|null;
  revenueUsd?: number|null; revenueGrowth?: number|null; ebitdaUsd?: number|null;
  ebitdaMargin?: number|null; employees?: number|null; totalFunding?: number|null;
  lastFundingAmt?: number|null; fundingStage?: string|null; score?: number|null;
}

async function generateWithAI(
  templateBuffer: Buffer,
  templateType: string,
  company: CompanyRow | null,
  peers: { ticker: string; evRevenue?: number|null; evEbitda?: number|null }[],
  contextFiles: ContextFile[],
  userApiKey: string | null,
  userPrompt: string | null
): Promise<{ buffer: Buffer; replacements: { find: string; replace: string }[] }> {
  if (!userApiKey) return { buffer: templateBuffer, replacements: [] };
  const apiKey = userApiKey;

  const medRev  = median(peers.map(p => Number(p.evRevenue)).filter(n => !isNaN(n) && n > 0));
  const medEbit = median(peers.map(p => Number(p.evEbitda)).filter(n => !isNaN(n) && n > 0));

  const companyCard = company ? `
Company: ${company.name}
Sector: ${company.sector ?? "N/D"} | Country: ${company.country} | City: ${company.city ?? "N/D"}
Description: ${company.description ?? "N/D"}
Revenue: ${fmtB(company.revenueUsd)} | YoY Growth: ${fmtPct(company.revenueGrowth)}
EBITDA: ${fmtB(company.ebitdaUsd)} | EBITDA Margin: ${fmtPct(company.ebitdaMargin)}
Employees: ${company.employees ?? "N/D"} | Stage: ${company.stage ?? "N/D"} | PANDO Score: ${company.score?.toFixed(1) ?? "N/D"}
Total funding: ${fmtB(company.totalFunding)} | Last round: ${fmtB(company.lastFundingAmt)} | Funding stage: ${company.fundingStage ?? "N/D"}
Public peers: ${peers.map(p => p.ticker).join(", ") || "N/D"}
EV/Revenue median (peers): ${medRev ? fmtX(medRev) : "N/D"}
EV/EBITDA median (peers): ${medEbit ? fmtX(medEbit) : "N/D"}
Date: ${today()}
`.trim() : null;

  const templateText = extractOfficeText(templateBuffer, templateType);

  // Build message content — context files first, then instructions
  const contentBlocks: any[] = [];

  // Add context files
  if (contextFiles.length > 0) {
    contentBlocks.push({
      type: "text",
      text: `Below are ${contextFiles.length} supporting document(s). Read them carefully to extract relevant data:`
    });
    for (const f of contextFiles) {
      const block = buildContextBlock(f);
      if (block) contentBlocks.push(block);
    }
  }

  // Main instruction
  const companySection = companyCard
    ? `COMPANY DATA (PANDO database):\n${companyCard}\n\n${contextFiles.length > 0 ? "IMPORTANT: The supporting documents above contain additional information. Prioritize that data if it is more detailed or current than the database's." : ""}`
    : "";

  const userInstructions = userPrompt
    ? `SPECIFIC USER INSTRUCTIONS:\n${userPrompt}\n\nFollow these instructions as the main guide for customizing the document.`
    : "";

  const hasCompanyData = !!companySection;
  const hasInstructions = !!userInstructions;

  contentBlocks.push({
    type: "text",
    text: `You are an expert in document analysis and professional content generation. Your task is to modify an existing document according to the instructions and data provided.

${hasCompanyData ? `TARGET COMPANY DATA:\n${companySection}` : ""}
${hasInstructions ? `${userInstructions}` : ""}
${!hasCompanyData && !hasInstructions ? "No company data or specific instructions were provided. Adapt the document generically: replace company names with \"[Company]\" and financial data with \"N/D\", keeping the structure." : ""}

CURRENT DOCUMENT CONTENT (section by section):
${templateText || "(document with no extractable text)"}

MODIFICATION RULES:
1. Generate one replacement per element that needs to change, using the EXACT text from the document in "find".
2. ${hasCompanyData ? "Replace everything specific to the original company with target company data: name(s), metrics, history, people, investors, geography." : "Apply the changes indicated in the instructions to the document text."}
3. For narrative text, keep the same tone and length as the original.
4. Keep UNCHANGED (in content): generic section titles, column labels, structural headers — do not remove or restructure them.
5. LANGUAGE — CRITICAL: The final document must be entirely in English, with no mixed languages. This applies to every piece of text you write in "replace", INCLUDING generic section titles/column labels/structural headers if they are not already in English — translate them to English as part of your replacements rather than leaving them unchanged. Never output Spanish (or any other language) text anywhere in "replace".
6. CRITICAL: The "find" field must be the EXACT text as it appears in the document (including "&amp;" if "&amp;" appears), even if that text is in a non-English language.
7. MONEY FORMAT: Write every money figure exactly like this: "USD $200 m" (millions), "USD $850 k" (thousands), "USD $1.2 bn" (billions) — currency code, then symbol+number, then a space and lowercase suffix (k/m/bn). Use "MXN $" or "EUR €" instead of "USD $" when the figure is explicitly in pesos or euros. Never write "$200M", "200 million dollars", or similar.

Respond ONLY with a JSON array (no text, no markdown):
[{"find": "exact text from the document", "replace": "new content"}, ...]

If the document has real content, generate between 5 and 60 pairs. Respond [] only if the document is blank or nothing needs to change.`
  });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25", // Enable PDF support
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8192,
        messages: [{ role: "user", content: contentBlocks }],
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Anthropic API error:", res.status, errText);
      return { buffer: templateBuffer, replacements: [] };
    }

    const data = await res.json();
    const aiText = data?.content?.[0]?.text ?? "";
    console.log("[generate] Claude raw response (first 500):", aiText.slice(0, 500));

    // Parse replacements — Claude sometimes wraps in ```json ... ```
    const jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("[generate] No JSON array found in Claude response");
      return { buffer: templateBuffer, replacements: [] };
    }

    const replacements: { find: string; replace: string }[] = JSON.parse(jsonMatch[0]);
    console.log("[generate] Replacements count:", replacements.length);
    if (!replacements.length) return { buffer: templateBuffer, replacements: [] };

    // Apply replacements
    const buffer = templateType === "xlsx"
      ? await applyReplacementsToXlsx(templateBuffer, replacements)
      : applyReplacementsToOffice(templateBuffer, templateType, replacements);

    return { buffer, replacements };
  } catch (e: any) {
    console.error("AI generate error:", e.message);
    throw new Error(`Error generating with AI: ${e.message}`);
  }
}

// ── POST /api/documents/generate ─────────────────────────────────────────────
// Accepts multipart/form-data:
//   templateId  (string)
//   companyId   (string)
//   files[]     (File[]) — optional backup/context documents
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Parse multipart form data
  const formData = await req.formData();
  const templateId  = formData.get("templateId")  as string | null;
  const companyId   = formData.get("companyId")   as string | null;
  const userPrompt  = (formData.get("userPrompt") as string | null)?.trim() || null;
  const contextFileEntries = formData.getAll("files") as File[];

  if (!templateId) {
    return NextResponse.json({ error: "templateId required" }, { status: 400 });
  }

  // Load template
  const template = await db.query.documentTemplates.findFirst({
    where: (t, { eq }) => eq(t.id, templateId),
  });
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  // Load company (optional)
  let company: CompanyRow | null = null;
  let peers: { ticker: string; evRevenue?: number|null; evEbitda?: number|null }[] = [];
  if (companyId) {
    company = await db.query.companies.findFirst({
      where: (c, { eq }) => eq(c.id, companyId),
    }) ?? null;
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

    const compSet = await db.query.compSets.findFirst({
      where: (cs, { eq }) => eq(cs.companyId, companyId),
    });
    const peerTickers: string[] = compSet ? JSON.parse(compSet.tickers ?? "[]") : [];
    if (peerTickers.length) {
      peers = await db.query.publicComps.findMany({
        where: (p, { inArray }) => inArray(p.ticker, peerTickers),
      });
    }
  }

  // Read template file
  let templateBuffer: Buffer;
  if (template.filePath.startsWith("data:")) {
    // Base64 data URL stored in DB
    const base64 = template.filePath.split(",")[1];
    if (!base64) return NextResponse.json({ error: "Invalid template file" }, { status: 404 });
    templateBuffer = Buffer.from(base64, "base64");
  } else if (template.filePath.startsWith("http")) {
    const blobRes = await fetch(template.filePath);
    if (!blobRes.ok) return NextResponse.json({ error: "Could not read the template" }, { status: 404 });
    templateBuffer = Buffer.from(await blobRes.arrayBuffer());
  } else {
    // Legacy: local filesystem (dev)
    const filename = template.filePath.replace("local:", "");
    const localPath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(localPath)) {
      return NextResponse.json({ error: "Template file not found" }, { status: 404 });
    }
    templateBuffer = fs.readFileSync(localPath);
  }
  const ext = template.type;

  // Process context files
  const contextFiles: ContextFile[] = [];
  for (const f of contextFileEntries) {
    if (f.size === 0) continue;
    const buf = Buffer.from(await f.arrayBuffer());
    contextFiles.push({ name: f.name, buffer: buf, mimeType: f.type });
  }

  // Load user's API key
  const userId = session.user.id;
  const userSettings = await db.query.userSettings.findFirst({
    where: (s, { eq }) => eq(s.userId, userId),
  });
  const userApiKey = userSettings?.anthropicApiKey ?? null;

  // Check if template has {{}} placeholders
  const placeholders = JSON.parse(template.placeholders ?? "[]") as string[];
  const hasPlaceholders = placeholders.length > 0;

  let outBuffer: Buffer;
  let usedReplacements: { find: string; replace: string }[] = [];

  try {
    // Fast path: {{}} placeholders + no context files + no userPrompt + company selected
    if (hasPlaceholders && contextFiles.length === 0 && !userPrompt && company) {
      const values: Record<string, string> = {
        company_name: company.name, nombre_empresa: company.name, empresa: company.name,
        sector: company.sector ?? "N/D", pais: company.country, ciudad: company.city ?? "N/D",
        etapa: company.stage ?? "N/D", descripcion: company.description ?? "",
        revenue: fmtB(company.revenueUsd), crecimiento: fmtPct(company.revenueGrowth),
        ebitda: fmtB(company.ebitdaUsd), margen_ebitda: fmtPct(company.ebitdaMargin),
        empleados: company.employees?.toString() ?? "N/D",
        ev_revenue: peers.length ? fmtX(median(peers.map(p => Number(p.evRevenue)).filter(n => !isNaN(n) && n > 0))) : "N/D",
        ev_ebitda: peers.length ? fmtX(median(peers.map(p => Number(p.evEbitda)).filter(n => !isNaN(n) && n > 0))) : "N/D",
        peers: peers.map(p => p.ticker).join(", ") || "N/D",
        fecha: today(), "año": new Date().getFullYear().toString(),
      };
      usedReplacements = Object.entries(values).map(([k, v]) => ({ find: `{{${k}}}`, replace: v }));
      if (ext === "xlsx") {
        outBuffer = await applyReplacementsToXlsx(templateBuffer, usedReplacements);
      } else {
        outBuffer = generateWithPlaceholders(templateBuffer, values);
      }
    } else {
      // AI path
      if (!userApiKey) {
        return NextResponse.json({
          error: "API key not configured",
          message: "You need to configure your Anthropic API key in Settings to use this feature.",
          code: "NO_API_KEY"
        }, { status: 400 });
      }
      if (ext === "xlsx") {
        // XLSX: generate completely new content — Claude decides all sheets/columns/data
        outBuffer = await generateXlsxNewContent(templateBuffer, company, peers, contextFiles, userApiKey, userPrompt);
        usedReplacements = [];
      } else {
        // PPTX / DOCX: find-and-replace AI path — preserves the exact template
        // structure, styling, layout, images, headers/footers; only swaps text.
        const result = await generateWithAI(templateBuffer, ext, company, peers, contextFiles, userApiKey, userPrompt);
        outBuffer = result.buffer;
        usedReplacements = result.replacements;
      }
    }
  } catch (e: any) {
    console.error("Document generation error:", e);
    return NextResponse.json({ error: "Error generating document", detail: e.message }, { status: 500 });
  }

  const safeName = (company?.name ?? "documento").replace(/[^a-zA-Z0-9_\-]/g, "_");
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `${safeName}_${dateStr}.${ext}`;

  // Extract readable preview of generated content (slide-by-slide for PPTX)
  let previewText = "";
  try { previewText = extractOfficeText(outBuffer, ext).slice(0, 4000); } catch { /* ignore */ }

  return NextResponse.json({
    replacements: usedReplacements,
    file: outBuffer.toString("base64"),
    filename: fileName,
    previewText,
    ext,
    _debug: {
      hadCompany: !!company,
      hadContextFiles: contextFiles.length,
      hadUserPrompt: !!userPrompt,
      hadApiKey: !!userApiKey,
      templateTextLength: extractOfficeText(templateBuffer, ext).length,
    },
  });
}
