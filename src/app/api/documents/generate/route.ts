import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentTemplates, companies, compSets, publicComps } from "@/lib/schema";
import path from "path";
import fs from "fs";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "templates");

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtB(n: unknown): string {
  if (n == null) return "N/D";
  const v = Number(n);
  if (isNaN(v)) return "N/D";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
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
  return new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" });
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
      const slideLines: string[] = [`=== DIAPOSITIVA ${si + 1} ===`];

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

    return lines.join("\n").slice(0, 12000);
  } catch { return ""; }
}

// ── Extract text from Office docs (DOCX / PPTX / XLSX) ────────────────────────
function extractOfficeText(buffer: Buffer, ext: string): string {
  if (ext === "pptx") return extractPptxStructured(buffer);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  try {
    const zip = new PizZip(buffer);
    const xmlFiles = Object.keys(zip.files).filter(name => {
      if (ext === "docx") return name === "word/document.xml";
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
  for (const fname of xmlFiles) {
    try {
      // Normalize runs first so find/replace works on merged text
      let content = type === "pptx"
        ? normalizeXmlRuns(zip.files[fname].asText())
        : zip.files[fname].asText();
      for (const { find, replace } of replacements) {
        if (find && find.length > 1) {
          // Escape special regex chars in 'find' for reliable splitting
          content = content.split(find).join(replace);
        }
      }
      zip.file(fname, content);
    } catch { /* skip */ }
  }
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
Empresa: ${company.name}
Sector: ${company.sector ?? "N/D"} | País: ${company.country} | Ciudad: ${company.city ?? "N/D"}
Descripción: ${company.description ?? "N/D"}
Revenue: ${fmtB(company.revenueUsd)} | Crecimiento YoY: ${fmtPct(company.revenueGrowth)}
EBITDA: ${fmtB(company.ebitdaUsd)} | Margen EBITDA: ${fmtPct(company.ebitdaMargin)}
Empleados: ${company.employees ?? "N/D"} | Etapa: ${company.stage ?? "N/D"} | Score PANDO: ${company.score?.toFixed(1) ?? "N/D"}
Fondeo total: ${fmtB(company.totalFunding)} | Última ronda: ${fmtB(company.lastFundingAmt)} | Stage fondeo: ${company.fundingStage ?? "N/D"}
Peers públicos: ${peers.map(p => p.ticker).join(", ") || "N/D"}
EV/Revenue mediana (peers): ${medRev ? fmtX(medRev) : "N/D"}
EV/EBITDA mediana (peers): ${medEbit ? fmtX(medEbit) : "N/D"}
Fecha: ${today()}
`.trim() : null;

  const templateText = extractOfficeText(templateBuffer, templateType);

  // Build message content — context files first, then instructions
  const contentBlocks: any[] = [];

  // Add context files
  if (contextFiles.length > 0) {
    contentBlocks.push({
      type: "text",
      text: `A continuación hay ${contextFiles.length} documento(s) de respaldo. Léelos con atención para extraer datos relevantes:`
    });
    for (const f of contextFiles) {
      const block = buildContextBlock(f);
      if (block) contentBlocks.push(block);
    }
  }

  // Main instruction
  const companySection = companyCard
    ? `DATOS DE LA EMPRESA (base de datos PANDO):\n${companyCard}\n\n${contextFiles.length > 0 ? "IMPORTANTE: Los documentos de respaldo de arriba contienen información adicional. Prioriza esos datos si son más detallados o actuales que los de la base de datos." : ""}`
    : "";

  const userInstructions = userPrompt
    ? `INSTRUCCIONES ESPECÍFICAS DEL USUARIO:\n${userPrompt}\n\nSigue estas instrucciones como guía principal para personalizar el documento.`
    : "";

  contentBlocks.push({
    type: "text",
    text: `Eres un analista senior de Private Equity. Tienes una presentación de inversión existente elaborada para UNA empresa. Tu tarea es ADAPTAR esta presentación para una empresa DIFERENTE, reemplazando TODO el contenido específico de la empresa original con datos de la nueva empresa target.

${companySection || "(Sin datos de empresa — usa los archivos adjuntos y las instrucciones del usuario)"}

${userInstructions}

CONTENIDO ACTUAL DE LA PRESENTACIÓN (diapositiva por diapositiva — este es el contenido que debes reemplazar):
${templateText || "(documento sin texto extraíble)"}

INSTRUCCIONES DE SUSTITUCIÓN:
1. Identifica TODO el contenido específico de la empresa original: nombre(s) de empresa, marcas, fundadores, inversores, métricas financieras (revenue, EBITDA, crecimiento, márgenes, rondas), historia y hitos, productos/servicios, número de tiendas/clientes, países y ciudades, nombres de personas, tickers de peers, múltiplos, fechas y años específicos.
2. Para CADA elemento específico, genera el reemplazo con datos de la NUEVA empresa target.
3. Para datos que no tienes disponibles, escribe "N/D" o un valor genérico apropiado al contexto.
4. Para texto narrativo largo (descripciones, tesis, overview del negocio), redacta contenido profesional y conciso sobre la nueva empresa usando el mismo tono y extensión del original.
5. Mantén SIN CAMBIOS: títulos de sección genéricos ("Investment Overview", "Financial Summary", "The Company", "Company history", etc.), labels de columnas/filas, elementos de diseño, encabezados estructurales.
6. CRÍTICO: El campo "find" debe ser el texto EXACTAMENTE como aparece arriba, incluyendo entidades XML (escribe "&amp;" si ves "&amp;", no "&").

Responde ÚNICAMENTE con un JSON array (sin texto adicional, sin markdown, sin \`\`\`):
[{"find": "texto exacto como aparece en el documento", "replace": "nuevo contenido para la empresa target"}, ...]

Genera TODOS los reemplazos necesarios — entre 10 y 50 pares mínimo si el documento tiene contenido real. Si genuinamente no hay nada qué reemplazar (documento en blanco), responde: []`
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
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        messages: [{ role: "user", content: contentBlocks }],
      }),
      signal: AbortSignal.timeout(60000),
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
    return { buffer: templateBuffer, replacements: [] };
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
    return NextResponse.json({ error: "templateId requerido" }, { status: 400 });
  }

  // Load template
  const template = await db.query.documentTemplates.findFirst({
    where: (t, { eq }) => eq(t.id, templateId),
  });
  if (!template) return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });

  // Load company (optional)
  let company: CompanyRow | null = null;
  let peers: { ticker: string; evRevenue?: number|null; evEbitda?: number|null }[] = [];
  if (companyId) {
    company = await db.query.companies.findFirst({
      where: (c, { eq }) => eq(c.id, companyId),
    }) ?? null;
    if (!company) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

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
    if (!base64) return NextResponse.json({ error: "Archivo de plantilla inválido" }, { status: 404 });
    templateBuffer = Buffer.from(base64, "base64");
  } else if (template.filePath.startsWith("http")) {
    const blobRes = await fetch(template.filePath);
    if (!blobRes.ok) return NextResponse.json({ error: "No se pudo leer la plantilla" }, { status: 404 });
    templateBuffer = Buffer.from(await blobRes.arrayBuffer());
  } else {
    // Legacy: local filesystem (dev)
    const filename = template.filePath.replace("local:", "");
    const localPath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(localPath)) {
      return NextResponse.json({ error: "Archivo de plantilla no encontrado" }, { status: 404 });
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
        fecha: today(), año: new Date().getFullYear().toString(),
      };
      usedReplacements = Object.entries(values).map(([k, v]) => ({ find: `{{${k}}}`, replace: v }));
      if (ext === "xlsx") {
        outBuffer = await applyReplacementsToXlsx(templateBuffer, usedReplacements);
      } else {
        outBuffer = generateWithPlaceholders(templateBuffer, values);
      }
    } else {
      // AI path: context files, userPrompt, no placeholders, or no company
      if (!userApiKey) {
        return NextResponse.json({
          error: "API key no configurada",
          message: "Necesitas configurar tu API key de Anthropic en Configuración para usar esta función.",
          code: "NO_API_KEY"
        }, { status: 400 });
      }
      const result = await generateWithAI(templateBuffer, ext, company, peers, contextFiles, userApiKey, userPrompt);
      outBuffer = result.buffer;
      usedReplacements = result.replacements;
    }
  } catch (e: any) {
    console.error("Document generation error:", e);
    return NextResponse.json({ error: "Error al generar documento", detail: e.message }, { status: 500 });
  }

  const safeName = (company?.name ?? "documento").replace(/[^a-zA-Z0-9_\-]/g, "_");
  const fileName = `${safeName}_${template.name.replace(/[^a-zA-Z0-9_\-]/g, "_")}.${ext}`;

  // Extract readable preview of generated content (slide-by-slide for PPTX)
  let previewText = "";
  try { previewText = extractOfficeText(outBuffer, ext).slice(0, 4000); } catch { /* ignore */ }

  // Return JSON so the frontend can show a preview before the user downloads
  return NextResponse.json({
    replacements: usedReplacements,
    file: outBuffer.toString("base64"),
    filename: fileName,
    previewText,
    ext,
  });
}
