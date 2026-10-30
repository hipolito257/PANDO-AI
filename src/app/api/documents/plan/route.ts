import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { companies, compSets, publicComps, userSettings, financialSnapshots, documentTemplates } from "@/lib/schema";
import { eq, inArray, desc } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { companyFileBlocks, companyFilesInstruction, parseCompanyFileIds } from "@/lib/companyContext";
import { jsonrepair } from "jsonrepair";
import { extractPlainText } from "@/lib/extractDocumentText";
import { stripEmDashes, fmtMoneyDoc } from "@/lib/utils";
import { getTemplateProfile, guideSummary } from "@/lib/pptxTemplates";

// Thinking draws from the same budget as the answer, so a long plan needs
// longer to produce than the old 120s allowed.
export const maxDuration = 300;

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}
function fmt(n: unknown): string {
  if (n == null) return "N/D";
  const v = Number(n);
  return isNaN(v) ? "N/D" : fmtMoneyDoc(v);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const formData = await req.formData();
    const companyId  = formData.get("companyId")  as string | null;
    const templateId = formData.get("templateId") as string | null;
    const userPrompt = (formData.get("userPrompt") as string | null)?.trim() || null;
    const feedback   = (formData.get("feedback")   as string | null)?.trim() || null;
    const blobUrlsRaw = (formData.get("blobUrls") as string | null) || null;
    const blobUrls: { name: string; url: string; type: string }[] = blobUrlsRaw ? JSON.parse(blobUrlsRaw) : [];

    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, session.user.id)).limit(1);
    const apiKey = settings?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "API key not configured" }, { status: 400 });

    // The deck reuses the slides of this template; the first plan for a new
    // template file also analyses it (about a minute), later ones use the cache.
    if (!templateId) return NextResponse.json({ error: "Choose a PowerPoint template first" }, { status: 400 });
    const [template] = await db.select().from(documentTemplates).where(eq(documentTemplates.id, templateId)).limit(1);
    if (!template || template.type !== "pptx") return NextResponse.json({ error: "PowerPoint template not found" }, { status: 404 });
    const profile = await getTemplateProfile(template, apiKey);

    // Load company + peers
    let companyCard = "No company was selected.";
    let peersCard   = "No peers configured.";
    let companyName = "The Company";

    if (companyId) {
      const [co] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
      if (co) {
        companyName = co.name;
        const [snap] = await db.select().from(financialSnapshots).where(eq(financialSnapshots.companyId, companyId)).orderBy(desc(financialSnapshots.year)).limit(1);
        companyCard = `
Company: ${co.name} | Sector: ${co.sector ?? "N/D"} | Country: ${co.country ?? "N/D"} | Stage: ${co.stage ?? "N/D"}
Revenue: ${fmt(co.revenueUsd ?? snap?.revenueUsd)} | Growth: ${co.revenueGrowth != null ? `${co.revenueGrowth.toFixed(0)}%` : "N/D"} YoY
EBITDA: ${fmt(co.ebitdaUsd ?? snap?.ebitdaUsd)} | Margin: ${co.ebitdaMargin != null ? `${co.ebitdaMargin.toFixed(0)}%` : "N/D"}
Employees: ${co.employees ?? "N/D"} | Funding: ${fmt(co.totalFunding)} | Description: ${co.description ?? "N/D"}`.trim();

        const [cs] = await db.select().from(compSets).where(eq(compSets.companyId, companyId)).limit(1);
        if (cs?.tickers) {
          let tickers: string[] = [];
          try { tickers = JSON.parse(cs.tickers); } catch { /* ignore */ }
          if (tickers.length) {
            const peers = await db.select().from(publicComps).where(inArray(publicComps.ticker, tickers));
            const evRev = peers.map(p => p.evRevenue).filter((n): n is number => n != null);
            const evEbt = peers.map(p => p.evEbitda).filter((n): n is number => n != null);
            peersCard = `Peers: ${peers.map(p => p.ticker).join(", ")} | EV/Rev median: ${median(evRev)?.toFixed(1) ?? "N/D"}x | EV/EBITDA median: ${median(evEbt)?.toFixed(1) ?? "N/D"}x`;
          }
        }
      }
    }

    const today = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

    // Download blob files and build multimodal content parts
    const msgContent: Anthropic.MessageParam["content"] = [];
    // Files uploaded to the company profile go first so their cached prefix
    // survives plan revisions.
    const companyFilesCtx = await companyFileBlocks(companyId, parseCompanyFileIds(formData.get("companyFileIds")));
    msgContent.push(...companyFilesCtx.blocks);
    for (const bf of blobUrls.slice(0, 5)) {
      try {
        const r = await fetch(bf.url);
        const buf = Buffer.from(await r.arrayBuffer());
        const mime = bf.type || "application/octet-stream";
        const ext = bf.name.split(".").pop()?.toLowerCase();
        if (mime === "application/pdf") {
          msgContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } } as never);
        } else if (mime.startsWith("image/")) {
          msgContent.push({ type: "image", source: { type: "base64", media_type: mime as "image/png", data: buf.toString("base64") } });
        } else if (ext === "docx" || ext === "pptx" || ext === "xlsx") {
          const text = await extractPlainText(buf, ext);
          if (text) msgContent.push({ type: "text", text: `--- CONTENT OF ATTACHED FILE "${bf.name}" ---\n${text}\n--- END OF "${bf.name}" ---` });
        }
      } catch { /* skip unreadable files */ }
    }

    const userText = [
      userPrompt ? `USER INSTRUCTIONS:\n${userPrompt}` : null,
      companyFilesInstruction(companyFilesCtx.names),
      blobUrls.length
        ? `ATTACHED SUPPORTING FILES: ${blobUrls.map(b => b.name).join(", ")} — their actual content is included above as document/image/text blocks. These are the primary, authoritative source for company facts, numbers, and narrative. Base the plan on THEM, not on any prior knowledge or assumption about the company name. If a file's content could not be extracted, say so rather than inventing facts.`
        : null,
      feedback   ? `FEEDBACK ON THE PREVIOUS PLAN:\n${feedback}` : null,
      "Generate the presentation plan. Reply with the JSON object only — no preamble or commentary, even to reference the attached document.",
    ].filter(Boolean).join("\n\n");

    msgContent.push({ type: "text", text: userText });

    const claude = new Anthropic({ apiKey });
    const resp = await claude.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 16000,
      system: `You are a senior analyst at PANDO, a private equity fund. Your task is to plan an investment presentation (NOT build it yet — just the plan).

COMPANY DATA:
${companyCard}

PEERS:
${peersCard}

DATE: ${today}

INSTRUCTIONS:
- Decide the full structure of the presentation based on the available data.
- The presentation ALWAYS starts with a cover slide and ends with a back cover.
- Between cover and back cover: sections (divider) and data slides.
- Be specific: for each slide, indicate the title, the key message (takeaway), and what type of chart or table you would use.
- Use real data. If you don't have a data point, pick a different angle.
- Typical: 10-16 total slides including cover, back cover, and dividers.
- IB-QUALITY DISCIPLINE (this is what separates a banker-grade deck from a generic one):
  - Frame data comparatively, not in isolation, wherever the data supports it: vs. peers, vs. plan/budget, pre vs. post, perception vs. reality. A single bare metric ("Revenue: USD $50 m") is weaker than the same metric next to what it should be compared against.
  - Every chart needs its "so what" spelled out in the takeaway — a reader skimming only titles and takeaways (never the charts) should still get the thesis.
  - Reference-quality slides are DENSE, not sparse: choose template slides whose every chart, table and text block you can fill with real data, rather than a rich layout you can only half fill.

THE DECK IS BUILT FROM THIS TEMPLATE. Every slide of the new deck is a copy of one template slide (same design, new content), so plan around what the template offers.
Template style: ${profile.guide.deck_style}
Template slides available:
${guideSummary(profile)}

- For every slide set "template_slide" to the number of the template slide to copy. Cover, dividers and back cover use the template's cover / divider / back_cover slides.
- Pick the template slide whose structure matches the content: a history goes on the timeline slide, a mix comparison on the doughnut slide, a structure on the corporate-structure slide. The same template slide can be used several times.
- Respect each template slide's capacity (e.g. a slide made for 3 doughnuts or 11 milestones). If the data doesn't fit any template slide well, choose the closest one and say in "chart" what should replace its chart.
- In "chart", describe the concrete content and visuals of the slide in one line (which data goes in which chart or table).
- If the template has no divider slide, don't plan dividers.

NEVER use em-dashes (—) anywhere in any field — not in deck_title, titles, takeaways, or section names. Use a comma, colon, or period instead.

Format every money figure exactly like this: "USD $200 m" (millions), "USD $850 k" (thousands), "USD $1.2 bn" (billions) — currency code, then symbol+number, then a space and lowercase suffix (k/m/bn). Use "MXN $" or "EUR €" instead of "USD $" when the figure is explicitly in pesos or euros. Never write "$200M", "200 million dollars", or similar.

RESPONSE FORMAT (template_slide numbers below are illustrative; use the template slide list above) — your entire reply must be ONLY this JSON object and nothing else: no preamble, no summary of the attached document, no analysis, no markdown code fences. The first character of your reply must be "{".
{
  "deck_title": "Company Name, Investment Overview",
  "deck_subtitle": "Private & Confidential | ${today}",
  "company": "${companyName}",
  "slides": [
    { "index": 0, "type": "cover", "template_slide": 1, "title": "Company Name", "subtitle": "Investment Opportunity | ${today}" },
    { "index": 1, "type": "divider", "template_slide": 13, "section": "THE COMPANY" },
    { "index": 2, "type": "slide", "template_slide": 2, "section": "THE COMPANY", "title": "COMPANY HISTORY", "takeaway": "Specific key message with real data", "chart": "Timeline: 9 milestones 2015-2025 from the deck" },
    { "index": 3, "type": "slide", "template_slide": 7, "section": "THE COMPANY", "title": "CUSTOMER SATISFACTION", "takeaway": "...", "chart": "Left chart: satisfaction by attribute vs market; right chart: NPS vs 4 peers" },
    { "index": 4, "type": "back_cover", "template_slide": 15 }
  ]
}`,
      messages: [{ role: "user", content: msgContent }],
    });

    const raw = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("");

    // Extract JSON — strip markdown fences if present
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = fenced ? fenced[1] : (raw.match(/\{[\s\S]*\}/) ?? [null])[0];
    if (!jsonStr) {
      console.error("[plan] Claude returned no JSON. stop_reason:", resp.stop_reason, "raw:", raw.slice(0, 2000));
      return NextResponse.json({
        error: resp.stop_reason === "max_tokens"
          ? "Claude's response was cut off before producing the plan (too much input to digest in one reply). Try again, or split large attachments."
          : "Claude did not return a valid plan",
        raw: raw.slice(0, 500),
      }, { status: 500 });
    }

    // Repair common Claude JSON issues using jsonrepair
    const pre = jsonStr
      .replace(/\bNone\b/g, "null")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false");
    const repaired = jsonrepair(pre);

    let plan: unknown;
    try {
      plan = JSON.parse(repaired);
    } catch (parseErr) {
      return NextResponse.json({
        error: `Format error in plan: ${(parseErr as Error).message}`,
        raw: jsonStr.slice(0, 400),
      }, { status: 500 });
    }
    return NextResponse.json({ success: true, plan: stripEmDashes(plan) });

  } catch (err) {
    console.error("[plan]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
