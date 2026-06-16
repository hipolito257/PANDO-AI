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

// ── Extract text from Office docs (DOCX / PPTX / XLSX) ────────────────────────
function extractOfficeText(buffer: Buffer, ext: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  try {
    const zip = new PizZip(buffer);
    const xmlFiles = Object.keys(zip.files).filter(name => {
      if (ext === "pptx") return !!name.match(/^ppt\/slides\/slide\d+\.xml$/);
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
      let content = zip.files[fname].asText();
      for (const { find, replace } of replacements) {
        if (find && find.length > 1) content = content.split(find).join(replace);
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
  company: CompanyRow,
  peers: { ticker: string; evRevenue?: number|null; evEbitda?: number|null }[],
  contextFiles: ContextFile[],
  userApiKey: string | null
): Promise<Buffer> {
  if (!userApiKey) return templateBuffer;
  const apiKey = userApiKey;

  const medRev  = median(peers.map(p => Number(p.evRevenue)).filter(n => !isNaN(n) && n > 0));
  const medEbit = median(peers.map(p => Number(p.evEbitda)).filter(n => !isNaN(n) && n > 0));

  const companyCard = `
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
`.trim();

  const templateText = extractOfficeText(templateBuffer, templateType);

  // Build message content — context files first, then instructions
  const contentBlocks: any[] = [];

  // Add context files
  if (contextFiles.length > 0) {
    contentBlocks.push({
      type: "text",
      text: `A continuación hay ${contextFiles.length} documento(s) de respaldo con información adicional de la empresa. Léelos con atención para extraer datos relevantes:`
    });
    for (const f of contextFiles) {
      const block = buildContextBlock(f);
      if (block) contentBlocks.push(block);
    }
  }

  // Main instruction
  contentBlocks.push({
    type: "text",
    text: `Eres un analista senior de Private Equity. Tu tarea es personalizar un documento ${templateType.toUpperCase()} para la empresa que se especifica.

DATOS DE LA EMPRESA (base de datos PANDO):
${companyCard}

${contextFiles.length > 0 ? "IMPORTANTE: Los documentos de respaldo de arriba contienen información adicional. Prioriza esos datos si son más detallados o actuales que los de la base de datos." : ""}

CONTENIDO ACTUAL DEL DOCUMENTO A PERSONALIZAR:
${templateText || "(documento sin texto extraíble — usa los datos disponibles)"}

INSTRUCCIONES:
1. Identifica EXACTAMENTE qué texto del documento debe reemplazarse con datos de la empresa objetivo
2. Reemplaza: nombres propios, cifras financieras, porcentajes, sectores, países, ciudades, fechas, nombres de personas clave, descripción del negocio
3. Para campos narrativos (tesis de inversión, descripción del modelo, resumen ejecutivo), genera texto profesional y conciso en español basado en toda la información disponible
4. Mantén el tono y estilo del documento original
5. NO reemplaces: títulos genéricos de secciones, labels, términos del mercado generales

Responde ÚNICAMENTE con un JSON array (sin texto adicional, sin markdown, sin \`\`\`):
[{"find": "texto exacto del documento a reemplazar", "replace": "nuevo texto"}, ...]

Si nada debe reemplazarse, responde: []`
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
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: contentBlocks }],
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      console.error("Anthropic API error:", res.status, await res.text());
      return templateBuffer;
    }

    const data = await res.json();
    const aiText = data?.content?.[0]?.text ?? "";

    // Parse replacements
    const jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return templateBuffer;

    const replacements: { find: string; replace: string }[] = JSON.parse(jsonMatch[0]);
    if (!replacements.length) return templateBuffer;

    // Apply replacements
    if (templateType === "xlsx") {
      return await applyReplacementsToXlsx(templateBuffer, replacements);
    } else {
      return applyReplacementsToOffice(templateBuffer, templateType, replacements);
    }
  } catch (e: any) {
    console.error("AI generate error:", e.message);
    return templateBuffer;
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
  const templateId = formData.get("templateId") as string | null;
  const companyId  = formData.get("companyId")  as string | null;
  const contextFileEntries = formData.getAll("files") as File[];

  if (!templateId || !companyId) {
    return NextResponse.json({ error: "templateId y companyId requeridos" }, { status: 400 });
  }

  // Load template
  const template = await db.query.documentTemplates.findFirst({
    where: (t, { eq }) => eq(t.id, templateId),
  });
  if (!template) return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });

  // Load company
  const company = await db.query.companies.findFirst({
    where: (c, { eq }) => eq(c.id, companyId),
  });
  if (!company) return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 });

  // Load comparable peers
  const compSet = await db.query.compSets.findFirst({
    where: (cs, { eq }) => eq(cs.companyId, companyId),
  });
  const peerTickers: string[] = compSet ? JSON.parse(compSet.tickers ?? "[]") : [];
  let peers: { ticker: string; evRevenue?: number|null; evEbitda?: number|null }[] = [];
  if (peerTickers.length) {
    peers = await db.query.publicComps.findMany({
      where: (p, { inArray }) => inArray(p.ticker, peerTickers),
    });
  }

  // Read template file (Vercel Blob in prod, local filesystem in dev)
  let templateBuffer: Buffer;
  if (template.filePath.startsWith("http")) {
    // Production: fetch from Vercel Blob
    const blobRes = await fetch(template.filePath);
    if (!blobRes.ok) return NextResponse.json({ error: "No se pudo leer la plantilla" }, { status: 404 });
    templateBuffer = Buffer.from(await blobRes.arrayBuffer());
  } else {
    // Development: read from local filesystem
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

  try {
    if (hasPlaceholders && contextFiles.length === 0) {
      // Fast path: {{}} placeholders, no context files — use docxtemplater directly
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
      if (ext === "xlsx") {
        outBuffer = await applyReplacementsToXlsx(templateBuffer,
          Object.entries(values).map(([k, v]) => ({ find: `{{${k}}}`, replace: v }))
        );
      } else {
        outBuffer = generateWithPlaceholders(templateBuffer, values);
      }
    } else {
      // AI path: context files provided OR no placeholders
      if (!userApiKey) {
        return NextResponse.json({
          error: "API key no configurada",
          message: "Necesitas configurar tu API key de Anthropic en Configuración para usar esta función.",
          code: "NO_API_KEY"
        }, { status: 400 });
      }
      outBuffer = await generateWithAI(templateBuffer, ext, company, peers, contextFiles, userApiKey);
    }
  } catch (e: any) {
    console.error("Document generation error:", e);
    return NextResponse.json({ error: "Error al generar documento", detail: e.message }, { status: 500 });
  }

  const mimeMap: Record<string, string> = {
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  const safeName = company.name.replace(/[^a-zA-Z0-9_\-]/g, "_");
  const fileName = `${safeName}_${template.name.replace(/[^a-zA-Z0-9_\-]/g, "_")}.${ext}`;

  return new NextResponse(new Uint8Array(outBuffer), {
    status: 200,
    headers: {
      "Content-Type": mimeMap[ext] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": outBuffer.length.toString(),
    },
  });
}
