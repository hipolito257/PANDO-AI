// Template-cloning deck generation: a PowerPoint template is described once
// (catalog from pptx-service + a guide written by Claude, cached on the
// DocumentTemplate row), then every generated deck copies its slides and only
// replaces their content. See pptx-service/builders/clone_builder.py.
import Anthropic from "@anthropic-ai/sdk";
import { db, documentTemplates } from "@/lib/db";
import { eq } from "drizzle-orm";

export const PROFILE_VERSION = 1;
export const DECK_MODEL = "claude-sonnet-5-5";

// ── pptx-service ─────────────────────────────────────────────────────────────
// pptx-service is its own Vercel project; PPTX_SERVICE_URL points at it and
// PPTX_SERVICE_TOKEN is the shared secret it checks. Local dev falls back to
// 127.0.0.1:5053, where no token is set and the check is skipped.
export function pptxServiceUrl(path: string): string {
  return `${process.env.PPTX_SERVICE_URL ?? "http://127.0.0.1:5053"}${path}`;
}
export function pptxHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.PPTX_SERVICE_TOKEN) h["X-Service-Token"] = process.env.PPTX_SERVICE_TOKEN;
  return h;
}

async function callService<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(pptxServiceUrl(path), { method: "POST", headers: pptxHeaders(), body: JSON.stringify(body) });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error(`PPTX service returned an invalid response (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  if (!res.ok) throw new Error(`PPTX service error (HTTP ${res.status}): ${(json as { detail?: string }).detail ?? text.slice(0, 200)}`);
  return json as T;
}

// ── Types ────────────────────────────────────────────────────────────────────
export type CatalogShape = {
  id: number; kind: string; name: string; box: [number, number, number, number];
  group?: number; placeholder?: string; field?: string;
  text?: string; font?: { size: number; bold: boolean; caps: boolean; face: string | null };
  paragraphs?: { text: string; level: number; size: number; bold: boolean }[];
  max_lines?: number; chars_per_line?: number; vertical?: boolean;
  chart?: {
    type: string; categories?: string[]; legend?: boolean; label_format?: string; axis_format?: string; title?: string | null;
    series?: { name: string; values: (number | null)[]; color?: string; point_colors?: Record<string, string> }[];
  };
  table?: { rows: number; cols: number; cells: string[][]; merged: boolean; font_size: number | null };
  picture?: { media?: string; format?: string; alt?: string };
};
export type CatalogSlide = { index: number; layout: string; hidden: boolean; shapes: CatalogShape[] };
export type Catalog = {
  slide_width_in: number; slide_height_in: number; body_font: string | null;
  theme_fonts: { major: string | null; minor: string | null };
  colors: Record<string, string>; palette: Record<string, string>;
  slides: CatalogSlide[]; media?: Record<string, string>;
};

export const SHAPE_ROLES = ["fill", "chart", "table", "annotation", "picture_specific", "picture_generic", "keep"] as const;
export type ShapeRole = (typeof SHAPE_ROLES)[number];
export type GuideSlide = {
  index: number; use: "cover" | "divider" | "content" | "back_cover" | "skip";
  name: string; best_for: string; fill_notes: string;
  shapes: { id: string; role: ShapeRole; label: string }[];
};
export type TemplateGuide = { deck_style: string; slides: GuideSlide[] };
export type TemplateProfile = { version: number; filePath: string; catalog: Catalog; guide: TemplateGuide; createdAt: string };

// ── Compact text descriptions ────────────────────────────────────────────────
const fmtBox = (b: number[]) => `@(${b[0]},${b[1]} ${b[2]}x${b[3]}in)`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\n/g, " / ");

export function describeShape(sh: CatalogShape, role?: string, label?: string): string {
  const head = `#${sh.id}${role ? ` [${role}${label ? `: ${label}` : ""}]` : ""} ${sh.kind}${sh.placeholder ? `(${sh.placeholder})` : ""} ${fmtBox(sh.box)}`;
  if (sh.chart) {
    const c = sh.chart;
    const series = (c.series ?? []).map(s => {
      const pc = s.point_colors && Object.keys(s.point_colors).length ? ` points ${JSON.stringify(s.point_colors)}` : "";
      return `"${s.name}"${s.color ? ` #${s.color}` : ""}${pc} = [${s.values.slice(0, 12).join(", ")}]`;
    }).join("; ");
    return `${head} ${c.type} chart, ${c.categories?.length ?? 0} categories [${(c.categories ?? []).slice(0, 12).map(x => clip(x, 20)).join(" | ")}], series: ${series}${c.axis_format ? `, axis format "${c.axis_format}"` : ""}${c.label_format && c.label_format !== "General" ? `, label format "${c.label_format}"` : ""}${c.legend ? ", legend" : ""}`;
  }
  if (sh.table) {
    const t = sh.table;
    return `${head} table ${t.rows}x${t.cols}${t.merged ? " (merged cells)" : ""}${t.font_size ? ` ${t.font_size}pt` : ""}: ${t.cells.slice(0, 6).map(r => `[${r.map(c => clip(c, 24)).join(" | ")}]`).join(" ")}`;
  }
  if (sh.picture) {
    return `${head}${sh.picture.media ? ` media:${sh.picture.media}` : ""}${sh.picture.alt ? ` alt:"${clip(sh.picture.alt, 60)}"` : ""}`;
  }
  if (sh.text !== undefined) {
    const f = sh.font;
    const budget = sh.max_lines ? ` budget ${sh.max_lines} line(s) x ~${sh.chars_per_line} chars` : "";
    const style = f ? ` ${f.size}pt${f.bold ? " bold" : ""}${f.caps ? " CAPS" : ""}` : "";
    const paras = sh.paragraphs && sh.paragraphs.length > 1
      ? ` paragraphs: ${sh.paragraphs.slice(0, 6).map(p => `{${p.level ? `L${p.level} ` : ""}${p.size}pt${p.bold ? " b" : ""} "${clip(p.text, 40)}"}`).join(" ")}`
      : ` now: "${clip(sh.text, 140)}"`;
    return `${head}${style}${budget}${sh.field ? ` auto-field:${sh.field}` : ""}${sh.vertical ? " vertical" : ""}${paras}`;
  }
  return head;
}

export function catalogSlideText(slide: CatalogSlide, guide?: GuideSlide, onlyRoles = false): string {
  const roles = new Map((guide?.shapes ?? []).map(s => [String(s.id), s]));
  const lines = slide.shapes
    .filter(sh => !onlyRoles || (roles.get(String(sh.id))?.role ?? "keep") !== "keep")
    .map(sh => {
      const g = roles.get(String(sh.id));
      return `  ${describeShape(sh, g?.role, g?.label)}`;
    });
  const head = guide
    ? `TEMPLATE SLIDE ${slide.index} [${guide.use}] "${guide.name}". Best for: ${guide.best_for}${guide.fill_notes ? ` Notes: ${guide.fill_notes}` : ""}`
    : `TEMPLATE SLIDE ${slide.index} (layout "${slide.layout}"${slide.hidden ? ", hidden" : ""})`;
  return [head, ...lines].join("\n");
}

/** One line per usable slide, for planning. */
export function guideSummary(profile: TemplateProfile): string {
  return profile.guide.slides
    .filter(s => s.use !== "skip")
    .map(s => `- Slide ${s.index} [${s.use}] "${s.name}": ${s.best_for}`)
    .join("\n");
}

// ── Profiling (once per template file) ───────────────────────────────────────
const GUIDE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["deck_style", "slides"],
  properties: {
    deck_style: { type: "string" },
    slides: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["index", "use", "name", "best_for", "fill_notes", "shapes"],
        properties: {
          index: { type: "integer" },
          use: { type: "string", enum: ["cover", "divider", "content", "back_cover", "skip"] },
          name: { type: "string" },
          best_for: { type: "string" },
          fill_notes: { type: "string" },
          shapes: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["id", "role", "label"],
              properties: { id: { type: "string" }, role: { type: "string", enum: [...SHAPE_ROLES] }, label: { type: "string" } },
            },
          },
        },
      },
    },
  },
};

const PROFILE_SYSTEM = `You are preparing a PowerPoint template so its slides can be reused as layouts for new investment decks about OTHER companies. Each new deck copies template slides and replaces their content; the design must stay identical.

You get a catalog of every template slide: each shape's id, kind, position in inches, text with its font and line budget, native charts with their data, tables, and pictures (with small thumbnails shown separately, keyed by media id).

For every slide decide:
- use: "cover" (title slide), "divider" (section separator), "content", "back_cover" (closing slide), or "skip" (drafts, working notes, empty or broken slides; anything you would not show a client).
- name: a short descriptive name ("Company history timeline", "Two bar charts with takeaway").
- best_for: what kinds of content this slide layout suits, written generically (not about the template's company).
- fill_notes: how to fill it well: how many items it holds, which shapes belong together (e.g. "11 milestones: year + description boxes #25-#36, alternating above/below the axis"), constraints.

For every shape on a usable slide assign a role (you may omit shapes whose role is "keep"):
- fill: text that must be rewritten for every new deck (titles, section labels, body copy, chart titles and subtitles, labels naming the template company's brands, products, figures, footnotes and sources).
- chart: a native chart whose data must be replaced.
- table: a table whose cells must be replaced.
- annotation: hand-placed overlays tied to a chart's specific data (delta labels like "+27pps", highlight boxes, arrows on particular bars). They are removed when the chart gets new data.
- picture_specific: images that belong to the template's company (its logo, product photos, brand marks, country flags of its markets, screenshots). Removed by default.
- picture_generic: images usable for any company (generic icons, decorative graphics, the deck owner's own logo).
- keep: static design (shapes, lines, generic labels like "Strictly confidential", slide numbers / auto fields).

The template's own firm (the deck author, e.g. the private equity firm whose logo appears on the cover) is NOT the subject company: its logo is picture_generic or keep.`;

export async function profileTemplate(catalog: Catalog, apiKey: string): Promise<TemplateGuide> {
  const client = new Anthropic({ apiKey });
  const content: Anthropic.ContentBlockParam[] = [{
    type: "text",
    text: `TEMPLATE: ${catalog.slides.length} slides, ${catalog.slide_width_in}x${catalog.slide_height_in}in, body font ${catalog.body_font}.\n\n${catalog.slides.map(s => catalogSlideText(s)).join("\n\n")}`,
  }];
  const media = Object.entries(catalog.media ?? {}).slice(0, 80);
  if (media.length) {
    content.push({ type: "text", text: "PICTURE THUMBNAILS (by media id):" });
    for (const [key, b64] of media) {
      content.push({ type: "text", text: `media:${key}` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
    }
  }
  content.push({ type: "text", text: "Write the guide for every slide." });

  const stream = client.messages.stream({
    model: DECK_MODEL,
    max_tokens: 32000,
    system: PROFILE_SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: GUIDE_SCHEMA } },
    messages: [{ role: "user", content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("The model declined to analyse this template.");
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("");
  const guide = JSON.parse(text) as TemplateGuide;
  // Every catalog slide gets an entry (unlisted ones are skipped).
  const known = new Set(guide.slides.map(s => s.index));
  for (const s of catalog.slides) {
    if (!known.has(s.index)) guide.slides.push({ index: s.index, use: "skip", name: "", best_for: "", fill_notes: "", shapes: [] });
  }
  guide.slides.sort((a, b) => a.index - b.index);
  return guide;
}

type TemplateRow = typeof documentTemplates.$inferSelect;

/** The cached profile for a template, building it (≈1 min) when missing or stale. */
export async function getTemplateProfile(template: TemplateRow, apiKey: string, onProgress?: (msg: string) => void): Promise<TemplateProfile> {
  if (template.profile) {
    try {
      const p = JSON.parse(template.profile) as TemplateProfile;
      if (p.version === PROFILE_VERSION && p.filePath === template.filePath) return p;
    } catch { /* rebuild */ }
  }
  onProgress?.("Analyzing the template (first time only)…");
  const catalog = await callService<Catalog>("/catalog/template", { template_url: template.filePath, thumbnails: true });
  const guide = await profileTemplate(catalog, apiKey);
  const { media: _media, ...stored } = catalog; // eslint-disable-line @typescript-eslint/no-unused-vars
  const profile: TemplateProfile = { version: PROFILE_VERSION, filePath: template.filePath, catalog: stored, guide, createdAt: new Date().toISOString() };
  await db.update(documentTemplates).set({ profile: JSON.stringify(profile) }).where(eq(documentTemplates.id, template.id));
  return profile;
}

export function usableSlides(profile: TemplateProfile, use?: GuideSlide["use"]): GuideSlide[] {
  return profile.guide.slides.filter(s => s.use !== "skip" && (!use || s.use === use));
}

export async function buildClonedDeck(templateUrl: string, plan: unknown, profile: TemplateProfile): Promise<{
  data: string; slide_count: number; warnings: { slide: number; shape: string | null; kind: string; message: string; [k: string]: unknown }[];
}> {
  return callService("/build/clone", {
    template_url: templateUrl,
    plan,
    palette: profile.catalog.palette,
    font: profile.catalog.body_font,
  });
}
