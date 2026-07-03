import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { companies, compSets, publicComps, userSettings, financialSnapshots } from "@/lib/schema";
import { eq, inArray, desc } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import { extractPlainText } from "@/lib/extractDocumentText";

export const maxDuration = 120;

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}
function fmt(n: unknown, suffix = ""): string {
  if (n == null) return "N/D";
  const v = Number(n);
  if (isNaN(v)) return "N/D";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B${suffix}`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M${suffix}`;
  return `$${v.toFixed(0)}${suffix}`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const formData = await req.formData();
    const companyId  = formData.get("companyId")  as string | null;
    const userPrompt = (formData.get("userPrompt") as string | null)?.trim() || null;
    const feedback   = (formData.get("feedback")   as string | null)?.trim() || null;
    const blobUrlsRaw = (formData.get("blobUrls") as string | null) || null;
    const blobUrls: { name: string; url: string; type: string }[] = blobUrlsRaw ? JSON.parse(blobUrlsRaw) : [];

    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, session.user.id)).limit(1);
    const apiKey = settings?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "API key not configured" }, { status: 400 });

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
Revenue: ${fmt(co.revenueUsd ?? snap?.revenueUsd)} | Growth: ${co.revenueGrowth != null ? `${(co.revenueGrowth * 100).toFixed(0)}%` : "N/D"} YoY
EBITDA: ${fmt(co.ebitdaUsd ?? snap?.ebitdaUsd)} | Margin: ${co.ebitdaMargin != null ? `${(co.ebitdaMargin * 100).toFixed(0)}%` : "N/D"}
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
      blobUrls.length
        ? `ATTACHED SUPPORTING FILES: ${blobUrls.map(b => b.name).join(", ")} — their actual content is included above as document/image/text blocks. These are the primary, authoritative source for company facts, numbers, and narrative. Base the plan on THEM, not on any prior knowledge or assumption about the company name. If a file's content could not be extracted, say so rather than inventing facts.`
        : null,
      feedback   ? `FEEDBACK ON THE PREVIOUS PLAN:\n${feedback}` : null,
      "Generate the presentation plan. Reply with the JSON object only — no preamble or commentary, even to reference the attached document.",
    ].filter(Boolean).join("\n\n");

    msgContent.push({ type: "text", text: userText });

    const claude = new Anthropic({ apiKey });
    const resp = await claude.messages.create({
      model: "claude-sonnet-4-6",
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

ELEMENT TYPES (to indicate in the plan) — vary these across the deck, don't reuse the same one every slide:
- bar chart: comparing 2+ series by category
- line chart: trend over time
- line_multi: multiple series over time
- donut: parts of a whole (market share, mix)
- hbar_float: ranges by category (e.g. valuation football field)
- waterfall: a financial bridge/walk with a start, deltas, and an end (e.g. Revenue → EBITDA, valuation build-up) — use this instead of hbar_float when it's actually a bridge, not just ranges
- scatter: XY positioning (e.g. growth vs margin)
- quadrant: 2x2 matrix
- table: tabular data (comparables, financials)
- stat_row: a row of headline KPI numbers when the slide's story IS the numbers, no chart needed
- icon_row: qualitative narrative points (thesis pillars, risks, value-creation levers) as icon + header + description
- comparison_cards: before/after or options comparison as 2-4 cards, not a table
- timeline: roadmap, process, or deal milestones as numbered steps

RESPONSE FORMAT — your entire reply must be ONLY this JSON object and nothing else: no preamble, no summary of the attached document, no analysis, no markdown code fences. The first character of your reply must be "{".
{
  "deck_title": "Company Name — Investment Overview",
  "deck_subtitle": "Private & Confidential | ${today}",
  "company": "${companyName}",
  "slides": [
    { "index": 0, "type": "cover", "title": "Company Name", "subtitle": "Investment Overview | ${today}" },
    { "index": 1, "type": "divider", "section": "THE COMPANY" },
    { "index": 2, "type": "slide", "section": "THE COMPANY", "title": "COMPANY OVERVIEW", "takeaway": "Specific key message with real data", "chart": "stat_row: Revenue, EBITDA, employees, founded" },
    { "index": 3, "type": "slide", "section": "THE COMPANY", "title": "BRAND POSITIONING", "takeaway": "...", "chart": "bar: perception vs experience + table: NPS vs peers" },
    { "index": 4, "type": "divider", "section": "THE MARKET" },
    { "index": 5, "type": "slide", "section": "THE MARKET", "title": "MARKET SIZE AND GROWTH", "takeaway": "...", "chart": "line: TAM evolution 2020-2025" },
    { "index": 6, "type": "divider", "section": "FINANCIALS" },
    { "index": 7, "type": "slide", "section": "FINANCIALS", "title": "FINANCIAL EVOLUTION", "takeaway": "...", "chart": "line_multi: revenue and EBITDA 2021-2025" },
    { "index": 8, "type": "divider", "section": "INVESTMENT" },
    { "index": 9, "type": "slide", "section": "INVESTMENT", "title": "INVESTMENT THESIS", "takeaway": "...", "chart": "icon_row: 4 investment pillars" },
    { "index": 10, "type": "slide", "section": "INVESTMENT", "title": "VALUATION", "takeaway": "...", "chart": "hbar_float: valuation ranges by methodology" },
    { "index": 11, "type": "back_cover" }
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
    return NextResponse.json({ success: true, plan });

  } catch (err) {
    console.error("[plan]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
