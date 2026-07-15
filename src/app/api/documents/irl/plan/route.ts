import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { companies, compSets, publicComps, userSettings, financialSnapshots } from "@/lib/schema";
import { eq, inArray, desc } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import { extractPlainText } from "@/lib/extractDocumentText";
import { stripEmDashes, fmtMoneyDoc } from "@/lib/utils";
import { getFirmThesis } from "@/lib/firmThesis";

export const maxDuration = 120;

const WORDS_PER_PAGE = 550;

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

interface SectionSpec { id: string; title: string; guidance: string }
interface QuestionnaireAnswer { id: string; category: string; question: string; answer: string }

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const formData = await req.formData();
    const companyId  = formData.get("companyId")  as string | null;
    const userPrompt = (formData.get("userPrompt") as string | null)?.trim() || null;
    const feedback   = (formData.get("feedback")   as string | null)?.trim() || null;
    const pageCount  = Math.min(15, Math.max(1, Number(formData.get("pageCount")) || 4));
    const sectionsRaw = (formData.get("sections") as string | null) || null;
    const sections: SectionSpec[] = sectionsRaw ? JSON.parse(sectionsRaw) : [];
    const blobUrlsRaw = (formData.get("blobUrls") as string | null) || null;
    const blobUrls: { name: string; url: string; type: string }[] = blobUrlsRaw ? JSON.parse(blobUrlsRaw) : [];
    const questionnaireRaw = (formData.get("questionnaire") as string | null) || null;
    const questionnaire: QuestionnaireAnswer[] = questionnaireRaw ? JSON.parse(questionnaireRaw) : [];

    if (sections.length === 0) {
      return NextResponse.json({ error: "At least one section is required" }, { status: 400 });
    }

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

    const policy = await getFirmThesis();
    const today = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const totalWords = pageCount * WORDS_PER_PAGE;
    const wordsPerSection = Math.round(totalWords / sections.length);

    const questionnaireCard = questionnaire.length
      ? questionnaire
          .filter(q => q.answer?.trim())
          .map(q => `[${q.category}] ${q.question}\n${q.answer.trim()}`)
          .join("\n\n")
      : "";

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

    const sectionsOutline = sections.map((s, i) => `${i + 1}. "${s.title}"${s.guidance ? ` — ${s.guidance}` : ""}`).join("\n");

    const userText = [
      userPrompt ? `USER INSTRUCTIONS:\n${userPrompt}` : null,
      blobUrls.length
        ? `ATTACHED DILIGENCE FILES: ${blobUrls.map(b => b.name).join(", ")} — their actual content is included above as document/image/text blocks. These are the primary, authoritative source for company facts, numbers, and diligence findings. Base the memo on THEM, not on any prior knowledge or assumption about the company name. If a file's content could not be extracted, say so rather than inventing facts.`
        : null,
      questionnaireCard
        ? `DUE DILIGENCE QUESTIONNAIRE — analyst-provided answers, treat as authoritative and incorporate directly into the relevant sections (especially Risks & Mitigants, Financial Analysis, and Legal/Regulatory/ESG):\n\n${questionnaireCard}`
        : null,
      feedback ? `FEEDBACK ON THE PREVIOUS DRAFT:\n${feedback}` : null,
      "Generate the IRL content. Reply with the JSON object only — no preamble or commentary, even to reference the attached document.",
    ].filter(Boolean).join("\n\n");

    msgContent.push({ type: "text", text: userText });

    const claude = new Anthropic({ apiKey });
    const resp = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: `You are a senior investment professional at PANDO, a private equity fund, writing an Internal Review Letter (IRL): an internal, IC-facing due-diligence memo used to support an investment committee decision. This is NOT a marketing document — write directly, risk-aware, and recommendation-oriented. Where the evidence is thin or a question is unanswered, say so plainly rather than smoothing it over.

PANDO INVESTMENT THESIS (the fund's mandate and underwriting policy; evaluate the opportunity against this):
${policy}

COMPANY DATA:
${companyCard}

PEERS:
${peersCard}

DATE: ${today}

TARGET LENGTH: approximately ${pageCount} page${pageCount === 1 ? "" : "s"} (~${totalWords} words total, roughly ${wordsPerSection} words per section). This is a soft target for pacing, not an exact requirement.

SECTIONS TO WRITE, IN THIS EXACT ORDER (do not add, remove, reorder, or rename them):
${sectionsOutline}

INSTRUCTIONS:
- Write real prose paragraphs per section, grounded in the company data, any attached diligence files, and the questionnaire answers. Never invent numbers or diligence findings.
- Each section should have 1-4 paragraphs depending on the target length.
- Be explicit about risk: name the actual risks found in diligence and how they are (or are not) mitigated, rather than generic boilerplate.
- If diligence information needed for a section was not provided, state that it is outstanding rather than fabricating a finding.
- NEVER use em-dashes (—) anywhere. Use a comma, colon, or period instead.
- Never use emoji.
- Format every money figure exactly like this: "USD $200 m" (millions), "USD $850 k" (thousands), "USD $1.2 bn" (billions) — currency code, then symbol+number, then a space and lowercase suffix (k/m/bn). Use "MXN $" or "EUR €" instead of "USD $" when the figure is explicitly in pesos or euros. Never write "$200M", "200 million dollars", or similar.

RESPONSE FORMAT — your entire reply must be ONLY this JSON object and nothing else: no preamble, no markdown code fences. The first character of your reply must be "{".
{
  "title": "${companyName} — Internal Review Letter",
  "subtitle": "Investment Committee Memo | ${today}",
  "sections": [
    ${sections.map(s => `{ "heading": "${s.title}", "paragraphs": ["...", "..."] }`).join(",\n    ")}
  ]
}`,
      messages: [{ role: "user", content: msgContent }],
    });

    const raw = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("");

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = fenced ? fenced[1] : (raw.match(/\{[\s\S]*\}/) ?? [null])[0];
    if (!jsonStr) {
      console.error("[irl/plan] Claude returned no JSON. stop_reason:", resp.stop_reason, "raw:", raw.slice(0, 2000));
      return NextResponse.json({
        error: resp.stop_reason === "max_tokens"
          ? "Claude's response was cut off before producing the draft. Try again, or reduce the page length."
          : "Claude did not return a valid draft",
        raw: raw.slice(0, 500),
      }, { status: 500 });
    }

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
        error: `Format error in draft: ${(parseErr as Error).message}`,
        raw: jsonStr.slice(0, 400),
      }, { status: 500 });
    }
    return NextResponse.json({ success: true, plan: stripEmDashes(plan), companyName });

  } catch (err) {
    console.error("[irl/plan]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
  }
}
