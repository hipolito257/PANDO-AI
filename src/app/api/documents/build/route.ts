import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentTemplates, companies, compSets, publicComps, userSettings, financialSnapshots } from "@/lib/schema";
import { eq, inArray, desc } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { companyFileBlocks, companyFilesInstruction, parseCompanyFileIds } from "@/lib/companyContext";
import { extractPlainText } from "@/lib/extractDocumentText";
import { stripEmDashes, fmtMoneyDoc } from "@/lib/utils";
import { DECK_MODEL, getTemplateProfile, usableSlides, buildClonedDeck, type GuideSlide } from "@/lib/pptxTemplates";
import {
  buildSystemPrompt, toClonePlan, emptyFill, FILL_SCHEMA, SHORTEN_SCHEMA, type SlideFill, type PlanSlide,
} from "@/lib/pptxDeckFill";

export const maxDuration = 300;

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
  return isNaN(v) ? "N/D" : fmtMoneyDoc(v);
}

// ── Route handler (streaming SSE) ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
  }

  const formData = await req.formData();
  const templateId    = formData.get("templateId")    as string;
  const companyId     = formData.get("companyId")     as string | null;
  const userPrompt    = (formData.get("userPrompt")   as string) || "";
  const approvedPlanRaw = (formData.get("approvedPlan") as string | null) || null;
  const blobUrlsRaw   = (formData.get("blobUrls")     as string | null) || null;
  const blobUrls: { name: string; url: string; type: string }[] = blobUrlsRaw ? JSON.parse(blobUrlsRaw) : [];

  const encoder = new TextEncoder();
  let cancelled = false;
  req.signal.addEventListener("abort", () => { cancelled = true; });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); }
        catch { /* controller already closed */ }
      };
      const fail = (message: string) => { send({ type: "error", message }); controller.close(); };

      try {
        send({ type: "progress", message: "Loading data…", current: 0, total: 0 });

        if (!templateId) return fail("templateId required");
        const [template] = await db.select().from(documentTemplates).where(eq(documentTemplates.id, templateId)).limit(1);
        if (!template) return fail("Template not found");
        if (template.type !== "pptx") return fail("PPTX templates only");
        if (!approvedPlanRaw) return fail("An approved plan is required. Use the plan presentation button first.");
        let approvedPlan: { company?: string; deck_title?: string; deck_subtitle?: string; slides: PlanSlide[] };
        try { approvedPlan = JSON.parse(approvedPlanRaw); } catch { return fail("Approved plan has invalid format."); }

        const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, session.user.id)).limit(1);
        const apiKey = settings?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return fail("Configure your Anthropic API key in Settings.");

        const profile = await getTemplateProfile(template, apiKey, message => send({ type: "progress", message, current: 0, total: 0 }));
        const guideByIndex = new Map(profile.guide.slides.map(g => [g.index, g]));

        // ── Company + peers ──────────────────────────────────────────────────
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

            const [compSet] = await db.select().from(compSets).where(eq(compSets.companyId, companyId)).limit(1);
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

        // ── Source material ──────────────────────────────────────────────────
        const contextParts: Anthropic.ContentBlockParam[] = [];
        const companyFilesCtx = await companyFileBlocks(companyId, parseCompanyFileIds(formData.get("companyFileIds")));
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

        // ── Map plan slides to template slides ──────────────────────────────
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
              if (attempt >= 2 || cancelled || !(e instanceof Anthropic.APIError)) throw e;
              await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
            }
          }
        }

        // ── Generate ─────────────────────────────────────────────────────────
        const totalSteps = sections.length + 2;
        let done = 0;
        const tick = (message: string) => send({ type: "progress", message, current: ++done, total: totalSteps });
        send({ type: "progress", message: `Writing ${kept.length} slides in ${sections.length} section(s)…`, current: 0, total: totalSteps });

        let fills: SlideFill[];
        try {
          const results = await Promise.all([
            edges.length ? fillSlides(edges, false).then(r => { tick("Cover ready…"); return r; }) : Promise.resolve([] as SlideFill[]),
            ...sections.map(g => fillSlides(g, true).then(r => { tick(`${done}/${sections.length} sections ready…`); return r; })),
          ]);
          fills = results.flat();
        } catch (e) {
          if (cancelled) { send({ type: "cancelled" }); controller.close(); return; }
          return fail(e instanceof Error ? e.message : "Error generating slides");
        }
        if (cancelled) { send({ type: "cancelled" }); controller.close(); return; }

        // ── Assemble the clone plan in deck order ───────────────────────────
        const byPlan = new Map(fills.map(f => [f.plan_index, f]));
        const ordered: { plan: PlanSlide; fill: SlideFill }[] = [];
        for (const s of kept) {
          const f = byPlan.get(s.index);
          const tpl = f?.template_slide && guideByIndex.get(f.template_slide)?.use !== "skip" ? f.template_slide : s.template_slide;
          if (!tpl || !profile.catalog.slides[tpl - 1]) continue;
          ordered.push({ plan: s, fill: f ? { ...f, template_slide: tpl } : emptyFill(s.index, tpl) });
        }
        if (!ordered.length) return fail("The model did not return any slides.");

        let clonePlan = { slides: ordered.map(o => toClonePlan(o.fill, guideByIndex.get(o.fill.template_slide))) };
        clonePlan = stripEmDashes(clonePlan) as typeof clonePlan;

        send({ type: "progress", message: `Building presentation (${ordered.length} slides)…`, current: done, total: totalSteps });
        let built = await buildClonedDeck(template.filePath, clonePlan, profile);

        // ── One repair pass for text that still doesn't fit ──────────────────
        const overflows = built.warnings.filter(w => w.kind === "overflow");
        if (overflows.length && !cancelled) {
          send({ type: "progress", message: `Tightening ${overflows.length} text box(es) that ran long…`, current: done, total: totalSteps });
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
            console.error("[build] overflow repair failed", e);
          }
        }

        const filename = `${companyName.replace(/[^a-zA-Z0-9_-]/g, "_")}_${new Date().toISOString().slice(0, 10)}.pptx`;
        const base64 = built.data;
        const CHUNK = 500_000;
        const totalChunks = Math.ceil(base64.length / CHUNK);
        for (let i = 0; i < totalChunks; i++) {
          send({ type: "chunk", index: i, total: totalChunks, data: base64.slice(i * CHUNK, (i + 1) * CHUNK) });
        }
        const qa = built.warnings
          .filter(w => w.kind !== "missing")
          .map(w => `Slide ${w.slide}${w.shape ? `, box #${w.shape}` : ""}: ${w.message}`);
        if (qa.length) send({ type: "qa_warnings", warnings: qa });
        send({ type: "done", filename, slide_count: ordered.length });
        controller.close();
      } catch (err) {
        try { fail(err instanceof Error ? err.message : "Unexpected error"); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
  });
}
