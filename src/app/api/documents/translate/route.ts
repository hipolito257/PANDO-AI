import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const maxDuration = 300;

type Direction = "es-en" | "en-es";

// ── Escape only text-node special chars (not quotes — this is element text, not an attribute) ──
function escapeXmlText(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Call Claude to translate a batch of strings, preserving array order/length ──
async function callTranslateBatch(texts: string[], apiKey: string, direction: Direction): Promise<string[]> {
  if (!texts.length) return [];
  const targetLang = direction === "es-en" ? "English" : "Spanish";
  const sourceLang = direction === "es-en" ? "Spanish" : "English";
  const CHUNK = 40;
  const results: string[] = [];

  for (let i = 0; i < texts.length; i += CHUNK) {
    const chunk = texts.slice(i, i + CHUNK);

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
- Preserve meaning, tone, and register exactly — these are formal business/financial documents.
- Keep numbers, dates, currency symbols, percentages, proper nouns, company names, and acronyms unchanged unless they have a standard translated form.
- Preserve any placeholder tokens exactly as-is (e.g. "{{name}}", "%s", "{0}").
- If a string is already fully in ${targetLang}, or has no translatable text (e.g. just a number, date, or symbol), return it unchanged.
- Return ONLY a JSON array of the same length and in the same order as the input, containing the translated strings. No markdown, no explanation, no extra text.

INPUT:
${JSON.stringify(chunk)}`,
        }],
      }),
      signal: AbortSignal.timeout(120000),
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
    results.push(...parsed.map((v: unknown) => (typeof v === "string" ? v : String(v))));
  }

  return results;
}

// ── DOCX: flatten each paragraph's runs, translate the merged text, rebuild ──
// Paragraphs containing images, hyperlinks, or fields are left untouched.
async function translateDocxXml(xml: string, translateBatch: (texts: string[]) => Promise<string[]>): Promise<string> {
  const texts: string[] = [];
  const translatable: boolean[] = [];

  for (const m of xml.matchAll(/<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/g)) {
    const inner = m[2];
    if (/<w:drawing\b|<w:hyperlink\b|<w:pict\b|<w:object\b|<w:fldSimple\b|<w:fldChar\b/.test(inner)) {
      translatable.push(false);
      continue;
    }
    const pPrMatch = inner.match(/^\s*<w:pPr\b[\s\S]*?<\/w:pPr>/);
    const afterPPr = pPrMatch ? inner.slice(pPrMatch[0].length) : inner;
    const runs = [...afterPPr.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)];
    if (!runs.length) { translatable.push(false); continue; }

    let mergedText = "";
    for (const r of runs) {
      mergedText += [...r[0].matchAll(/<w:t(?:\s+[\w:]+="[^"]*")*\s*>([\s\S]*?)<\/w:t>/g)].map(x => x[1]).join("");
    }
    if (!mergedText.trim()) { translatable.push(false); continue; }

    texts.push(mergedText);
    translatable.push(true);
  }

  const translated = await translateBatch(texts);
  let ti = 0, pi = 0;

  return xml.replace(/<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/g, (full, pAttrs, inner) => {
    const isTranslatable = translatable[pi++];
    if (!isTranslatable) return full;

    const pPrMatch = inner.match(/^\s*<w:pPr\b[\s\S]*?<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[0] : "";
    const afterPPr = pPrMatch ? inner.slice(pPrMatch[0].length) : inner;
    const runs = [...afterPPr.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)];

    let firstRPr = "";
    for (const r of runs) {
      const rPrMatch = r[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
      if (rPrMatch) { firstRPr = rPrMatch[0]; break; }
    }

    const newText = escapeXmlText(translated[ti++] ?? "");
    const newRun = `<w:r>${firstRPr}<w:t xml:space="preserve">${newText}</w:t></w:r>`;
    return `<w:p${pAttrs}>${pPr}${newRun}</w:p>`;
  });
}

// ── PPTX: same idea, at the <a:p>/<a:r>/<a:t> level (covers shapes, tables, notes) ──
async function translatePptxXml(xml: string, translateBatch: (texts: string[]) => Promise<string[]>): Promise<string> {
  const texts: string[] = [];
  const translatable: boolean[] = [];

  for (const m of xml.matchAll(/<a:p\b([^>]*)>([\s\S]*?)<\/a:p>/g)) {
    const inner = m[2];
    if (/<a:fld\b/.test(inner)) { translatable.push(false); continue; }
    const pPrMatch = inner.match(/^\s*<a:pPr\b[\s\S]*?(?:\/>|<\/a:pPr>)/);
    const afterPPr = pPrMatch ? inner.slice(pPrMatch[0].length) : inner;
    const runs = [...afterPPr.matchAll(/<a:r\b[\s\S]*?<\/a:r>/g)];
    if (!runs.length) { translatable.push(false); continue; }

    let mergedText = "";
    for (const r of runs) {
      mergedText += [...r[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(x => x[1]).join("");
    }
    if (!mergedText.trim()) { translatable.push(false); continue; }

    texts.push(mergedText);
    translatable.push(true);
  }

  const translated = await translateBatch(texts);
  let ti = 0, pi = 0;

  return xml.replace(/<a:p\b([^>]*)>([\s\S]*?)<\/a:p>/g, (full, pAttrs, inner) => {
    const isTranslatable = translatable[pi++];
    if (!isTranslatable) return full;

    const pPrMatch = inner.match(/^\s*<a:pPr\b[\s\S]*?(?:\/>|<\/a:pPr>)/);
    const pPr = pPrMatch ? pPrMatch[0] : "";
    const afterPPr = pPrMatch ? inner.slice(pPrMatch[0].length) : inner;
    const runs = [...afterPPr.matchAll(/<a:r\b[\s\S]*?<\/a:r>/g)];

    let firstRPr = "";
    for (const r of runs) {
      const rPrMatch = r[0].match(/<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/);
      if (rPrMatch) { firstRPr = rPrMatch[0]; break; }
    }

    const newText = escapeXmlText(translated[ti++] ?? "");
    const newRun = `<a:r>${firstRPr}<a:t>${newText}</a:t></a:r>`;
    return `<a:p${pAttrs}>${pPr}${newRun}</a:p>`;
  });
}

async function translateDocx(buffer: Buffer, apiKey: string, direction: Direction): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  const zip = new PizZip(buffer);
  const targets = Object.keys(zip.files).filter(n => /^word\/(document|header\d*|footer\d*|footnotes|endnotes).*\.xml$/.test(n));

  for (const fname of targets) {
    const xml = zip.files[fname].asText();
    const translatedXml = await translateDocxXml(xml, texts => callTranslateBatch(texts, apiKey, direction));
    zip.file(fname, translatedXml);
  }

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

async function translatePptx(buffer: Buffer, apiKey: string, direction: Direction): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  const zip = new PizZip(buffer);
  const targets = Object.keys(zip.files).filter(n => /^ppt\/(slides|notesSlides)\/.*\.xml$/.test(n));

  for (const fname of targets) {
    const xml = zip.files[fname].asText();
    const translatedXml = await translatePptxXml(xml, texts => callTranslateBatch(texts, apiKey, direction));
    zip.file(fname, translatedXml);
  }

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

async function translateXlsx(buffer: Buffer, apiKey: string, direction: Direction): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const cells: { value(v: string): void }[] = [];
  const texts: string[] = [];

  wb.eachSheet((sheet: any) => {
    sheet.eachRow({ includeEmpty: false }, (row: any) => {
      row.eachCell({ includeEmpty: false }, (cell: any) => {
        if (typeof cell.value === "string" && cell.value.trim()) {
          cells.push({ value: (v: string) => { cell.value = v; } });
          texts.push(cell.value);
        }
      });
    });
  });

  const translated = await callTranslateBatch(texts, apiKey, direction);
  cells.forEach((c, i) => { if (translated[i] !== undefined) c.value(translated[i]); });

  // Translate sheet names too
  const sheetNames = wb.worksheets.map((s: any) => s.name);
  const translatedNames = await callTranslateBatch(sheetNames, apiKey, direction);
  wb.worksheets.forEach((s: any, i: number) => { if (translatedNames[i]) s.name = translatedNames[i]; });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── POST /api/documents/translate ─────────────────────────────────────────────
// Accepts multipart/form-data: file (DOCX/PPTX/XLSX), direction ("es-en" | "en-es")
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const direction: Direction = (formData.get("direction") as string | null) === "en-es" ? "en-es" : "es-en";

  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["docx", "pptx", "xlsx"].includes(ext)) {
    return NextResponse.json({ error: "Unsupported file type. Upload a .docx, .pptx, or .xlsx file." }, { status: 400 });
  }

  const userId = session.user.id;
  const userSetting = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  const apiKey = userSetting?.anthropicApiKey ?? null;

  if (!apiKey) {
    return NextResponse.json({
      error: "no_key",
      message: "Configure your Anthropic API key in Settings to use document translation.",
    }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    let outBuffer: Buffer;
    if (ext === "docx") outBuffer = await translateDocx(buffer, apiKey, direction);
    else if (ext === "pptx") outBuffer = await translatePptx(buffer, apiKey, direction);
    else outBuffer = await translateXlsx(buffer, apiKey, direction);

    const baseName = file.name.replace(/\.[^.]+$/, "");
    const suffix = direction === "es-en" ? "EN" : "ES";
    const outName = `${baseName}_${suffix}.${ext}`;

    const mimeMap: Record<string, string> = {
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };

    return new NextResponse(new Uint8Array(outBuffer), {
      headers: {
        "Content-Type": mimeMap[ext],
        "Content-Disposition": `attachment; filename="${encodeURIComponent(outName)}"`,
      },
    });
  } catch (e: any) {
    console.error("[translate] error:", e.message);
    return NextResponse.json({ error: e.message || "Translation failed" }, { status: 500 });
  }
}
