import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentTemplates, companies, compSets, publicComps, userSettings, financialSnapshots } from "@/lib/schema";
import { eq, inArray, desc } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";

export const maxDuration = 300;

function getPptxEndpoint(): string {
  if (process.env.PPTX_SERVICE_URL) return `${process.env.PPTX_SERVICE_URL}/build/pptx`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}/api/pptx_build`;
  return "http://127.0.0.1:5053/build/pptx";
}

// ── PANDO template profile ────────────────────────────────────────────────────
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
    textbox:    "Plain text — THIS is how chart/panel titles work in PANDO decks, e.g. 'Brand NPS' (bold, ~11pt, NKB) with a smaller italic subtitle below it like '(Net Promoter Score)' (size 9, italic, grey 666666). No background, no border. Props: text, x, y, w, h, size, bold, italic, fg, align (l/c/r).",
    shape:      "Filled rectangle (optionally with text) or a thin bordered box around a single data callout (e.g. a percentage label like '37%' boxed in a thin black/grey border with white fill). Props: x, y, w, h, bg, text, fg, border, border_pt.",
    bar:        "Vertical clustered column chart — use for comparing 2+ series across the same categories. Props: x, y, w, h, labels[], series:[{name, values[], color, hatched?, data_labels?}], ymin, ymax, num_fmt, gap_width, overlap.",
    hbar_float: "Horizontal floating bar chart for price/value ranges. Props: x, y, w, h, series:[{label,min,max}], colors[].",
    line:       "Single-series line chart (time series). Props: x, y, w, h, labels[], values[], color, ymin, ymax, num_fmt, skip.",
    line_multi: "Multi-series line chart. Props: x, y, w, h, labels[], series:[{name,values[],color,dashed?}], ymin, ymax.",
    donut:      "Doughnut market share chart. Props: x, y, w, h, slices:[{label,value,color}], hole (default 55).",
    scatter:    "XY scatter. Props: x, y, w, h, points:[{label,x,y,color,size}].",
    quadrant:   "2×2 positioning matrix. Props: x, y, w, h, axis_labels:{top,bottom,left,right}, brands:[{label,px,py,color}].",
    table:      "Native PPTX table. Props: x, y, w, headers:[string], rows:[[string|number,...]], col_widths?:[inches], size, zebra, bold_first_col, header_h, row_h.",
    panel_hdr:  "RARELY USED. A colored full-width header bar. Do not use as chart title.",
  },
};

function buildSystemPrompt(companyData: string, peersData: string): string {
  return `You are a senior investment banking analyst at PANDO, a private equity firm, building a real investor-facing presentation. You have full creative and analytical control.

TEMPLATE PROFILE (colors, fonts, layouts, element types you can place):
${JSON.stringify(PANDO_TEMPLATE_PROFILE, null, 2)}

HOW REAL PANDO SLIDES LOOK:
A real PANDO data slide has, top to bottom:
1. A small category tag ("THE COMPANY", "MARKET OVERVIEW") and a bold ALL-CAPS title ("BRAND PERCEPTION").
2. One or two sentences of body copy with key phrases in **bold** — this sentence states the actual finding/argument.
3. One or two chart panels side by side. Each panel's "header" is just a textbox: a bold ~11pt line with an optional italic grey subtitle underneath — PLAIN TEXT, never inside a colored rectangle.
4. The chart itself, clean: thin grey gridlines, small soft-grey axis labels, a simple legend below.
5. Data callouts directly on top of/around bars when useful — small boxed numbers with thin borders.
6. A footnote "Source  [name]" bottom-left, in small grey italic text.

NEVER wrap a chart's title in a solid colored rectangle (panel_hdr). Chart titles are always plain text.

LAYOUT RULES:
- The slide canvas is 13.33 inches wide × 7.5 inches tall.
- Standard content area: x=0.85 to x=13.03 (w=12.18), y=1.78 to y=6.50. MINIMUM x for ANY element is 0.85.
- For two side-by-side panels: left at x=0.85 w=5.95, right at x=7.00 w=6.03.
- For four panels (2×2): left col x=0.85, right col x=7.00, top row y=1.78, bottom row y=4.15.
- Takeaway layout: set category (small text), title (ALL CAPS), takeaway (key insight 1-2 sentences, bold the specific number/finding), note (source attribution, "Source  [name]" format).
- Divider layout: set title (1-3 word section name IN ALL CAPS) and takeaway (1 brief sentence describing what this section covers). No elements.
- Cover slide: layout "cover" with fields: title (company name), subtitle (e.g. "Investment Overview | June 2026"). No elements.
- Back cover: layout "back_cover" with fields: title ("Preguntas" or "Gracias"), subtitle (optional tagline). No elements.

CHART/ELEMENT SELECTION:
- Comparing groups across categories → bar (clustered columns).
- Trend over time, one series → line. Multiple series → line_multi.
- Parts of a whole → donut.
- Ranges per category → hbar_float.
- Two continuous metrics for many entities → scatter. Strategic zones → quadrant.
- 3+ columns of mixed text/numeric data → table.

PANDO STYLE:
- Colors: DKG for primary emphasis, MDG for secondary, OLV for tertiary, TEL for quaternary.
- For series with 4+ items cycle: DKG, MDG, OLV, TEL, LBL, GRG.
- Vintage/cohort charts: 2021→LBL, 2022→TEL, 2023→OLV, 2024→DKG, 2025→MDG.
- Never use colors outside the PANDO palette.
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
      current = { name: slide.section || slide.title || "Sección", divider: slide, slides: [] };
    } else {
      if (!current) current = { name: "Contenido", divider: null, slides: [] };
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
    return new Response(JSON.stringify({ error: "No autenticado" }), { status: 401 });
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
        send({ type: "progress", message: "Cargando datos…", current: 0, total: 0 });

        // ── Load template ────────────────────────────────────────────────────
        if (!templateId) {
          send({ type: "error", message: "templateId requerido" }); controller.close(); return;
        }
        const [template] = await db.select().from(documentTemplates)
          .where(eq(documentTemplates.id, templateId)).limit(1);
        if (!template) {
          send({ type: "error", message: "Plantilla no encontrada" }); controller.close(); return;
        }
        if (template.type !== "pptx") {
          send({ type: "error", message: "Solo plantillas PPTX" }); controller.close(); return;
        }

        // ── Load company + peers ─────────────────────────────────────────────
        let companyData = "No se seleccionó empresa.";
        let peersData   = "No hay comparables disponibles.";
        let companyName = "presentacion";

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
          send({ type: "error", message: "Se requiere un plan aprobado. Usa primero el botón de planear presentación." });
          controller.close(); return;
        }
        let approvedPlan: { company?: string; deck_title?: string; slides: PlanSlide[] };
        try { approvedPlan = JSON.parse(approvedPlanRaw); }
        catch {
          send({ type: "error", message: "Plan aprobado con formato inválido." });
          controller.close(); return;
        }

        // ── Download context files ──────────────────────────────────────────
        const contextParts: Anthropic.MessageParam["content"] = [];
        for (const bf of blobUrls.slice(0, 5)) {
          try {
            const r = await fetch(bf.url);
            const buf = Buffer.from(await r.arrayBuffer());
            const mime = bf.type || "application/octet-stream";
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
            }
          } catch { /* skip unreadable files */ }
        }

        // ── API key ─────────────────────────────────────────────────────────
        const [settings] = await db.select().from(userSettings)
          .where(eq(userSettings.userId, session.user.id)).limit(1);
        const apiKey = settings?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          send({ type: "error", message: "Configura tu API key de Anthropic en Configuración." });
          controller.close(); return;
        }

        const claude = new Anthropic({ apiKey });
        const today = new Date().toLocaleDateString("es-MX", { month: "long", year: "numeric" });
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
          message: `Plan listo — ${planSlides.length} slides en ${sections.length} sección${sections.length !== 1 ? "es" : ""}`,
          current: 0,
          total: totalSteps,
        });

        // ── Generate all sections in parallel ───────────────────────────────
        send({
          type: "progress",
          message: `Generando ${sections.length} sección${sections.length !== 1 ? "es" : ""} en paralelo…`,
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
              send({ type: "progress", message: `${completedSections}/${sections.length} secciones listas…`, current: completedSections, total: totalSteps });
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
              `PRESENTACIÓN: "${deckTitle}" | EMPRESA: ${deckCompany} | FECHA: ${today}`,
              "",
              section.divider
                ? `SECCIÓN ${i + 1}/${sections.length}: ${section.name}`
                : "CONTENIDO DE LA PRESENTACIÓN",
              "",
              `SLIDES A GENERAR (${section.slides.length} slides de contenido):`,
              slidesOutline,
              "",
              userPrompt ? `INSTRUCCIONES ADICIONALES: ${userPrompt}` : null,
              blobUrls.length ? `ARCHIVOS DE RESPALDO ADJUNTOS: ${blobUrls.map(b => b.name).join(", ")}` : null,
              "",
              section.divider
                ? `Genera el JSON de slides para ESTA SECCIÓN ÚNICAMENTE. Comienza con un slide "divider" para "${section.name}" con un takeaway que introduzca la sección; luego los ${section.slides.length} slides de contenido.`
                : `Genera el JSON para los ${section.slides.length} slides de contenido.`,
            ].filter((l): l is string => l != null).join("\n");

            const claudeResp = await claude.messages.create({
              model: "claude-sonnet-4-6",
              max_tokens: 8000,
              system: buildSystemPrompt(companyData, peersData),
              messages: [{ role: "user", content: [...contextParts, { type: "text", text: sectionUserText }] }],
            });

            const rawText = claudeResp.content
              .filter((b): b is Anthropic.TextBlock => b.type === "text")
              .map(b => b.text).join("");

            const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/);
            if (!jsonMatch) throw new Error(`Sección "${section.name}" no devolvió JSON válido`);

            const parsed = JSON.parse(repairJson(jsonMatch[1]));
            const slides: object[] = Array.isArray(parsed.slides) ? parsed.slides : [];

            completedSections++;
            send({ type: "progress", message: `${completedSections}/${sections.length} secciones listas…`, current: completedSections, total: totalSteps });
            return slides;
          })
          );
        } catch (sectionErr) {
          const msg = (sectionErr as Error).message ?? "Error generando secciones";
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
          title:    backCoverSlide?.title    || "Preguntas",
          subtitle: backCoverSlide?.subtitle || "",
        };

        const fullSlidePlan = { slides: [coverJson, ...allContentSlides, backCoverJson] };
        const slideCount = fullSlidePlan.slides.length;

        send({
          type: "progress",
          message: `Construyendo presentación (${slideCount} slides)…`,
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
            body: JSON.stringify({ template_url: template.filePath, slide_plan: fullSlidePlan }),
          });
        } catch (fetchErr) {
          send({ type: "error", message: `No se pudo conectar al servicio PPTX (${endpoint}): ${(fetchErr as Error).message}` });
          controller.close(); return;
        }

        const rawBody = await buildResp.text();
        let buildJson: { data?: string; slide_count?: number; error?: string; detail?: string } = {};
        try { buildJson = JSON.parse(rawBody); }
        catch {
          send({ type: "error", message: `Respuesta inválida del servicio PPTX (HTTP ${buildResp.status}): ${rawBody.slice(0, 200)}` });
          controller.close(); return;
        }

        const pptxError = buildJson.error ?? buildJson.detail;
        if (!buildResp.ok || pptxError) {
          send({ type: "error", message: pptxError ?? `Error en pptx-service (HTTP ${buildResp.status})` });
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
        send({ type: "done", filename, slide_count: slideCount });
        controller.close();

      } catch (err) {
        try {
          send({ type: "error", message: (err instanceof Error ? err.message : "Error inesperado") });
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
