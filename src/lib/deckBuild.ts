// Builds a presentation from an approved plan by cloning the chosen template's
// slides (see pptxTemplates.ts / pptxDeckFill.ts). Runs as a background job.
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { documentTemplates, companies, compSets, publicComps, userSettings, financialSnapshots } from "@/lib/schema";
import { eq, inArray, desc } from "drizzle-orm";
import { companyFileBlocks, companyFilesInstruction } from "@/lib/companyContext";
import { extractPlainText } from "@/lib/extractDocumentText";
import { stripEmDashes, fmtMoneyDoc } from "@/lib/utils";
import { DECK_MODEL, getTemplateProfile, usableSlides, buildClonedDeck, type GuideSlide } from "@/lib/pptxTemplates";
import { buildSystemPrompt, toClonePlan, emptyFill, FILL_SCHEMA, SHORTEN_SCHEMA, type SlideFill, type PlanSlide } from "@/lib/pptxDeckFill";
import { JobCancelled, type JobContext } from "@/lib/jobs";

export type DeckBuildInput = {
  templateId: string;
  companyId: string | null;
  userPrompt?: string;
  approvedPlan: { company?: string; deck_title?: string; deck_subtitle?: string; slides: PlanSlide[] };
  blobUrls?: { name: string; url: string; type: string }[];
  companyFileIds?: string[] | null;
};

export type DeckBuildResult = { pptx: Buffer; filename: string; slideCount: number; warnings: string[] };

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function fmtNum(n: unknown): string {
  if (n == null) return "N/D";
  const v = Number(n);
  return isNaN(v) ? "N/D" : fmtMoneyDoc(v);
}

export async function runDeckBuild(input: DeckBuildInput, ctx: JobContext): Promise<DeckBuildResult> {
  const { templateId, companyId, userPrompt = "", approvedPlan } = input;
  const blobUrls = input.blobUrls ?? [];
  const checkCancel = async () => { if (await ctx.isCancelled()) throw new JobCancelled(); };

  await ctx.progress("Loading data…", 2);
  if (!templateId) throw new Error("templateId required");
  const [template] = await db.select().from(documentTemplates).where(eq(documentTemplates.id, templateId)).limit(1);
  if (!template) throw new Error("Template not found");
  if (template.type !== "pptx") throw new Error("PPTX templates only");
  if (!approvedPlan?.slides?.length) throw new Error("An approved plan is required. Use the plan presentation button first.");

  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, ctx.userId)).limit(1);
  const apiKey = settings?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Configure your Anthropic API key in Settings.");

  const profile = await getTemplateProfile(template, apiKey, message => { void ctx.progress(message, 4); });
  const guideByIndex = new Map(profile.guide.slides.map(g => [g.index, g]));

  // ── Company + peers ──
  let companyData = "No company was selected.";
  let peersData = "No comparables available.";
  let companyName = "presentation";
  if (companyId) {
    const [co] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (co) {
      companyName = co.name;
      const snaps = await db.select().from(financialSnapshots).where(eq(financialSnapshots.companyId, companyId)).orderBy(desc(financialSnapshots.year));
      companyData = `
Company: ${co.name}
Sector: ${co.sector ?? "N/D"} | Subsector: ${co.subsector ?? "N/D"} | Country: ${co.country ?? "N/D"} | Stage: ${co.stage ?? "N/D"}
Revenue: ${fmtNum(co.revenueUsd)} (USD) | Revenue growth: ${co.revenueGrowth != null ? `${co.revenueGrowth}%` : "N/D"}
EBITDA: ${fmtNum(co.ebitdaUsd)} (USD) | EBITDA margin: ${co.ebitdaMargin != null ? `${co.ebitdaMargin}%` : "N/D"}
Employees: ${co.employees ?? "N/D"} | Total funding: ${fmtNum(co.totalFunding)}
Yearly financials (USD): ${snaps.filter(s => s.quarter === 0).map(s => `${s.year}: revenue ${fmtNum(s.revenueUsd)}, EBITDA ${fmtNum(s.ebitdaUsd)}`).join("; ") || "N/D"}
Description: ${co.description ?? ""}`.trim();

      const [compSet] = await db.select().from(compSets).where(eq(compSets.companyId, companyId)).orderBy(desc(compSets.createdAt)).limit(1);
      if (compSet?.tickers) {
        let tickers: string[] = [];
        try { tickers = JSON.parse(compSet.tickers); } catch { /* ignore */ }
        if (tickers.length) {
          const peers = await db.select().from(publicComps).where(inArray(publicComps.ticker, tickers));
          const evRev = peers.map(p => p.evRevenue).filter((n): n is number => n != null && n > 0);
          const evEbitda = peers.map(p => p.evEbitda).filter((n): n is number => n != null && n > 0);
          peersData = `Peer set (${peers.length}): ${peers.map(p => `${p.name} (${p.ticker})`).join(", ")}
EV/Revenue median: ${median(evRev)?.toFixed(1) ?? "N/D"}x | EV/EBITDA median: ${median(evEbitda)?.toFixed(1) ?? "N/D"}x`;
        }
      }
    }
  }

  // ── Source material ──
  await ctx.progress("Reading source documents…", 8);
  const contextParts: Anthropic.ContentBlockParam[] = [];
  const companyFilesCtx = await companyFileBlocks(companyId, input.companyFileIds ?? null);
  contextParts.push(...companyFilesCtx.blocks);
  for (const bf of blobUrls.slice(0, 5)) {
    try {
      const r = await fetch(bf.url);
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = bf.type || "application/octet-stream";
      const ext = bf.name.split(".").pop()?.toLowerCase();
      if (mime === "application/pdf") {
        contextParts.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } });
      } else if (mime.startsWith("image/")) {
        contextParts.push({ type: "image", source: { type: "base64", media_type: mime as "image/png", data: buf.toString("base64") } });
      } else if (ext === "docx" || ext === "pptx" || ext === "xlsx") {
        const text = await extractPlainText(buf, ext);
        if (text) contextParts.push({ type: "text", text: `--- CONTENT OF ATTACHED FILE "${bf.name}" ---\n${text}\n--- END OF "${bf.name}" ---` });
      }
    } catch { /* skip unreadable files */ }
  }
  const sourceNote = [
    companyFilesInstruction(companyFilesCtx.names),
    blobUrls.length ? `ATTACHED FILES: ${blobUrls.map(b => b.name).join(", ")}: primary source for facts and figures; use their real numbers.` : null,
  ].filter(Boolean).join("\n");

  // ── Map plan slides to template slides ──
  const today = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const deckTitle = approvedPlan.deck_title || companyName;
  const deckCompany = approvedPlan.company || companyName;
  const firstOf = (use: GuideSlide["use"]) => usableSlides(profile, use)[0]?.index;
  const validFor = (n: number | undefined, use: GuideSlide["use"]) => !!n && guideByIndex.get(n)?.use === use;

  const planSlides = (approvedPlan.slides ?? []).map((s, i) => ({ ...s, index: i }));
  for (const s of planSlides) {
    const use = s.type === "cover" ? "cover" : s.type === "back_cover" ? "back_cover" : s.type === "divider" ? "divider" : "content";
    if (!validFor(s.template_slide, use)) s.template_slide = use === "content" ? undefined : firstOf(use);
  }
  const kept = planSlides.filter(s => s.type === "slide" || s.template_slide);

  // Sections: each divider starts one; cover / back cover go in their own call.
  const edges = kept.filter(s => s.type === "cover" || s.type === "back_cover");
  const sections: PlanSlide[][] = [];
  for (const s of kept.filter(x => x.type !== "cover" && x.type !== "back_cover")) {
    if (s.type === "divider" || !sections.length) sections.push([]);
    sections[sections.length - 1].push(s);
  }

  const deckLine = `DECK: "${deckTitle}" | SUBJECT COMPANY: ${deckCompany} | DATE: ${today}${approvedPlan.deck_subtitle ? ` | SUBTITLE: ${approvedPlan.deck_subtitle}` : ""}`;
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: buildSystemPrompt(profile, companyData, peersData, deckLine), cache_control: { type: "ephemeral" } }];
  const claude = new Anthropic({ apiKey });

  const describePlan = (s: PlanSlide) => {
    const kind = s.type === "slide" ? "content slide" : s.type;
    return `plan_index ${s.index} (${kind}) → ${s.template_slide ? `template slide ${s.template_slide}` : "choose the best content template slide"}
  title: ${s.title ?? s.section ?? ""}${s.subtitle ? `\n  subtitle: ${s.subtitle}` : ""}${s.section && s.type === "divider" ? `\n  section: ${s.section}` : ""}${s.takeaway ? `\n  key message: ${s.takeaway}` : ""}${s.chart ? `\n  content / visuals: ${s.chart}` : ""}`;
  };

  async function fillSlides(group: PlanSlide[], withContext: boolean): Promise<SlideFill[]> {
    const instructions = [
      userPrompt ? `ADDITIONAL INSTRUCTIONS: ${userPrompt}` : null,
      withContext ? sourceNote : null,
      `Fill these ${group.length} slide(s), one output entry per plan_index, in order:`,
      group.map(describePlan).join("\n\n"),
    ].filter(Boolean).join("\n\n");
    const content: Anthropic.ContentBlockParam[] = [...(withContext ? contextParts : []), { type: "text", text: instructions }];
    for (let attempt = 0; ; attempt++) {
      try {
        const msg = await claude.messages.stream({
          model: DECK_MODEL,
          max_tokens: 32000,
          system,
          output_config: { effort: "medium", format: { type: "json_schema", schema: FILL_SCHEMA } },
          messages: [{ role: "user", content }],
        }).finalMessage();
        if (msg.stop_reason === "refusal") throw new Error("The model declined to write this section.");
        if (msg.stop_reason === "max_tokens") throw new Error("A section was too long to generate in one reply; split it into fewer slides.");
        const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("");
        return (JSON.parse(text) as { slides: SlideFill[] }).slides;
      } catch (e) {
        if (attempt >= 2 || !(e instanceof Anthropic.APIError) || await ctx.isCancelled()) throw e;
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }

  // ── Generate ──
  const totalSteps = sections.length + (edges.length ? 1 : 0);
  let done = 0;
  const tick = () => ctx.progress(`Writing slides: ${++done}/${totalSteps} parts ready…`, 10 + (70 * done) / Math.max(1, totalSteps));
  await ctx.progress(`Writing ${kept.length} slides in ${sections.length} section(s)…`, 10);
  await checkCancel();

  const results = await Promise.all([
    edges.length ? fillSlides(edges, false).then(async r => { await tick(); return r; }) : Promise.resolve([] as SlideFill[]),
    ...sections.map(g => fillSlides(g, true).then(async r => { await tick(); return r; })),
  ]);
  const fills = results.flat();
  await checkCancel();

  // ── Assemble the clone plan in deck order ──
  const byPlan = new Map(fills.map(f => [f.plan_index, f]));
  const ordered: { plan: PlanSlide; fill: SlideFill }[] = [];
  for (const s of kept) {
    const f = byPlan.get(s.index);
    const tpl = f?.template_slide && guideByIndex.get(f.template_slide)?.use !== "skip" ? f.template_slide : s.template_slide;
    if (!tpl || !profile.catalog.slides[tpl - 1]) continue;
    ordered.push({ plan: s, fill: f ? { ...f, template_slide: tpl } : emptyFill(s.index, tpl) });
  }
  if (!ordered.length) throw new Error("The model did not return any slides.");

  let clonePlan = { slides: ordered.map(o => toClonePlan(o.fill, guideByIndex.get(o.fill.template_slide))) };
  clonePlan = stripEmDashes(clonePlan) as typeof clonePlan;

  await ctx.progress(`Building presentation (${ordered.length} slides)…`, 82);
  let built = await buildClonedDeck(template.filePath, clonePlan, profile);

  // ── One repair pass for text that still doesn't fit ──
  const overflows = built.warnings.filter(w => w.kind === "overflow");
  if (overflows.length && !(await ctx.isCancelled())) {
    await ctx.progress(`Tightening ${overflows.length} text box(es) that ran long…`, 88);
    try {
      const items = overflows.map(w => {
        const slide = clonePlan.slides[w.slide - 1];
        const shape = profile.catalog.slides[slide.template_slide - 1]?.shapes.find(s => String(s.id) === w.shape);
        return `slide ${w.slide}, id ${w.shape}: budget ${shape?.max_lines ?? "?"} line(s) x ~${shape?.chars_per_line ?? "?"} chars. Current text: ${JSON.stringify(slide.texts[w.shape!] ?? "")}`;
      });
      const msg = await claude.messages.stream({
        model: DECK_MODEL,
        max_tokens: 8000,
        system,
        output_config: { effort: "low", format: { type: "json_schema", schema: SHORTEN_SCHEMA } },
        messages: [{ role: "user", content: `These texts overflow their boxes. Rewrite each one shorter so it fits its budget (aim for 85% of lines x chars), keeping the facts, the paragraph structure and the **bold** emphasis:\n\n${items.join("\n")}` }],
      }).finalMessage();
      const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("");
      const fixes = (JSON.parse(text) as { texts: { slide: number; id: string; text: string }[] }).texts;
      for (const f of fixes) {
        const slide = clonePlan.slides[f.slide - 1];
        if (slide && f.id in slide.texts) slide.texts[f.id] = stripEmDashes(f.text) as string;
      }
      built = await buildClonedDeck(template.filePath, clonePlan, profile);
    } catch (e) {
      console.error("[deckBuild] overflow repair failed", e);
    }
  }

  const warnings = built.warnings
    .filter(w => w.kind !== "missing")
    .map(w => `Slide ${w.slide}${w.shape ? `, box #${w.shape}` : ""}: ${w.message}`);
  return {
    pptx: Buffer.from(built.data, "base64"),
    filename: `${companyName.replace(/[^a-zA-Z0-9_-]/g, "_")}_${new Date().toISOString().slice(0, 10)}.pptx`,
    slideCount: ordered.length,
    warnings,
  };
}
