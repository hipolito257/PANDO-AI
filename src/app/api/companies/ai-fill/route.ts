import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { getFirmThesis } from "@/lib/firmThesis";

export const maxDuration = 60;

const SECTORS = ["Fintech", "Software", "SaaS", "Logistics", "Healthcare", "Consumer", "Retail", "Mobility", "Edtech", "Proptech", "Agritech", "Other"];
const COUNTRIES = ["México", "Colombia", "Chile", "Perú", "Brasil", "Argentina"];
const STAGES = ["pre-seed", "seed", "series-a", "series-b", "series-c", "growth", "mature"];
const FUNDING_STAGES = ["Pre-seed", "Seed", "Serie A", "Serie B", "Serie C", "Serie D+", "Growth", "Bridge", "Deuda"];

// Fields the AI is allowed to fill in, mapped 1:1 to the CompanyModal form / Company schema.
interface FilledFields {
  description?: string | null;
  sector?: string | null;
  subsector?: string | null;
  country?: string | null;
  city?: string | null;
  stage?: string | null;
  fundingStage?: string | null;
  website?: string | null;
  linkedinUrl?: string | null;
  revenueUsd?: number | null;
  revenueGrowth?: number | null;
  ebitdaUsd?: number | null;
  ebitdaMargin?: number | null;
  employees?: number | null;
  employeeGrowth?: number | null;
  totalFunding?: number | null;
  lastFundingAmt?: number | null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as (Partial<FilledFields> & { name?: string }) | null;
  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: "Company name is required" }, { status: 400 });

  const userSetting = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, session.user.id) });
  const apiKey = userSetting?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "No Anthropic API key configured. Add one in Settings." }, { status: 400 });

  const client = new Anthropic({ apiKey });

  const knownEntries = Object.entries(body ?? {})
    .filter(([k, v]) => k !== "name" && v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`);

  const thesis = await getFirmThesis().catch(() => "");

  const prompt = `You are researching a company for a private equity firm's deal radar. Use web search to find real, current, verifiable information — do not guess or fabricate numbers.

Company name: "${name}"
${knownEntries.length ? `Already known (do NOT re-derive these, just work around them):\n${knownEntries.join("\n")}` : "No other fields are known yet."}

${thesis ? `Firm investment thesis (for context on sector framing only, not to influence factual accuracy):\n${thesis}\n` : ""}

Research this company and return a single raw JSON object (no markdown, no preamble, no code fences) with any of these fields you can determine with reasonable confidence. Leave a field as null if you cannot find a reliable answer — never invent a number.

{
  "description": "1-2 sentence description of what the company does, its business model",
  "sector": one of ${JSON.stringify(SECTORS)} or null,
  "subsector": "short subsector label, e.g. 'B2B Lending', 'CPaaS'" or null,
  "country": one of ${JSON.stringify(COUNTRIES)} or null,
  "city": "headquarters city" or null,
  "stage": one of ${JSON.stringify(STAGES)} or null,
  "fundingStage": one of ${JSON.stringify(FUNDING_STAGES)} or null,
  "website": "https://..." or null,
  "linkedinUrl": "https://linkedin.com/company/..." or null,
  "revenueUsd": number (annual revenue in USD) or null,
  "revenueGrowth": number (YoY % growth, e.g. 42 for 42%) or null,
  "ebitdaUsd": number (USD) or null,
  "ebitdaMargin": number (%, e.g. 30) or null,
  "employees": number or null,
  "employeeGrowth": number (%) or null,
  "totalFunding": number (total USD raised to date) or null,
  "lastFundingAmt": number (USD, most recent round) or null,
  "researchNotes": "1-2 sentences: what you found, what's uncertain, or that little public info exists"
}

Sector/country/stage/fundingStage must be EXACTLY one of the listed options (case-sensitive) or null — never invent a new option. Financial figures for private companies are frequently not public — leave them null rather than estimating unless you found a credible, specific source (press coverage, funding announcement, public filing).`;

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      messages: [{ role: "user", content: prompt }],
    });

    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("\n");

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ error: "AI did not return structured data. Try again or fill manually." }, { status: 502 });
    }

    let parsed: FilledFields & { researchNotes?: string };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return NextResponse.json({ error: "Could not parse AI response. Try again or fill manually." }, { status: 502 });
    }

    if (parsed.sector && !SECTORS.includes(parsed.sector)) parsed.sector = null;
    if (parsed.country && !COUNTRIES.includes(parsed.country)) parsed.country = null;
    if (parsed.stage && !STAGES.includes(parsed.stage)) parsed.stage = null;
    if (parsed.fundingStage && !FUNDING_STAGES.includes(parsed.fundingStage)) parsed.fundingStage = null;

    return NextResponse.json({ success: true, fields: parsed });
  } catch (err) {
    console.error("[companies/ai-fill]", err);
    const msg = err instanceof Error ? err.message : "AI research failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
