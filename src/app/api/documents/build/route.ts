import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentTemplates, companies, compSets, publicComps, userSettings, financialSnapshots } from "@/lib/schema";
import { eq, inArray, desc } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

// Allow up to 5 minutes — Claude + Railway can easily exceed Vercel's 60s default.
export const maxDuration = 300;

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
    textbox:    "Plain text — THIS is how chart/panel titles work in PANDO decks, e.g. 'Brand NPS' (bold, ~11pt, NKB) with a smaller italic subtitle below it like '(Net Promoter Score)' (size 9, italic, grey 666666). No background, no border. Props: text, x, y, w, h, size, bold, italic, fg, align (l/c/r).",
    shape:      "Filled rectangle (optionally with text) or a thin bordered box around a single data callout (e.g. a percentage label like '37%' boxed in a thin black/grey border with white fill). Props: x, y, w, h, bg, text, fg, border, border_pt.",
    bar:        "Vertical clustered column chart — use for comparing 2+ series across the same categories (e.g. Perception vs Experience by attribute, This Year vs Last Year by quarter). Props: x, y, w, h, labels[], series:[{name, values[], color, hatched?, data_labels?}], ymin, ymax, num_fmt, gap_width, overlap. Set hatched:true on ONE series to give it a diagonal-line texture (matches the real PANDO 'perception' bars) — only do this when you want to visually distinguish a 'perceived/estimated' series from an 'actual' one. Set data_labels:true to print the value above each bar.",
    hbar_float: "Horizontal floating bar chart for price/value ranges (e.g. valuation range by methodology — DCF, precedent M&A, public comps). Props: x, y, w, h, series:[{label,min,max}], colors[].",
    line:       "Single-series line chart (time series). Props: x, y, w, h, labels[], values[], color, ymin, ymax, num_fmt, skip.",
    line_multi: "Multi-series line chart (cohort/vintage/trend comparison, e.g. revenue by segment over years, with an optional dashed 'forecast' series). Props: x, y, w, h, labels[], series:[{name,values[],color,dashed?}], ymin, ymax.",
    donut:      "Doughnut market share chart. Props: x, y, w, h, slices:[{label,value,color}], hole (default 55).",
    scatter:    "XY scatter (e.g. CAGR vs margin positioning, growth vs profitability of peers). Props: x, y, w, h, points:[{label,x,y,color,size}].",
    quadrant:   "2×2 positioning matrix (e.g. brand positioning, price vs quality). Props: x, y, w, h, axis_labels:{top,bottom,left,right}, brands:[{label,px,py,color}] where px/py are 0-1.",
    table:      "Native PPTX table — use for comparables tables, financial summaries, cap tables, or any data better read as rows/columns than as a chart (3+ columns of mixed numeric/text data). Dark-green header row with white bold text and light-grey zebra striping are applied automatically — do not also wrap it in a shape/panel_hdr. Props: x, y, w, headers:[string], rows:[[string|number,...]], col_widths?:[inches per column], size (font pt, default 8), zebra (default true), bold_first_col (bold the leftmost column, e.g. company/metric names), header_h, row_h.",
    panel_hdr:  "RARELY USED. A colored full-width header bar. This does NOT appear in standard PANDO data slides — only use it for a section-banner slide that explicitly needs a colored divider strip. Do not use it as a chart or table title.",
  },
};

// ── System prompt for Claude ───────────────────────────────────────────────────
function buildSystemPrompt(companyData: string, peersData: string): string {
  return `You are a senior investment banking analyst at PANDO, a private equity firm, building a real investor-facing presentation. You have full creative and analytical control: you decide which slides exist, what each one argues, and which chart best supports that argument. Treat this like a real engagement, not a template-filling exercise.

TEMPLATE PROFILE (colors, fonts, layouts, element types you can place):
${JSON.stringify(PANDO_TEMPLATE_PROFILE, null, 2)}

HOW REAL PANDO SLIDES LOOK (study this carefully — this is the bar):
A real PANDO data slide has, top to bottom:
1. A small category tag ("THE COMPANY", "MARKET OVERVIEW") and a bold ALL-CAPS title ("BRAND PERCEPTION").
2. One or two sentences of body copy with key phrases in **bold** — this sentence states the actual finding/argument, not a description of the slide.
3. One or two chart panels side by side. Each panel's "header" is just a textbox: a bold ~11pt line (e.g. "Product Attributes for Non-Clients (Perception) vs. Actual Clients (Experience)") with an optional italic grey subtitle underneath — PLAIN TEXT, never inside a colored rectangle.
4. The chart itself, clean: thin grey gridlines, small soft-grey axis labels, a thin axis line, a simple legend below.
5. Data callouts directly on top of/around bars when useful — small boxed numbers with thin borders (white fill, black/dark text), or underlined deltas like "+27pps" — built using small shape/textbox elements layered at precise x/y over the chart, not chart-native data labels.
6. A footnote "Source  [name]" bottom-left, in small grey italic text.

NEVER do this (common mistake to avoid): wrapping a chart's title in a solid colored rectangle (panel_hdr). That banner look does not exist anywhere in the real PANDO template — it reads as an AI-generated placeholder. Chart titles are always plain text per rule 3 above.

LAYOUT RULES:
- The slide canvas is 13.33 inches wide × 7.5 inches tall.
- Standard content area: x=0.70 to x=13.03 (w=12.93), y=1.78 to y=6.50.
- For two side-by-side panels: left at x=0.70 w=6.10, right at x=7.00 w=6.10.
- For four panels (2×2): left col x=0.70, right col x=7.00, top row y=1.78, bottom row y=4.15.
- Each panel: textbox title (h≈0.45, accounting for subtitle line) immediately above the chart, then the chart (h≈1.9-2.1 for 2×2, h≈3.8-4.2 for a single full-width chart).
- Takeaway layout: set category (small text), title (ALL CAPS), takeaway (key insight 1-2 sentences, bold the specific number/finding), note (source attribution, "Source  [name]" format).
- Divider layout: only set title (1-3 word section name). No elements.
- Cover slide: ALWAYS the first slide. Use layout "cover" with fields: title (company name), subtitle (e.g. "Investment Overview | June 2026"). No elements needed — the cover design is drawn automatically.
- Back cover: ALWAYS the last slide. Use layout "back_cover" with fields: title ("Preguntas" or "Gracias"), subtitle (optional tagline). No elements needed.
- Every deck MUST start with a cover slide (index 0) and end with a back_cover (last slide).

CONTENT JUDGMENT — think like an analyst, not a template filler:
- Every slide must make a specific, falsifiable claim using real numbers from the company data, peer comparables, or uploaded documents. Never write generic placeholder content ("Illustrative", "Segment A", "Chart Area", "Lorem"). If a real number isn't available, do not invent one — choose a different angle you do have data for, or omit that slide.
- Decide the deck structure yourself based on what data is actually available: e.g. company overview → market/competitive position → financial performance → valuation → investment thesis. Skip sections with no underlying data rather than padding with fake placeholders.
- Vary slide layouts — don't repeat the exact same panel arrangement on every slide; some slides should be a single full-width chart, some a 2×2 grid, some side-by-side, some a table, some a divider.

CHART/ELEMENT SELECTION — pick based on what the data actually is, not habit:
- Comparing 2+ named groups across the same set of categories (perception vs reality, this year vs last year, us vs competitor by attribute) → bar (clustered columns).
- A trend over time, one series → line. Multiple series over time (cohorts, segments, forecast vs actual) → line_multi (dashed for forecast/projected).
- Parts of a whole at one point in time (market share, revenue mix) → donut.
- A range or spread per category (valuation by methodology, price ranges) → hbar_float.
- Two continuous metrics for many entities at once (growth vs margin across peers) → scatter. Same but framed as four strategic zones → quadrant.
- Anything with 3+ columns of mixed text/numeric data that's meant to be read precisely, not eyeballed as a shape (comparables table, cap table, financial summary, deal terms) → table. Never force tabular data into a chart, and never force a real comparison into a table when a chart would show the trend better.
- Don't default to the same chart type on every slide just because it worked once — re-evaluate per slide based on what's actually being compared.

WORKED EXAMPLE — a 2x2-panel takeaway slide with a clustered bar chart and a table, showing correct structure and coordinates:
{
  "layout": "takeaway",
  "category": "THE COMPANY",
  "title": "BRAND PERCEPTION",
  "takeaway": "The Company's D2C model enables **high quality products at accessible prices**, translating into an NPS of ~80, well above category peers.",
  "note": "Source  Internal brand survey, n=1,200",
  "elements": [
    { "type": "textbox", "text": "Product Attributes — Perception vs. Experience", "x": 0.70, "y": 1.78, "w": 6.10, "h": 0.30, "size": 11, "bold": true },
    { "type": "bar", "x": 0.70, "y": 2.20, "w": 6.10, "h": 3.6,
      "labels": ["Design", "Quality", "Variety", "Price-Quality"],
      "series": [
        { "name": "Perception", "values": [0.37, 0.32, 0.32, 0.27], "color": "0A231F", "hatched": true, "data_labels": true },
        { "name": "Experience", "values": [0.64, 0.61, 0.51, 0.59], "color": "437742", "data_labels": true }
      ],
      "ymin": 0, "ymax": 0.8, "num_fmt": "0%"
    },
    { "type": "textbox", "text": "Brand NPS vs. Public Peers", "x": 7.00, "y": 1.78, "w": 6.03, "h": 0.30, "size": 11, "bold": true },
    { "type": "table", "x": 7.00, "y": 2.30, "w": 6.03,
      "headers": ["Brand", "NPS"],
      "rows": [["The Company", "80"], ["Peer A", "65"], ["Peer B", "50"], ["Peer C", "44"]],
      "col_widths": [4.0, 2.03], "bold_first_col": true
    }
  ]
}
Note the takeaway uses **double asterisks** to mark the phrase that should render bold — the builder converts this automatically.

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
    const templateId   = formData.get("templateId")   as string;
    const companyId    = formData.get("companyId")    as string | null;
    const userPrompt   = (formData.get("userPrompt")  as string) || "";
    const approvedPlan = (formData.get("approvedPlan") as string | null) || null;
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
    let companyName = "presentacion";

    if (companyId) {
      const [co] = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);

      if (co) {
        companyName = co.name;
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

    const instructionText = [
      approvedPlan
        ? `PLAN APROBADO POR EL USUARIO — sigue esta estructura exactamente (mismas secciones, mismos títulos, mismos tipos de gráfica):\n${approvedPlan}\n\nConvierte este plan al JSON de slides completo.`
        : null,
      userPrompt || "Genera una presentación de inversión completa para esta empresa usando el formato PANDO.",
    ].filter(Boolean).join("\n\n");

    const userMessage: Anthropic.MessageParam = {
      role: "user",
      content: [
        ...contextParts,
        { type: "text", text: instructionText },
      ],
    };

    const claudeResp = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: buildSystemPrompt(companyData, peersData),
      messages: [userMessage],
    });

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
    const endpoint = getPptxEndpoint();
    let buildResp: Response;
    try {
      buildResp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_url: template.filePath, slide_plan: slidePlan }),
      });
    } catch (fetchErr) {
      return NextResponse.json(
        { error: `No se pudo conectar al servicio PPTX (${endpoint}): ${fetchErr instanceof Error ? fetchErr.message : fetchErr}` },
        { status: 500 }
      );
    }

    // Always read as text first so HTML error pages don't crash JSON.parse
    const rawBody = await buildResp.text();
    let buildJson: { data?: string; slide_count?: number; error?: string; detail?: string } = {};
    try {
      buildJson = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: `El servicio PPTX devolvió una respuesta inválida (HTTP ${buildResp.status}): ${rawBody.slice(0, 300)}` },
        { status: 500 }
      );
    }

    // FastAPI's HTTPException returns { detail: "..." }, not { error: "..." }
    const pptxError = buildJson.error ?? buildJson.detail;
    if (!buildResp.ok || pptxError) {
      return NextResponse.json(
        { error: pptxError ?? `Error en pptx-service (HTTP ${buildResp.status})` },
        { status: 500 }
      );
    }

    const { data: pptxBase64, slide_count } = buildJson;

    // ── 7. Return the generated PPTX ──────────────────────────────────────────
    return NextResponse.json({
      success: true,
      data: pptxBase64,
      slide_count,
      filename: `${companyName.replace(/[^a-zA-Z0-9_\-]/g, "_")}_${new Date().toISOString().slice(0, 10)}.pptx`,
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
