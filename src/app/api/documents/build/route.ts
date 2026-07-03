import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentTemplates, companies, compSets, publicComps, userSettings, financialSnapshots } from "@/lib/schema";
import { eq, inArray, desc } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import { extractPlainText } from "@/lib/extractDocumentText";

export const maxDuration = 300;

function getPptxEndpoint(): string {
  if (process.env.PPTX_SERVICE_URL) return `${process.env.PPTX_SERVICE_URL}/build/pptx`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}/api/pptx_build`;
  return "http://127.0.0.1:5053/build/pptx";
}
function getProfileEndpoint(): string {
  if (process.env.PPTX_SERVICE_URL) return `${process.env.PPTX_SERVICE_URL}/profile/template`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}/api/pptx_profile`;
  return "http://127.0.0.1:5053/profile/template";
}

// ── PANDO template profile ────────────────────────────────────────────────────
// Default profile for PANDO's own template. When a different template is
// uploaded, buildSystemPrompt merges in real colors/font read from that
// template's theme (see getTemplateProfile below + template_profiler.py) so
// generated decks always match the ACTUAL uploaded template, not just PANDO's.
const PANDO_TEMPLATE_PROFILE = {
  font: "Work Sans Light",
  colors: {
    DKG: "004F46", MDG: "437742", OLV: "806E4B", TEL: "4B5F62",
    LBL: "A5C8D1", GRG: "D9DBD4", NKB: "0A231F", WHT: "FFFFFF",
  },
  layouts: {
    takeaway: "Main content slide with title, category tag, takeaway message at bottom, and footnote. Use for all data slides.",
    divider:  "Section divider — dark full-bleed background with large section title.",
    blank:    "Blank slide — just the master background.",
  },
  slide_width_in: 13.33,
  slide_height_in: 7.5,
  element_types: {
    textbox:    "Plain text. Supports **bold** spans inside the text for partial emphasis. Props: text, x, y, w, h, size, bold, italic, fg, align (l/c/r). NOTE: for chart titles, prefer the chart's own title/subtitle props (see below) instead of a separate textbox.",
    shape:      "Filled rectangle (optionally with text) or a thin bordered box around a single data callout (e.g. a percentage label like '37%' boxed in a thin black/grey border with white fill). Props: x, y, w, h, bg, text, fg, border, border_pt.",
    bar:        "Vertical clustered column chart — use for comparing 2+ series across the same categories. Props: x, y, w, h, labels[], series:[{name, values[], color, hatched?, data_labels?}], ymin, ymax, num_fmt, gap_width, overlap. Set data_labels:true on each series — every value renders in a thin-bordered box above the bar (the real PANDO look), not plain floating text; pass box_labels:false only to opt out. For a 'perception vs experience' / 'before vs after' TWO-series comparison, set hatched:true on the first series (diagonal-stripe pattern vs a solid second series) and pair_deltas:true at the chart level to auto-draw a '+Npps' delta call-out with an underline above each category pair; optionally set highlight_category:<index> to draw a dashed box around one standout category (exactly the 'Brand Perception' reference-deck pattern).",
    hbar_float: "Horizontal floating bar chart for price/value ranges. Props: x, y, w, h, series:[{label,min,max}], colors[].",
    line:       "Single-series line chart (time series). Props: x, y, w, h, labels[], values[], color, ymin, ymax, num_fmt, skip, data_labels? (boxed value above each point, e.g. every year's revenue number in a thin border — the 'Historical Performance' pattern), box_labels? (default true, set false to opt out).",
    line_multi: "Multi-series line chart. Props: x, y, w, h, labels[], series:[{name,values[],color,dashed?,data_labels?}], ymin, ymax, num_fmt. Set data_labels:true per series for boxed value callouts on that line's points.",
    band_scatter: "Dot plot over shaded horizontal range bands with a bottom color-dot legend — THE element for payback/cohort/timing analysis (e.g. 'months to profitability by opening date'). Points and band edges use fractional 0-1 coordinates like quadrant (px/py, py=0 bottom to 1 top). Props: x, y, w, h, title/subtitle, bands:[{y0,y1,color,label}] (fractional range + a boxed left-side label like '1-12: 41%'), y_ticks?:[{label,py}], x_ticks?:[string] (evenly spaced along the bottom), points:[{px,py,color,size?}], legend?:[{label,color}] (bottom row, one entry per brand/series color used in points).",
    donut:      "Doughnut chart. Props: x, y, w, h, slices:[{label,value,color}], hole (default 55), center:[string] — 1-2 short lines of KPI text rendered INSIDE the hole (e.g. ['~570k annual customers','+82% younger than 45']; first line bold). Two or three donuts side by side with center KPIs is a signature PANDO pattern for segment/mix comparisons.",
    scatter:    "XY scatter. Props: x, y, w, h, points:[{label,x,y,color,size}], x_fmt?, y_fmt? (axis number formats, default plain '#,##0' — only set to '0%' the axis that is actually a percentage; do not format a €M/revenue axis as a percentage).",
    quadrant:   "2×2 positioning matrix. Props: x, y, w, h, axis_labels:{top,bottom,left,right}, brands:[{label,px,py,color}].",
    table:      "Native PPTX table. Props: x, y, w, headers:[string], rows:[[string|number,...]], col_widths?:[inches], size, zebra, bold_first_col, label_col (first column becomes a row-label rail with alternating dark-green/white cells — use for comparison matrices like brand × region metrics, with an empty first header cell), header_h, row_h. Height is driven entirely by row count (header_h + row_h × rows) — do not pass h, and leave at least 0.15in extra clearance below a table before placing another element, since a table with many rows renders taller than a quick mental estimate suggests.",
    panel_hdr:  "RARELY USED. A colored full-width header bar. Do not use as chart title.",
    stat_row:   "Row of large-number KPI callouts (e.g. '$42M' bold 32pt over a small grey label 'ARR', with an optional italic delta badge like '+18% YoY' in the corner). Use for a summary/highlights slide instead of a chart when the story IS the numbers. Props: x, y, w, h, items:[{value, label, delta?, color?}]. 2-5 items looks best.",
    icon_row:   "Colored circle with a bold 1-2 char glyph (a letter or number ONLY — never an emoji, emoji don't render reliably in PowerPoint) next to a bold header and a description line below it — the 'icon + text row' pattern. Use for narrative points (thesis pillars, risk factors, value-creation levers) that aren't data at all. Props: x, y, w, h, direction:'row'|'col' (default col), items:[{glyph, title, text, color?}].",
    comparison_cards: "2-4 side-by-side cards, each with a subtly tinted background (derived from its color), a bold colored header, and a bullet list. Use for before/after, pros/cons, or options comparison — never build this out of a table. Props: x, y, w, h, cards:[{title, bullets:[string], color?}].",
    timeline:   "Horizontal numbered milestones connected by a thin line — numbered circles with a bold label under each and optional detail text. Use for roadmaps, process flows, deal timelines, or historical milestones — never as a bulleted list. Props: x, y, w, h, steps:[{num?, label, text?, color?}].",
    waterfall:  "Bridge/waterfall chart for financial walks (e.g. Revenue → COGS → Opex → EBITDA, or a valuation bridge). First and last bars are anchored totals by default; middle bars float from the running cumulative total, colored green for increases and a darker tone for decreases. THIS is the correct element for any 'walk' or 'bridge' data — never fake it with a regular bar chart. Props: x, y, w, h, labels[], values[] (deltas; anchor/total bars pass their absolute value), totals?:[bool] (defaults to true only for first/last), up_color?, down_color?, total_color?.",
    alt_timeline: "Company-history timeline: a horizontal axis mid-element with milestone dots, entries alternating above and below with dashed connectors. Each entry: bold colored year label + short description with **bold** spans on the key facts. THE element for a COMPANY HISTORY / deal-history slide — far richer than 'timeline'. Fits 5-8 entries full-width. Props: x, y, w, h, entries:[{label, text, color?}].",
    org_chart:  "Corporate/holding structure chart: rows of boxes (colored title band + light jurisdiction band + optional italic note below), connected to their parent with dashed elbow lines annotated with ownership percentages. THE element for a CORPORATE STRUCTURE / transaction-perimeter slide. Props: x, y, w, h, levels:[[{label, sub?, note?, color?, parent? (index of parent node in the level above), pct? (e.g. '99.9%')}]].",
    process_flow: "Horizontal value-chain/process: dark header boxes joined by arrows, each with an italic description underneath (Designer → Manufacturer → Brand → Retailer). Use for business-model, supply-chain, or step-sequence explanations. 3-6 steps. Props: x, y, w, h, steps:[{title, text?, color?}].",
    pill_row:   "Bottom-of-slide band of 3-5 rounded tinted callouts, each a short sentence with **bold** spans on the figures (e.g. '**+3.0x** sales per store vs. incumbents'). Use UNDER a diagram/chart to hammer home proof points — pairs especially well with process_flow and icon_row. Props: x, y, w, h (≈0.75-0.9), items:[{text, color?, size?}].",
  },
};

function buildSystemPrompt(
  companyData: string,
  peersData: string,
  profile: Omit<typeof PANDO_TEMPLATE_PROFILE, "colors"> & { colors: Record<string, string> } = PANDO_TEMPLATE_PROFILE,
): string {
  return `You are a senior investment banking analyst at PANDO, a private equity firm, building a real investor-facing presentation. You have full creative and analytical control.

TEMPLATE PROFILE (colors, fonts, layouts, element types you can place):
${JSON.stringify(profile, null, 2)}

HOW REAL PANDO SLIDES LOOK:
A real PANDO data slide has, top to bottom:
1. A small category tag ("THE COMPANY", "MARKET OVERVIEW") and a bold ALL-CAPS title ("BRAND PERCEPTION").
2. One or two sentences of body copy with key phrases in **bold** — this sentence states the actual finding/argument.
3. One or two chart panels side by side. EVERY chart element (bar, line, line_multi, donut, hbar_float, scatter, waterfall) accepts "title" and "subtitle" props that render as its plain-text header — a bold ~10.5pt title with an italic grey subtitle in parentheses under it, e.g. title: "Brand NPS", subtitle: "(Net Promoter Score)". ALWAYS set both on every chart: a chart without a header looks unfinished. The header is drawn inside the chart's own x/y/w/h box, so no separate textbox and no extra spacing math is needed.
4. The chart itself, clean: thin grey gridlines, small soft-grey axis labels, data labels on bars, a small legend below.
5. A footnote "Source  [name]" bottom-left, in small grey italic text — set "note" on every data slide.

NEVER wrap a chart's title in a solid colored rectangle (panel_hdr). Chart titles are always plain text via the chart's title/subtitle props.

LAYOUT RULES:
- The slide canvas is 13.33 inches wide × 7.5 inches tall.
- Standard content area: x=0.85 to x=13.03 (w=12.18), y=2.0 to y=6.50. MINIMUM x for ANY element is 0.85. MINIMUM y for ANY element is 2.0 (content area starts at 2.0" — below the title and takeaway text).
- For two side-by-side panels: left at x=0.85 w=5.95, right at x=7.00 w=6.03.
- For four panels (2×2): left col x=0.85, right col x=7.00, top row y=1.78, bottom row y=4.15.
- Takeaway layout: set category (small text), title (ALL CAPS), takeaway (key insight 1-2 sentences, bold the specific number/finding), note (source attribution, "Source  [name]" format).
- Divider layout: set title (1-3 word section name IN ALL CAPS) and takeaway (1 brief sentence describing what this section covers). No elements.
- Cover slide: layout "cover" with fields: title (company name), subtitle (e.g. "Investment Overview | June 2026"). No elements.
- Back cover: layout "back_cover" with fields: title ("Preguntas" or "Gracias"), subtitle (optional tagline). No elements.

LAYOUT VARIETY — DO NOT REPEAT THE SAME SLIDE SHAPE OVER AND OVER:
A deck where every content slide is "two chart panels side by side" reads as templated and lazy. Vary the shape slide to slide based on what the content actually is:
- A slide whose story IS a handful of headline numbers → stat_row, full-width, no chart at all.
- A slide about qualitative pillars (thesis, risks, value-creation levers, team strengths) → icon_row, not a chart forced onto text.
- A slide comparing two or more options/scenarios/before-after → comparison_cards, not a table.
- A slide about the company's history/milestones over the years → alt_timeline full-width (the alternating above/below axis), not "timeline" and never bullets.
- A slide about a roadmap, process steps, or deal next-steps → timeline (simple numbered) or process_flow (boxed steps with arrows) depending on whether the steps need descriptions.
- A slide explaining the business model or value chain → process_flow, optionally with a pill_row of proof-point callouts underneath.
- A slide about corporate/legal structure or the transaction perimeter → org_chart.
- A slide comparing brands/regions across many metrics → table with label_col:true (the comparison-matrix look).
- A slide about customer/segment mix → 2-3 donuts side by side, each with center KPI text.
- A slide about a financial walk (revenue to EBITDA, valuation build-up, cost bridge) → waterfall, never a regular bar chart pretending to be one.
- A slide about payback period, cohort timing, or "how long until X" scattered across many individual deals/stores/cohorts → band_scatter (shaded range bands + dot plot + legend), never a generic scatter for this.
- A slide comparing stated perception vs measured reality on several attributes → bar with hatched:true on the perception series + pair_deltas:true (the striped-vs-solid pps-delta pattern), not two separate charts.
- Single full-bleed chart taking the whole content area is often stronger than two cramped panels — use it when one chart deserves the whole slide.
- Across a section of 4-6 slides, aim for at least 3 different element types/layouts, not the same panel formula every time.

DENSITY — REAL DECKS ARE RICH, NOT SPARSE:
Reference-quality PANDO slides are DENSE: a full-width diagram plus a pill_row of KPIs, or two charts each with headers and data labels, or a 6-row comparison matrix. A slide with one small chart floating in white space reads as unfinished. Fill the content area (y=2.0 to ~6.5): if the main element only needs 3 inches of height, add a complementary element below it (pill_row of proof points, a small table, a stat_row) that reinforces the takeaway with real numbers from the source material.

CHART/ELEMENT SELECTION:
- Comparing groups across categories → bar (clustered columns).
- Trend over time, one series → line. Multiple series → line_multi.
- Parts of a whole → donut.
- Ranges per category → hbar_float.
- Two continuous metrics for many entities → scatter. Strategic zones → quadrant.
- 3+ columns of mixed text/numeric data → table.
- Headline KPIs with no need for a chart → stat_row.
- Qualitative pillars/narrative points → icon_row.
- Options/before-after comparison → comparison_cards.
- Roadmap/process/milestones → timeline.
- Financial bridge/walk (start → deltas → end) → waterfall. Always use the "waterfall" element type for this — never fake a bridge with a "bar" chart that has one series per category, since those bars all start at 0 instead of floating and the legend ends up listing every category name.

PANDO STYLE:
- Colors: DKG for primary emphasis, MDG for secondary, OLV for tertiary, TEL for quaternary.
- For series with 4+ items cycle: DKG, MDG, OLV, TEL, LBL, GRG.
- Vintage/cohort charts: 2021→LBL, 2022→TEL, 2023→OLV, 2024→DKG, 2025→MDG.
- Never use colors outside the PANDO palette.
- Never use emoji characters anywhere (titles, bullets, shape text, icon_row glyphs) — they render inconsistently in PowerPoint. Use icon_row's glyph (a letter/number) for iconography instead.
- Notes format: "Source  [source name]" (two spaces).

COMPANY DATA:
${companyData}

PEER COMPARABLES:
${peersData}

OUTPUT FORMAT:
Return ONLY valid JSON:
{
  "slides": [
    {
      "layout": "takeaway" | "divider" | "blank",
      "category": "string (optional)",
      "title": "string",
      "takeaway": "string (required for takeaway and divider layouts)",
      "note": "string (optional)",
      "elements": [ ... ]
    }
  ]
}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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

function repairJson(s: string): string {
  const pre = s
    .replace(/\bNone\b/g, "null")
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false");
  return jsonrepair(pre);
}

// ── Section parsing ───────────────────────────────────────────────────────────
interface PlanSlide {
  index: number;
  type: string;
  title?: string;
  section?: string;
  takeaway?: string;
  chart?: string;
  subtitle?: string;
}

interface Section {
  name: string;
  divider: PlanSlide | null;
  slides: PlanSlide[];
}

function parseSections(planSlides: PlanSlide[]): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const slide of planSlides) {
    if (slide.type === "cover" || slide.type === "back_cover") continue;
    if (slide.type === "divider") {
      if (current) sections.push(current);
      current = { name: slide.section || slide.title || "Section", divider: slide, slides: [] };
    } else {
      if (!current) current = { name: "Content", divider: null, slides: [] };
      current.slides.push(slide);
    }
  }
  if (current) sections.push(current);
  return sections;
}

// ── Route handler (streaming SSE) ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
  }

  // Parse everything before starting the stream
  const formData = await req.formData();
  const templateId    = formData.get("templateId")    as string;
  const companyId     = formData.get("companyId")     as string | null;
  const userPrompt    = (formData.get("userPrompt")   as string) || "";
  const approvedPlanRaw = (formData.get("approvedPlan") as string | null) || null;
  const blobUrlsRaw   = (formData.get("blobUrls")     as string | null) || null;
  const blobUrls: { name: string; url: string; type: string }[] =
    blobUrlsRaw ? JSON.parse(blobUrlsRaw) : [];

  const encoder = new TextEncoder();
  let cancelled = false;
  req.signal.addEventListener("abort", () => { cancelled = true; });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); }
        catch { /* controller already closed */ }
      };

      try {
        send({ type: "progress", message: "Loading data…", current: 0, total: 0 });

        // ── Load template ────────────────────────────────────────────────────
        if (!templateId) {
          send({ type: "error", message: "templateId required" }); controller.close(); return;
        }
        const [template] = await db.select().from(documentTemplates)
          .where(eq(documentTemplates.id, templateId)).limit(1);
        if (!template) {
          send({ type: "error", message: "Template not found" }); controller.close(); return;
        }
        if (template.type !== "pptx") {
          send({ type: "error", message: "PPTX templates only" }); controller.close(); return;
        }

        // ── Profile the actual uploaded template (colors/font) ──────────────
        // Falls back to PANDO's own hardcoded profile if this isn't PANDO's
        // template, or profiling fails/returns too little to trust.
        let templatePalette: Record<string, string> | null = null;
        let templateFont: string | null = null;
        try {
          const profResp = await fetch(getProfileEndpoint(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ template_url: template.filePath }),
          });
          if (profResp.ok) {
            const prof = await profResp.json();
            if (prof?.palette && Object.keys(prof.palette).length >= 6) templatePalette = prof.palette;
            if (prof?.fonts?.minorFont) templateFont = prof.fonts.minorFont;
          }
        } catch { /* profiling is best-effort — PANDO defaults still apply */ }

        const templateProfile = {
          ...PANDO_TEMPLATE_PROFILE,
          font: templateFont || PANDO_TEMPLATE_PROFILE.font,
          colors: templatePalette || PANDO_TEMPLATE_PROFILE.colors,
        };

        // ── Load company + peers ─────────────────────────────────────────────
        let companyData = "No company was selected.";
        let peersData   = "No comparables available.";
        let companyName = "presentation";

        if (companyId) {
          const [co] = await db.select().from(companies)
            .where(eq(companies.id, companyId)).limit(1);
          if (co) {
            companyName = co.name;
            const [snap] = await db.select().from(financialSnapshots)
              .where(eq(financialSnapshots.companyId, companyId))
              .orderBy(desc(financialSnapshots.year)).limit(1);

            companyData = `
Company: ${co.name}
Sector: ${co.sector ?? "N/D"} | Country: ${co.country ?? "N/D"} | Stage: ${co.stage ?? "N/D"}
Revenue: ${fmtNum(co.revenueUsd ?? snap?.revenueUsd)} | EBITDA: ${fmtNum(co.ebitdaUsd ?? snap?.ebitdaUsd)}
EBITDA Margin: ${co.ebitdaMargin != null ? `${(co.ebitdaMargin * 100).toFixed(1)}%` : "N/D"}
Revenue Growth: ${co.revenueGrowth != null ? `${(co.revenueGrowth * 100).toFixed(1)}%` : "N/D"}
Employees: ${co.employees ?? "N/D"} | Total Funding: ${fmtNum(co.totalFunding)}
Description: ${co.description ?? ""}`.trim();

            const [compSet] = await db.select().from(compSets)
              .where(eq(compSets.companyId, companyId)).limit(1);
            if (compSet?.tickers) {
              let tickers: string[] = [];
              try { tickers = JSON.parse(compSet.tickers); } catch { /* ignore */ }
              if (tickers.length) {
                const peers = await db.select().from(publicComps)
                  .where(inArray(publicComps.ticker, tickers));
                const evRev    = peers.map(p => p.evRevenue).filter((n): n is number => n != null && n > 0);
                const evEbitda = peers.map(p => p.evEbitda).filter((n): n is number => n != null && n > 0);
                peersData = `Peer set (${peers.length} companies): ${peers.map(p => p.ticker).join(", ")}
EV/Revenue  median: ${median(evRev)?.toFixed(1) ?? "N/D"}x
EV/EBITDA   median: ${median(evEbitda)?.toFixed(1) ?? "N/D"}x`.trim();
              }
            }
          }
        }

        // ── Validate approved plan ──────────────────────────────────────────
        if (!approvedPlanRaw) {
          send({ type: "error", message: "An approved plan is required. Use the plan presentation button first." });
          controller.close(); return;
        }
        let approvedPlan: { company?: string; deck_title?: string; slides: PlanSlide[] };
        try { approvedPlan = JSON.parse(approvedPlanRaw); }
        catch {
          send({ type: "error", message: "Approved plan has invalid format." });
          controller.close(); return;
        }

        // ── Download context files ──────────────────────────────────────────
        const contextParts: Anthropic.MessageParam["content"] = [];
        for (const bf of blobUrls.slice(0, 5)) {
          try {
            const r = await fetch(bf.url);
            const buf = Buffer.from(await r.arrayBuffer());
            const mime = bf.type || "application/octet-stream";
            const ext = bf.name.split(".").pop()?.toLowerCase();
            if (mime === "application/pdf") {
              contextParts.push({
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
              } as never);
            } else if (mime.startsWith("image/")) {
              contextParts.push({
                type: "image",
                source: { type: "base64", media_type: mime as "image/png", data: buf.toString("base64") },
              });
            } else if (ext === "docx" || ext === "pptx" || ext === "xlsx") {
              const text = await extractPlainText(buf, ext);
              if (text) {
                contextParts.push({
                  type: "text",
                  text: `--- CONTENT OF ATTACHED FILE "${bf.name}" ---\n${text}\n--- END OF "${bf.name}" ---`,
                });
              }
            }
          } catch { /* skip unreadable files */ }
        }

        // ── API key ─────────────────────────────────────────────────────────
        const [settings] = await db.select().from(userSettings)
          .where(eq(userSettings.userId, session.user.id)).limit(1);
        const apiKey = settings?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          send({ type: "error", message: "Configure your Anthropic API key in Settings." });
          controller.close(); return;
        }

        const claude = new Anthropic({ apiKey });
        const today = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
        const deckTitle = approvedPlan.deck_title || companyName;
        const deckCompany = approvedPlan.company || companyName;

        // ── Parse plan into sections ────────────────────────────────────────
        const planSlides = approvedPlan.slides ?? [];
        const coverSlide    = planSlides.find(s => s.type === "cover");
        const backCoverSlide = planSlides.find(s => s.type === "back_cover");
        const sections = parseSections(planSlides);

        const totalSteps = sections.length + 1; // sections + pptx build
        send({
          type: "progress",
          message: `Plan ready — ${planSlides.length} slides in ${sections.length} section${sections.length !== 1 ? "s" : ""}`,
          current: 0,
          total: totalSteps,
        });

        // ── Generate all sections in parallel ───────────────────────────────
        send({
          type: "progress",
          message: `Generating ${sections.length} section${sections.length !== 1 ? "s" : ""} in parallel…`,
          current: 0,
          total: totalSteps,
        });

        let completedSections = 0;

        let sectionResults: object[][];
        try {
          sectionResults = await Promise.all(
          sections.map(async (section, i): Promise<object[]> => {
            if (cancelled) throw new Error("cancelled");

            // Empty sections — add divider directly, no Claude call needed
            if (section.slides.length === 0 && section.divider) {
              completedSections++;
              send({ type: "progress", message: `${completedSections}/${sections.length} sections ready…`, current: completedSections, total: totalSteps });
              return [{
                layout: "divider",
                title: section.divider.title || section.name,
                takeaway: section.divider.takeaway || "",
              }];
            }

            const slidesOutline = section.slides.map((s, idx) =>
              `${idx + 1}. "${s.title || "Slide"}"${s.takeaway ? ` — ${s.takeaway}` : ""}${s.chart ? ` [${s.chart}]` : ""}`
            ).join("\n");

            const sectionUserText = [
              `PRESENTATION: "${deckTitle}" | COMPANY: ${deckCompany} | DATE: ${today}`,
              "",
              section.divider
                ? `SECTION ${i + 1}/${sections.length}: ${section.name}`
                : "PRESENTATION CONTENT",
              "",
              `SLIDES TO GENERATE (${section.slides.length} content slides):`,
              slidesOutline,
              "",
              userPrompt ? `ADDITIONAL INSTRUCTIONS: ${userPrompt}` : null,
              blobUrls.length
                ? `ATTACHED SUPPORTING FILES: ${blobUrls.map(b => b.name).join(", ")} — their actual content is included above as document/image/text blocks. These are the primary, authoritative source for company facts, numbers, and narrative — use the real figures, names, and claims from them instead of inventing plausible-sounding but fictional data.`
                : null,
              "",
              section.divider
                ? `Generate the slide JSON for THIS SECTION ONLY. Start with a "divider" slide for "${section.name}" with a takeaway that introduces the section; then the ${section.slides.length} content slides.`
                : `Generate the JSON for the ${section.slides.length} content slides.`,
              "Reply with the JSON object only — no preamble or commentary, even to reference the attached documents.",
            ].filter((l): l is string => l != null).join("\n");

            // Retry up to 2 times on transient Claude errors
            let rawText = "";
            let stopReason = "";
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const claudeResp = await claude.messages.create({
                  model: "claude-sonnet-4-6",
                  max_tokens: 16000,
                  system: buildSystemPrompt(companyData, peersData, templateProfile),
                  messages: [{ role: "user", content: [...contextParts, { type: "text", text: sectionUserText }] }],
                });
                rawText = claudeResp.content
                  .filter((b): b is Anthropic.TextBlock => b.type === "text")
                  .map(b => b.text).join("");
                stopReason = claudeResp.stop_reason ?? "";
                break;
              } catch (e) {
                if (attempt === 2) throw e;
                await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
              }
            }

            const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/);
            if (!jsonMatch) {
              console.error(`[build] Section "${section.name}" returned no JSON. stop_reason: ${stopReason}. raw:`, rawText.slice(0, 2000));
              throw new Error(
                stopReason === "max_tokens"
                  ? `Section "${section.name}" was cut off before producing JSON (too much input to digest in one reply).`
                  : `Section "${section.name}" did not return valid JSON: "${rawText.slice(0, 150)}"`
              );
            }

            const parsed = JSON.parse(repairJson(jsonMatch[1]));
            const slides: object[] = Array.isArray(parsed.slides) ? parsed.slides : [];

            completedSections++;
            send({ type: "progress", message: `${completedSections}/${sections.length} sections ready…`, current: completedSections, total: totalSteps });
            return slides;
          })
          );
        } catch (sectionErr) {
          const msg = (sectionErr as Error).message ?? "Error generating sections";
          if (msg === "cancelled") { send({ type: "cancelled" }); }
          else { send({ type: "error", message: msg }); }
          controller.close(); return;
        }

        if (cancelled) { send({ type: "cancelled" }); controller.close(); return; }

        const allContentSlides = sectionResults.flat();

        if (cancelled) { send({ type: "cancelled" }); controller.close(); return; }

        // ── Assemble full slide plan ─────────────────────────────────────────
        const coverJson = {
          layout: "cover",
          title:    coverSlide?.title    || deckCompany,
          subtitle: coverSlide?.subtitle || `Investment Overview | ${today}`,
        };
        const backCoverJson = {
          layout:   "back_cover",
          title:    backCoverSlide?.title    || "Questions",
          subtitle: backCoverSlide?.subtitle || "",
        };

        const fullSlidePlan = { slides: [coverJson, ...allContentSlides, backCoverJson] };
        const slideCount = fullSlidePlan.slides.length;

        send({
          type: "progress",
          message: `Building presentation (${slideCount} slides)…`,
          current: totalSteps,
          total: totalSteps,
        });

        // ── Call pptx-service ────────────────────────────────────────────────
        const endpoint = getPptxEndpoint();
        let buildResp: Response;
        try {
          buildResp = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              template_url: template.filePath,
              slide_plan: fullSlidePlan,
              palette: templatePalette ?? undefined,
              font: templateFont ?? undefined,
            }),
          });
        } catch (fetchErr) {
          send({ type: "error", message: `Could not connect to the PPTX service (${endpoint}): ${(fetchErr as Error).message}` });
          controller.close(); return;
        }

        const rawBody = await buildResp.text();
        let buildJson: { data?: string; slide_count?: number; warnings?: string[]; error?: string; detail?: string } = {};
        try { buildJson = JSON.parse(rawBody); }
        catch {
          send({ type: "error", message: `Invalid response from the PPTX service (HTTP ${buildResp.status}): ${rawBody.slice(0, 200)}` });
          controller.close(); return;
        }

        const pptxError = buildJson.error ?? buildJson.detail;
        if (!buildResp.ok || pptxError) {
          send({ type: "error", message: pptxError ?? `Error in pptx-service (HTTP ${buildResp.status})` });
          controller.close(); return;
        }

        const filename = `${companyName.replace(/[^a-zA-Z0-9_-]/g, "_")}_${new Date().toISOString().slice(0, 10)}.pptx`;

        // Stream PPTX as 500 KB base64 chunks to avoid any single-event size limits.
        const base64 = buildJson.data!;
        const CHUNK = 500_000;
        const totalChunks = Math.ceil(base64.length / CHUNK);
        for (let i = 0; i < totalChunks; i++) {
          send({ type: "chunk", index: i, total: totalChunks, data: base64.slice(i * CHUNK, (i + 1) * CHUNK) });
        }
        if (buildJson.warnings?.length) {
          send({ type: "qa_warnings", warnings: buildJson.warnings });
        }
        send({ type: "done", filename, slide_count: slideCount });
        controller.close();

      } catch (err) {
        try {
          send({ type: "error", message: (err instanceof Error ? err.message : "Unexpected error") });
          controller.close();
        } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
