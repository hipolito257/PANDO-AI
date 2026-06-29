import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentTemplates, companies, compSets, publicComps, userSettings, financialSnapshots } from "@/lib/schema";
import { eq, inArray, desc } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

// In production (Vercel): call the Python serverless function on the same domain.
// In local dev: call the local FastAPI service on port 5053.
function getPptxEndpoint(): string {
  if (process.env.PPTX_SERVICE_URL) return `${process.env.PPTX_SERVICE_URL}/build/pptx`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}/api/pptx_build`;
  return "http://127.0.0.1:5053/build/pptx";
}

// ── PANDO template profile (colors, font, available layouts) ──────────────────
// Sent to Claude so it knows what's available to use.
const PANDO_TEMPLATE_PROFILE = {
  font: "Work Sans Light",
  colors: {
    DKG: "004F46",  // dark green  — primary headers, key series
    MDG: "437742",  // medium green — secondary
    OLV: "806E4B",  // olive        — tertiary
    TEL: "4B5F62",  // teal grey    — quaternary
    LBL: "A5C8D1",  // light blue   — 2021 vintage
    GRG: "D9DBD4",  // light grey   — inactive / others
    NKB: "0A231F",  // near black   — text, new stores
    WHT: "FFFFFF",  // white
  },
  layouts: {
    takeaway: "Main content slide with title, category tag, takeaway message at bottom, and footnote. Use for all data slides.",
    divider:  "Section divider — dark full-bleed background with large section title. No charts.",
    blank:    "Blank slide — just the master background. Use if you need full creative control.",
  },
  slide_width_in: 13.33,
  slide_height_in: 7.5,
  element_types: {
    panel_hdr:  "Colored header bar above a chart panel. Props: text, x, y, w, bg (color hex).",
    textbox:    "Plain text. Props: text, x, y, w, h, size, bold, italic, fg, align (l/c/r).",
    shape:      "Filled rectangle (optionally with text). Props: x, y, w, h, bg, text, fg, border.",
    hbar_float: "Horizontal floating bar chart for price ranges. Props: x, y, w, h, series:[{label,min,max}], colors[].",
    line:       "Single-series line chart (time series). Props: x, y, w, h, labels[], values[], color, ymin, ymax, num_fmt, skip.",
    line_multi: "Multi-series line chart (cohort/vintage). Props: x, y, w, h, labels[], series:[{name,values[],color,dashed?}], ymin, ymax.",
    donut:      "Doughnut market share chart. Props: x, y, w, h, slices:[{label,value,color}], hole (default 55).",
    scatter:    "XY scatter (CAGR vs margin). Props: x, y, w, h, points:[{label,x,y,color,size}].",
    quadrant:   "2×2 positioning matrix. Props: x, y, w, h, axis_labels:{top,bottom,left,right}, brands:[{label,px,py,color}] where px/py are 0-1.",
  },
};

// ── System prompt for Claude ───────────────────────────────────────────────────
function buildSystemPrompt(companyData: string, peersData: string): string {
  return `You are an expert investment banking analyst at PANDO, a private equity firm.
Your task is to generate a structured slide plan (JSON) for a PowerPoint presentation.
The plan will be executed by a code builder — do NOT write any text other than the JSON.

TEMPLATE PROFILE:
${JSON.stringify(PANDO_TEMPLATE_PROFILE, null, 2)}

LAYOUT RULES:
- The slide canvas is 13.33 inches wide × 7.5 inches tall.
- Standard content area: x=0.70 to x=13.03 (w=12.93), y=1.78 to y=6.50.
- For two side-by-side panels: left at x=0.70 w=6.10, right at x=7.00 w=6.10.
- For four panels (2×2): left col x=0.70, right col x=7.00, top row y=1.78, bottom row y=4.15. Each panel header h=0.27, chart h=2.03.
- Always add a panel_hdr BEFORE each chart.
- Takeaway layout: set category (small text), title (ALL CAPS), takeaway (key insight 1-2 sentences), note (source attribution).
- Divider layout: only set title (1-3 word section name). No elements.

PANDO STYLE RULES:
- Colors: use DKG for primary emphasis, MDG for secondary, OLV for tertiary, TEL for quaternary.
- For series with 4+ items cycle through: DKG, MDG, OLV, TEL, LBL, GRG.
- Vintage/cohort charts: 2021→LBL, 2022→TEL, 2023→OLV, 2024→DKG, 2025→MDG, New stores→NKB (dashed).
- Never use colors outside the PANDO palette.
- Notes format: "Source  [source name]" (two spaces between Source and the name).

COMPANY DATA:
${companyData}

PEER COMPARABLES:
${peersData}

OUTPUT FORMAT:
Return ONLY valid JSON matching this schema exactly:
{
  "slides": [
    {
      "layout": "takeaway" | "divider" | "blank",
      "category": "string (optional)",
      "title": "string",
      "takeaway": "string (takeaway layout only)",
      "note": "string (optional)",
      "elements": [ ... ]
    }
  ]
}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function fmtNum(n: unknown): string {
  if (n == null) return "N/D";
  const v = Number(n);
  if (isNaN(v)) return "N/D";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

// ── Route handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const templateId = formData.get("templateId") as string;
    const companyId  = formData.get("companyId")  as string | null;
    const userPrompt = (formData.get("userPrompt") as string) || "";
    const contextFiles = formData.getAll("files") as File[];

    // ── 1. Load template ──────────────────────────────────────────────────────
    if (!templateId) {
      return NextResponse.json({ error: "templateId requerido" }, { status: 400 });
    }
    const [template] = await db
      .select()
      .from(documentTemplates)
      .where(eq(documentTemplates.id, templateId))
      .limit(1);
    if (!template) {
      return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
    }
    if (template.type !== "pptx") {
      return NextResponse.json(
        { error: "El builder avanzado solo funciona con plantillas PPTX." },
        { status: 400 }
      );
    }

    // ── 2. Load company data ──────────────────────────────────────────────────
    let companyData = "No se seleccionó empresa.";
    let peersData   = "No hay comparables disponibles.";

    if (companyId) {
      const [co] = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);

      if (co) {
        // Latest financial snapshot
        const [snap] = await db
          .select()
          .from(financialSnapshots)
          .where(eq(financialSnapshots.companyId, companyId))
          .orderBy(desc(financialSnapshots.year))
          .limit(1);

        companyData = `
Company: ${co.name}
Sector: ${co.sector ?? "N/D"} | Country: ${co.country ?? "N/D"} | Stage: ${co.stage ?? "N/D"}
Revenue: ${fmtNum(co.revenueUsd ?? snap?.revenueUsd)} | EBITDA: ${fmtNum(co.ebitdaUsd ?? snap?.ebitdaUsd)}
EBITDA Margin: ${co.ebitdaMargin != null ? `${(co.ebitdaMargin * 100).toFixed(1)}%` : "N/D"}
Revenue Growth: ${co.revenueGrowth != null ? `${(co.revenueGrowth * 100).toFixed(1)}%` : "N/D"}
Employees: ${co.employees ?? "N/D"} | Total Funding: ${fmtNum(co.totalFunding)}
Description: ${co.description ?? ""}
`.trim();

        // Peer comparables — compSets.tickers is a JSON string array of ticker symbols
        const [compSet] = await db
          .select()
          .from(compSets)
          .where(eq(compSets.companyId, companyId))
          .limit(1);

        if (compSet?.tickers) {
          let tickers: string[] = [];
          try { tickers = JSON.parse(compSet.tickers); } catch { /* ignore */ }

          if (tickers.length) {
            const peers = await db
              .select()
              .from(publicComps)
              .where(inArray(publicComps.ticker, tickers));

            const evRev    = peers.map(p => p.evRevenue).filter((n): n is number => n != null && n > 0);
            const evEbitda = peers.map(p => p.evEbitda).filter((n): n is number => n != null && n > 0);

            peersData = `
Peer set (${peers.length} companies): ${peers.map(p => p.ticker).join(", ")}
EV/Revenue  median: ${median(evRev)?.toFixed(1) ?? "N/D"}x  (range: ${evRev.length ? `${Math.min(...evRev).toFixed(1)}-${Math.max(...evRev).toFixed(1)}x` : "N/D"})
EV/EBITDA   median: ${median(evEbitda)?.toFixed(1) ?? "N/D"}x  (range: ${evEbitda.length ? `${Math.min(...evEbitda).toFixed(1)}-${Math.max(...evEbitda).toFixed(1)}x` : "N/D"})
`.trim();
          }
        }
      }
    }

    // ── 3. Read context files ─────────────────────────────────────────────────
    const contextParts: Anthropic.MessageParam["content"] = [];
    for (const file of contextFiles.slice(0, 5)) {
      const buf = Buffer.from(await file.arrayBuffer());
      const mime = file.type;
      if (mime === "application/pdf") {
        contextParts.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
        } as never);
      } else if (mime.startsWith("image/")) {
        contextParts.push({
          type: "image",
          source: { type: "base64", media_type: mime as "image/png" | "image/jpeg", data: buf.toString("base64") },
        });
      }
      // PPTX/DOCX/XLSX text extraction could be added here
    }

    // ── 4. Get user API key ───────────────────────────────────────────────────
    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, session.user.id))
      .limit(1);

    const apiKey = settings?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Configura tu API key de Anthropic en Configuración." },
        { status: 400 }
      );
    }

    // ── 5. Call Claude to generate slide plan ─────────────────────────────────
    const claude = new Anthropic({ apiKey });

    const userMessage: Anthropic.MessageParam = {
      role: "user",
      content: [
        ...contextParts,
        {
          type: "text",
          text: userPrompt || "Genera una presentación de inversión completa para esta empresa usando el formato PANDO.",
        },
      ],
    };

    const claudeResp = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: buildSystemPrompt(companyData, peersData),
      messages: [userMessage],
      betas: ["pdfs-2024-09-25"],
    } as never);

    const rawText = claudeResp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("");

    // Extract JSON from response (Claude sometimes wraps in ```json)
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
      ?? rawText.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Claude no devolvió un plan JSON válido.", raw: rawText.slice(0, 500) },
        { status: 500 }
      );
    }

    let slidePlan: Record<string, unknown>;
    try {
      slidePlan = JSON.parse(jsonMatch[1]);
    } catch {
      return NextResponse.json(
        { error: "Error parseando JSON de Claude.", raw: jsonMatch[1].slice(0, 500) },
        { status: 500 }
      );
    }

    // ── 6. Call Python pptx-service ───────────────────────────────────────────
    const buildResp = await fetch(getPptxEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template_url: template.filePath,
        slide_plan: slidePlan,
      }),
    });

    if (!buildResp.ok) {
      const err = await buildResp.text();
      return NextResponse.json(
        { error: `Error en pptx-service: ${err}` },
        { status: 500 }
      );
    }

    const { data: pptxBase64, slide_count } = await buildResp.json();

    // ── 7. Return the generated PPTX ──────────────────────────────────────────
    return NextResponse.json({
      success: true,
      data: pptxBase64,
      slide_count,
      filename: `${template.name.replace(/\s+/g, "_")}_generado.pptx`,
      slide_plan: slidePlan,   // expose for debugging / preview
    });

  } catch (err) {
    console.error("[build/pptx]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error inesperado" },
      { status: 500 }
    );
  }
}
