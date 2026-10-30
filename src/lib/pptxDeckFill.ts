// Prompting and plan conversion for template-cloning deck builds (used by
// /api/documents/build). Kept out of the route file so it can be reused and tested.
import { usableSlides, catalogSlideText, type TemplateProfile, type GuideSlide } from "@/lib/pptxTemplates";

// Charts the template doesn't have are drawn by pptx-service's element engine
// inside the box of a shape they replace (or a free box), in the template's palette and font.
export const ELEMENT_TYPES: Record<string, string> = {
  bar: "Clustered columns. labels[], series:[{name, values[], color, data_labels?}], ymin?, ymax?, num_fmt?",
  line: "Single line over time. labels[], values[], color, num_fmt?, data_labels?",
  line_multi: "Several lines. labels[], series:[{name, values[], color, dashed?}], num_fmt?",
  donut: "Doughnut. slices:[{label, value, color}], center?:[1-2 short KPI lines inside the hole]",
  waterfall: "Bridge/walk (revenue to EBITDA, valuation bridge). labels[], values[] (deltas; totals pass absolute values), totals?:[bool], up_color?, down_color?, total_color?",
  hbar_float: "Floating horizontal ranges (football field). series:[{label, min, max}], colors[]",
  scatter: "XY points. points:[{label, x, y, color}], x_fmt?, y_fmt?",
  quadrant: "2x2 positioning. axis_labels:{top,bottom,left,right}, brands:[{label, px, py, color}] (0-1 coordinates)",
  table: "Table. headers[], rows[][], size?, zebra?, bold_first_col?",
  stat_row: "Row of big KPI numbers. items:[{value, label, delta?, color?}] (2-5 items)",
  icon_row: "Numbered circles with title + text. items:[{glyph (1-2 chars, no emoji), title, text, color?}], direction:'row'|'col'",
  comparison_cards: "2-4 tinted cards with bullets. cards:[{title, bullets[], color?}]",
  timeline: "Numbered milestones. steps:[{label, text?}]",
  alt_timeline: "History axis with entries alternating above/below. entries:[{label, text}] (5-8)",
  org_chart: "Entity structure. levels:[[{label, sub?, note?, parent?, pct?}]]",
  process_flow: "Arrowed process boxes. steps:[{title, text?}] (3-6)",
  pill_row: "Rounded callouts with **bold** figures. items:[{text}] (3-5)",
};

// ── Fill schema (structured output) ──────────────────────────────────────────
const str = { type: "string" };
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const SLIDE_FILL = obj({
  plan_index: { type: "integer" },
  template_slide: { type: "integer" },
  texts: { type: "array", items: obj({ id: str, text: str }) },
  charts: {
    type: "array",
    items: obj({
      id: str,
      categories: { type: "array", items: str },
      number_format: str,
      series: {
        type: "array",
        items: obj({
          name: str,
          values: { type: "array", items: { anyOf: [{ type: "number" }, { type: "null" }] } },
          points: { type: "array", items: { type: "array", items: { type: "number" } } },
          point_colors: { type: "array", items: obj({ index: { type: "integer" }, color: str }) },
        }),
      },
    }),
  },
  tables: { type: "array", items: obj({ id: str, rows: { type: "array", items: { type: "array", items: str } } }) },
  remove: { type: "array", items: str },
  keep: { type: "array", items: str },
  elements: { type: "array", items: obj({ replace: str, box: { type: "array", items: { type: "number" } }, type: str, spec_json: str }) },
});
export const FILL_SCHEMA = obj({ slides: { type: "array", items: SLIDE_FILL } });
export const SHORTEN_SCHEMA = obj({ texts: { type: "array", items: obj({ slide: { type: "integer" }, id: str, text: str }) } });

export type SlideFill = {
  plan_index: number; template_slide: number;
  texts: { id: string; text: string }[];
  charts: { id: string; categories: string[]; number_format: string; series: { name: string; values: (number | null)[]; points: number[][]; point_colors: { index: number; color: string }[] }[] }[];
  tables: { id: string; rows: string[][] }[];
  remove: string[]; keep: string[];
  elements: { replace: string; box: number[]; type: string; spec_json: string }[];
};

export interface PlanSlide {
  index: number; type: string; title?: string; subtitle?: string; section?: string;
  takeaway?: string; chart?: string; template_slide?: number;
}

export function buildSystemPrompt(profile: TemplateProfile, companyData: string, peersData: string, deck: string): string {
  const slides = usableSlides(profile)
    .map(g => catalogSlideText(profile.catalog.slides[g.index - 1], g, true))
    .join("\n\n");
  const palette = Object.values(profile.catalog.palette ?? {}).filter(Boolean).join(", ");
  return `You are a senior investment banking analyst at PANDO, a private equity firm, building a client-ready deck by reusing the slides of the firm's PowerPoint template. Every output slide is an exact copy of one template slide; its design never changes. Your job is the content: you rewrite its text, replace chart and table data, remove what you don't need, and only when the template has no fitting chart, draw a new one in the space of a shape you replace.

${deck}

TEMPLATE STYLE: ${profile.guide.deck_style}
TEMPLATE PALETTE (hex, use these for any colors you set): ${palette}
BODY FONT: ${profile.catalog.body_font}

HOW TO FILL A SLIDE
- Shapes are addressed by id (#N). Their role tells you what to do:
  [fill] rewrite the text; [chart] replace the data; [table] replace the cells; [annotation] overlays tied to the template's chart data (remove them unless you rewrite them to match your data and they still sit in the right place); [picture_specific] images of the template's company (they are removed unless you list them in "keep", which you should almost never do); [picture_generic] icons that stay.
- Every [fill], [chart] and [table] shape must either get new content or be listed in "remove". Anything left untouched is removed automatically, which leaves holes in the design, so fill them.
- Never leave any name, brand, figure or fact of the template's original company. All content must come from the company data and source files.
- Text budget: each text shape shows "budget N line(s) x ~C chars". Stay within about 90% of N x C characters, and respect lines: a 1-line title must fit on one line. Text that runs over is shrunk, which looks worse than concise copy.
- Mirror the template's text structure. If a shape has a bold first paragraph (e.g. a year) followed by a description, write "2019\\nDescription". Separate paragraphs with \\n. Use **double asterisks** for the bold key phrases, the way the template bolds them in body copy.
- Charts: keep each chart for the same kind of data it was designed for. Provide categories and one entry per series (same series count as the template unless your data truly needs a different count). Percentages go as fractions (0.42) when the axis or label format is a percent. Use "points" only for XY scatter charts ([[x,y],...]); otherwise leave it []. Use point_colors to emphasize the subject company's own bar (e.g. darker template color) and grey for peers, mirroring how the template colors its points; leave it [] to keep the template's point colors. number_format: an Excel format like "0%", "#,##0", "0.0x" or "" to keep the template's.
- Tables: "rows" includes the header row; keep the template's column count unless the data needs otherwise; each cell short enough for its column.
- Element replacement (only when no template chart fits the data): {"replace": "<shape id>", "box": [], "type": "<element>", "spec_json": "<JSON of the element's props>"}, or "replace": "" with "box": [x, y, w, h] in inches for an empty area. Use template palette hex colors. Available elements:
${Object.entries(ELEMENT_TYPES).map(([k, v]) => `  - ${k}: ${v}`).join("\n")}
- Sources and footnotes: fill the footnote shape with "Source: ..." naming the actual source (company files, financial statements, survey...).
- Never use em-dashes. Format money as "USD $200 m", "USD $850 k", "USD $1.2 bn" (use "MXN $" for pesos).
- Write in the language of the deck plan.

COMPANY DATA:
${companyData}

PEER COMPARABLES:
${peersData}

TEMPLATE SLIDES YOU CAN USE (shapes with role "keep" are omitted):
${slides}`;
}


export function emptyFill(planIndex: number, templateSlide: number): SlideFill {
  return { plan_index: planIndex, template_slide: templateSlide, texts: [], charts: [], tables: [], remove: [], keep: [], elements: [] };
}

/** Convert a structured fill into pptx-service's clone plan, enforcing the template guide's roles. */
export function toClonePlan(f: SlideFill, guide: GuideSlide | undefined) {
  const texts: Record<string, string> = {};
  for (const t of f.texts) texts[String(t.id)] = t.text;
  const charts: Record<string, unknown> = {};
  for (const c of f.charts) {
    charts[String(c.id)] = {
      categories: c.categories,
      number_format: c.number_format || undefined,
      series: c.series.map(s => ({
        name: s.name,
        values: s.values,
        ...(s.points.length ? { points: s.points } : {}),
        ...(s.point_colors.length ? { point_colors: Object.fromEntries(s.point_colors.map(p => [String(p.index), p.color.replace("#", "")])) } : {}),
      })),
    };
  }
  const tables: Record<string, unknown> = {};
  for (const t of f.tables) tables[String(t.id)] = { rows: t.rows };

  const elements: Record<string, unknown>[] = [];
  for (const e of f.elements) {
    let spec: Record<string, unknown> = {};
    try { spec = JSON.parse(e.spec_json || "{}"); } catch { continue; }
    elements.push({ ...spec, type: e.type, ...(e.replace ? { replace: e.replace } : { box: e.box }) });
  }

  const remove = new Set(f.remove.map(String));
  const keep = new Set(f.keep.map(String));
  const replaced = new Set(f.elements.map(e => e.replace).filter(Boolean));
  // Content the model didn't address would otherwise show the template's own company.
  for (const s of guide?.shapes ?? []) {
    const id = String(s.id);
    if (keep.has(id) || replaced.has(id)) continue;
    const untouched = !(id in texts) && !(id in charts) && !(id in tables);
    if ((s.role === "fill" || s.role === "chart" || s.role === "table") && untouched) remove.add(id);
    if (s.role === "picture_specific") remove.add(id);
    if (s.role === "annotation" && !(id in texts)) remove.add(id);
  }
  for (const id of Object.keys(texts)) remove.delete(id);
  return { template_slide: f.template_slide, texts, charts, tables, remove: [...remove], elements };
}
