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

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const formData = await req.formData();
    const companyId = formData.get("companyId") as string | null;
    const companyNameInput = (formData.get("companyName") as string | null)?.trim() || null;
    const feedback = (formData.get("feedback") as string | null)?.trim() || null;
    const blobUrlsRaw = (formData.get("blobUrls") as string | null) || null;
    const blobUrls: { name: string; url: string; type: string }[] = blobUrlsRaw ? JSON.parse(blobUrlsRaw) : [];

    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, session.user.id)).limit(1);
    const apiKey = settings?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "API key not configured" }, { status: 400 });

    // ── Load company, multi-year historicals, and peer multiples ──────────────
    let companyCard = "No company was selected — base assumptions on the attached files and user instructions only.";
    let companyName = companyNameInput || "The Company";
    let evEbitdaMedian: number | null = null;

    if (companyId) {
      const [co] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
      if (co) {
        companyName = co.name;
        const snaps = await db.select().from(financialSnapshots)
          .where(eq(financialSnapshots.companyId, companyId))
          .orderBy(desc(financialSnapshots.year)).limit(5);
        const historyLines = snaps.length
          ? snaps.slice().reverse().map(s => `  ${s.year}${s.quarter ? ` Q${s.quarter}` : ""}: Revenue ${s.revenueUsd ?? "N/D"} | EBITDA ${s.ebitdaUsd ?? "N/D"} | Employees ${s.employees ?? "N/D"}`).join("\n")
          : "  No historical snapshots on file.";

        const [cs] = await db.select().from(compSets).where(eq(compSets.companyId, companyId)).limit(1);
        let peersLine = "No peer comparables configured.";
        if (cs?.tickers) {
          let tickers: string[] = [];
          try { tickers = JSON.parse(cs.tickers); } catch { /* ignore */ }
          if (tickers.length) {
            const peers = await db.select().from(publicComps).where(inArray(publicComps.ticker, tickers));
            const evEbt = peers.map(p => p.evEbitda).filter((n): n is number => n != null);
            evEbitdaMedian = median(evEbt);
            peersLine = `Peers: ${peers.map(p => p.ticker).join(", ")} | EV/EBITDA median: ${evEbitdaMedian?.toFixed(1) ?? "N/D"}x`;
          }
        }

        companyCard = `
Company: ${co.name} | Sector: ${co.sector ?? "N/D"} | Country: ${co.country ?? "N/D"} | Stage: ${co.stage ?? "N/D"}
Current Revenue (USD): ${co.revenueUsd ?? "N/D"} | YoY Growth: ${co.revenueGrowth != null ? `${(co.revenueGrowth * 100).toFixed(1)}%` : "N/D"}
Current EBITDA (USD): ${co.ebitdaUsd ?? "N/D"} | Margin: ${co.ebitdaMargin != null ? `${(co.ebitdaMargin * 100).toFixed(1)}%` : "N/D"}
Employees: ${co.employees ?? "N/D"} | Description: ${co.description ?? "N/D"}
Historical financials (most recent first reversed to chronological):
${historyLines}
${peersLine}`.trim();
      }
    }

    // ── Download and read any uploaded context files (CIM, diligence Excel/PDF) ──
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
      blobUrls.length
        ? `ATTACHED SUPPORTING FILES: ${blobUrls.map(b => b.name).join(", ")} — their actual content is included above as document/image/text blocks. These are the PRIMARY, AUTHORITATIVE source for deal terms, purchase price expectations, financing terms, and projections. Prefer numbers stated in these files over generic comp-based defaults whenever both are present.`
        : null,
      feedback ? `FEEDBACK ON THE PREVIOUS DRAFT — revise the assumptions accordingly:\n${feedback}` : null,
      "Draft the LBO assumptions now. Reply with the JSON object only — no preamble or commentary.",
    ].filter(Boolean).join("\n\n");
    msgContent.push({ type: "text", text: userText });

    const entryMultipleHint = evEbitdaMedian
      ? `Peer EV/EBITDA median is ${evEbitdaMedian.toFixed(1)}x — anchor your suggested entry and exit multiples near this unless the attached files state an explicit price.`
      : "No peer multiple is available — use a sector-reasonable entry multiple (typically 5x-10x EBITDA for a middle-market company) unless the attached files state an explicit price.";

    const claude = new Anthropic({ apiKey });
    const resp = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: `You are a senior PE analyst at PANDO drafting the INPUT ASSUMPTIONS for an LBO model — you are NOT computing the model yourself (the app's own Excel formulas do every calculation). Your only job is to suggest sane, well-grounded numeric inputs for the user to review and edit before anything is built.

COMPANY DATA:
${companyCard}

${entryMultipleHint}

INSTRUCTIONS:
- All numeric fields are raw numbers, never formatted strings — e.g. 0.09 for 9%, 8.5 for an 8.5x multiple, 10000000 for $10m. Never write "$10m" or "9%" as a string value.
- entryEbitda and revenueYear0 must be grounded in the company's actual current financials above (or the attached files if provided) — never invent a number if real data exists.
- Pick a sane holdingPeriodYears (typically 5, occasionally 3-7) and size every per-year array (revenueGrowthPct, ebitdaMarginPct, capexPctRevenue, nwcPctRevenue, daPctRevenue) to have EXACTLY that many entries, one per projected year (year 1 through year N — do not include a year 0 entry in these arrays).
- Per-year values may ramp (e.g. margin expanding over the hold from operational improvements) or stay flat — use judgment grounded in the company's trajectory and any stated value-creation plan in the attached files, rather than defaulting every year to an identical number when a ramp is clearly implied by the source material.
- debtToEbitda should reflect a realistic middle-market leverage level (typically 3x-5.5x) unless the attached files state specific financing terms.
- Include a short "rationale" field (2-4 sentences) explaining the key judgment calls behind your suggested entry/exit multiple and leverage — this is shown to the user during review, not used in any calculation.
- NEVER use em-dashes (—) in the rationale field. Use a comma, colon, or period instead.

RESPONSE FORMAT — your entire reply must be ONLY this JSON object and nothing else: no preamble, no markdown code fences. The first character of your reply must be "{".
{
  "entryEbitda": 0,
  "revenueYear0": 0,
  "entryMultiple": 0,
  "transactionFeesPct": 0.02,
  "financingFeesPct": 0.015,
  "debtToEbitda": 0,
  "interestRatePct": 0,
  "mandatoryAmortPct": 0.05,
  "cashSweepPct": 1.0,
  "minCashBalance": 0,
  "revenueGrowthPct": [0, 0, 0, 0, 0],
  "ebitdaMarginPct": [0, 0, 0, 0, 0],
  "capexPctRevenue": [0, 0, 0, 0, 0],
  "nwcPctRevenue": [0, 0, 0, 0, 0],
  "daPctRevenue": [0, 0, 0, 0, 0],
  "taxRatePct": 0.25,
  "holdingPeriodYears": 5,
  "exitMultiple": 0,
  "rationale": "..."
}`,
      messages: [{ role: "user", content: msgContent }],
    });

    const raw = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("");
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = fenced ? fenced[1] : (raw.match(/\{[\s\S]*\}/) ?? [null])[0];
    if (!jsonStr) {
      console.error("[financial-models/lbo/plan] Claude returned no JSON. stop_reason:", resp.stop_reason, "raw:", raw.slice(0, 2000));
      return NextResponse.json({
        error: resp.stop_reason === "max_tokens"
          ? "Claude's response was cut off before producing the draft. Try again."
          : "Claude did not return a valid draft",
        raw: raw.slice(0, 500),
      }, { status: 500 });
    }

    const pre = jsonStr.replace(/\bNone\b/g, "null").replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false");
    const repaired = jsonrepair(pre);

    let plan: unknown;
    try {
      plan = JSON.parse(repaired);
    } catch (parseErr) {
      return NextResponse.json({
        error: `Format error in draft: ${(parseErr as Error).message}`,
        raw: jsonStr.slice(0, 400),
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, plan, companyName });
  } catch (err) {
    console.error("[financial-models/lbo/plan]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
