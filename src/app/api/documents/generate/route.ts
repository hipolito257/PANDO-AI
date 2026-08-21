import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentTemplates, companies, compSets, publicComps } from "@/lib/schema";
import path from "path";
import fs from "fs";
import { fmtMoneyDoc } from "@/lib/utils";
import {
  extractOfficeText, applyReplacementsToOffice,
} from "@/lib/officeReplace";

export const maxDuration = 300;

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "templates");

// ── Anthropic response text ───────────────────────────────────────────────────
// Never read content[0] directly: with thinking enabled the first block is a
// "thinking" block whose .text is undefined, which silently yields "" and looks
// exactly like the model returning nothing. Always collect the text blocks.
function extractText(data: unknown): string {
  const blocks = (data as { content?: { type?: string; text?: string }[] })?.content ?? [];
  return blocks.filter(b => b?.type === "text").map(b => b.text ?? "").join("\n").trim();
}

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

// ── Apply replacements to XLSX ─────────────────────────────────────────────────
async function applyReplacementsToXlsx(
  buffer: Buffer, replacements: { find: string; replace: string }[]
): Promise<{ buffer: Buffer; applied: { find: string; replace: string }[] }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const appliedFinds = new Set<string>();
  wb.eachSheet((sheet: any) => {
    sheet.eachRow({ includeEmpty: false }, (row: any) => {
      row.eachCell({ includeEmpty: false }, (cell: any) => {
        if (typeof cell.value === "string") {
          let v = cell.value;
          for (const { find, replace } of replacements) {
            if (find && v.includes(find)) {
              appliedFinds.add(find);
              v = v.split(find).join(replace);
            }
          }
          cell.value = v;
        }
      });
    });
  });
  return {
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
    applied: replacements.filter(r => appliedFinds.has(r.find)),
  };
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
      max_tokens: 32000,
      // Sonnet 5 thinks adaptively by default, and on a long extraction prompt
      // like this it spent ~4k of the 8k output budget thinking, truncating the
      // JSON before it finished. This is mechanical structuring, not reasoning,
      // so thinking buys nothing here and costs the whole response.
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: contentBlocks }],
    }),
    signal: AbortSignal.timeout(280000),
  });

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json();
  const aiText: string = extractText(data);

  const jsonMatch = aiText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      data?.stop_reason === "max_tokens"
        ? "Claude's response was cut off before it finished the Excel. Try a smaller template or fewer context files."
        : "Claude did not return valid JSON for the Excel",
    );
  }

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
      text: `===== SOURCE MATERIAL (${contextFiles.length} attached file(s)) =====\n`
        + `These files describe the TARGET subject. They are your source of FACTS.\n`
        + `They are NOT the document you are editing, and you must never quote them in a "find" value.`
    });
    for (const f of contextFiles) {
      const block = buildContextBlock(f);
      if (block) contentBlocks.push(block);
    }
  }

  // Main instruction
  const companySection = companyCard
    ? `COMPANY DATA (PANDO database):\n${companyCard}\n\n${contextFiles.length > 0 ? "IMPORTANT: The attached documents above are the primary, authoritative source for facts, figures and narrative. Where they and this database summary disagree, follow the attached documents." : ""}`
    : "";

  const userInstructions = userPrompt
    ? `SPECIFIC USER INSTRUCTIONS:\n${userPrompt}\n\nFollow these instructions as the main guide for customizing the document.`
    : "";

  const hasCompanyData = !!companySection;
  const hasInstructions = !!userInstructions;

  contentBlocks.push({
    type: "text",
    text: `You are an expert in document analysis and professional content generation.

There are TWO different documents in this task. Do not confuse them:
  • SOURCE MATERIAL — the attached file(s) above${hasCompanyData ? " and the target company data below" : ""}. These describe the TARGET subject and are where FACTS come from.
  • TEMPLATE TO EDIT — the text between the ===== markers below. This is an old document about a DIFFERENT, UNRELATED company. It is the ONLY document you are editing, and every "find" value must be copied out of it.

Your job: rewrite the TEMPLATE TO EDIT so it describes the TARGET subject instead, keeping the template's structure, section order, tone and level of detail while replacing all of its facts.

The template's facts must NOT survive: no company or brand names, people, dates, locations, customers, investors, or figures belonging to the template's original company may appear in the finished document. Treat every concrete fact in it as placeholder text to be overwritten. The result must read as if written from scratch about the target subject.

${hasCompanyData ? `TARGET COMPANY DATA (source material):\n${companySection}` : ""}
${hasInstructions ? `${userInstructions}` : ""}
${!hasCompanyData && !hasInstructions ? "No company data or specific instructions were provided. Adapt the document generically: replace company names with \"[Company]\" and financial data with \"N/D\", keeping the structure." : ""}

===== TEMPLATE TO EDIT (the document you are rewriting) =====
${templateText || "(document with no extractable text)"}
===== END OF TEMPLATE TO EDIT =====

MODIFICATION RULES:
0. HOW TO QUOTE — this determines whether your edit works at all:
   • EVERY "find" must be text copied verbatim from between the TEMPLATE TO EDIT markers above. A "find" taken from the attached source files, or written from memory, matches nothing and is discarded.
   • ONE LINE PER EDIT. Each line of the template is a separate element in the underlying file. A "find" that spans two lines (contains a newline) exists nowhere in the document and cannot be applied. If three consecutive lines need changing, emit three separate pairs.
   • Never put a newline inside "find".
   • Never quote a line that starts with "===" or "#". Those are structural markers, not document text.
1. Generate one replacement for EVERY element that carries information about the original company. Be exhaustive: work through the template from top to bottom and do not stop early. Any element you skip keeps the wrong company's information in the final file, which is the single worst outcome here.
2. ${hasCompanyData ? "Replace everything specific to the original company with the target subject's own information: name(s), metrics, history, people, investors, geography, customers, dates." : "Apply the changes indicated in the instructions to the document text."}
3. Mirror the original's tone, length and level of detail, but never its facts.
4. Keep UNCHANGED (in content): generic section titles, column labels, structural headers — do not remove or restructure them. These are part of the format, not the original company's information.
4b. If the source material genuinely says nothing about a point the template covers, write a neutral, accurate statement for the target subject or "N/D" for a figure. Never leave the original company's value in place, and never invent a fact to fill the gap.
5. LANGUAGE — CRITICAL: The final document must be entirely in English, with no mixed languages. This applies to every piece of text you write in "replace", INCLUDING generic section titles/column labels/structural headers if they are not already in English — translate them to English as part of your replacements rather than leaving them unchanged. Never output Spanish (or any other language) text anywhere in "replace".
6. CRITICAL: The "find" field must be the EXACT text as it appears in the document (including "&amp;" if "&amp;" appears), even if that text is in a non-English language.
7. MONEY FORMAT: Write every money figure exactly like this: "USD $200 m" (millions), "USD $850 k" (thousands), "USD $1.2 bn" (billions) — currency code, then symbol+number, then a space and lowercase suffix (k/m/bn). Use "MXN $" or "EUR €" instead of "USD $" when the figure is explicitly in pesos or euros. Never write "$200M", "200 million dollars", or similar.

Respond ONLY with a JSON array (no text, no markdown):
[{"find": "exact text from the document", "replace": "new content"}, ...]

Produce as many pairs as the document actually needs — there is no upper limit, and covering every company-specific element matters more than being concise. Respond [] only if the document is blank.`
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
        // Each replacement echoes the original passage verbatim in "find" plus
        // a full rewrite in "replace", so a real deck runs well past the old
        // 8192 ceiling and got truncated mid-array. Sonnet 5 allows up to 64k.
        max_tokens: 32000,
        // See the note on the Excel path: adaptive thinking ate most of the
        // output budget here and truncated the replacement list, which then
        // silently returned the untouched template.
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: contentBlocks }],
      }),
      // Generous, but still inside this route's maxDuration of 300s.
      signal: AbortSignal.timeout(280000),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Anthropic API error:", res.status, errText);
      throw new Error(`Anthropic API error ${res.status}. The document was not modified.`);
    }

    const data = await res.json();
    const aiText = extractText(data);
    console.log("[generate] Claude raw response (first 500):", aiText.slice(0, 500));

    // Parse replacements — Claude sometimes wraps in ```json ... ```
    const jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // Previously this returned the untouched template, so a failed AI step
      // looked to the user like "it just downloaded the template" with no error.
      console.error("[generate] No JSON array found in Claude response. stop_reason:", data?.stop_reason);
      throw new Error(
        data?.stop_reason === "max_tokens"
          ? "Claude's response was cut off before it finished. Try a smaller template or fewer context files."
          : "Claude did not return any changes to apply, so the document was left unchanged.",
      );
    }

    const replacements: { find: string; replace: string }[] = JSON.parse(jsonMatch[0]);
    console.log("[generate] Replacements proposed:", replacements.length);
    if (!replacements.length) {
      throw new Error("The AI proposed no changes, so the document would be identical to the template.");
    }

    // Apply replacements, then report only what actually landed. A "find" the
    // model took from an attached source file instead of the template matches
    // nothing, so proposing 56 edits and applying 0 must not look like success.
    const { buffer, applied } = templateType === "xlsx"
      ? await applyReplacementsToXlsx(templateBuffer, replacements)
      : applyReplacementsToOffice(templateBuffer, templateType, replacements);

    console.log(`[generate] Replacements applied: ${applied.length}/${replacements.length}`);
    if (!applied.length) {
      throw new Error(
        `The AI proposed ${replacements.length} edits but none matched the template's actual text, so nothing was changed. ` +
        "This usually means it quoted the backup file instead of the template. Try again.",
      );
    }

    return { buffer, replacements: applied };
  } catch (e: any) {
    console.error("AI generate error:", e.message);
    throw new Error(`Error generating with AI: ${e.message}`);
  }
}

// ── POST /api/documents/generate ─────────────────────────────────────────────
// Accepts multipart/form-data:
//   templateId  (string)
//   companyId   (string)
//   blobUrls    (JSON [{name,url,type}]) — context docs already uploaded to Blob
//   files[]     (File[]) — legacy inline path, kept for backwards compatibility
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Parse multipart form data
  const formData = await req.formData();
  const templateId  = formData.get("templateId")  as string | null;
  const companyId   = formData.get("companyId")   as string | null;
  const userPrompt  = (formData.get("userPrompt") as string | null)?.trim() || null;
  const contextFileEntries = formData.getAll("files") as File[];
  const blobUrlsRaw = formData.get("blobUrls") as string | null;
  let blobUrls: { name: string; url: string; type: string }[] = [];
  try { blobUrls = blobUrlsRaw ? JSON.parse(blobUrlsRaw) : []; } catch { blobUrls = []; }

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

  // Process context files — blob-hosted first (the normal path), then any
  // legacy inline uploads.
  const contextFiles: ContextFile[] = [];
  for (const bf of blobUrls.slice(0, 5)) {
    try {
      const r = await fetch(bf.url);
      if (!r.ok) continue;
      contextFiles.push({
        name: bf.name,
        buffer: Buffer.from(await r.arrayBuffer()),
        mimeType: bf.type || "application/octet-stream",
      });
    } catch { /* skip unreadable files */ }
  }
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
        const r = await applyReplacementsToXlsx(templateBuffer, usedReplacements);
        outBuffer = r.buffer;
        usedReplacements = r.applied;
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
