import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies, signals, mandates } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { eq, notInArray } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { getFirmThesis } from "@/lib/firmThesis";

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// Max ~4MB base64 PDF to stay within Vercel serverless body limits
export const maxDuration = 60; // seconds

type ScannedCompany = {
  name: string;
  sector: string;
  country: string;
  description: string;
  fundingStage?: string;
  totalFunding?: number;
  mandateFit: number;       // 0–10
  mandateFitNote: string;
};

type ScannedSignal = {
  companyName: string;
  companyId?: string;
  type: string;
  title: string;
  detail: string;
};

type ScanResult = {
  summary: string;
  keyInsights: string[];
  companies: ScannedCompany[];
  signals: ScannedSignal[];
  companiesAdded: number;
  signalsAdded: number;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let pdfBase64: string;
  let userPrompt: string | null;
  let filename: string;

  try {
    const body = await req.json();
    pdfBase64  = body.pdfBase64;
    userPrompt = body.userPrompt?.trim() || null;
    filename   = body.filename ?? "document.pdf";
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!pdfBase64) return NextResponse.json({ error: "pdfBase64 required" }, { status: 400 });

  // ── Load context: firm thesis + mandates + existing company names ─────────
  const [firmThesis, activeMandates, existingCompanies] = await Promise.all([
    getFirmThesis(),
    db.query.mandates.findMany().catch(() => []),
    db.query.companies.findMany(),
  ]);

  const existingNames = new Set(existingCompanies.map(c => c.name.toLowerCase()));
  const radarNames    = existingCompanies
    .filter(c => !["public","acquired","closed","inactive"].includes(c.status))
    .map(c => c.name);

  const mandateSummary = activeMandates.length > 0
    ? activeMandates.map((m: any) => {
        const sectors  = (() => { try { return JSON.parse(m.sectors  ?? "[]").join(", "); } catch { return m.sectors  ?? ""; } })();
        const countries= (() => { try { return JSON.parse(m.countries?? "[]").join(", "); } catch { return m.countries?? ""; } })();
        return `• ${m.name}: sectors [${sectors}], countries [${countries}], stages [${m.stages ?? ""}], focus: ${m.description ?? ""}`;
      }).join("\n")
    : "No specific mandates defined — evaluate for general PE fit (growth-stage, LATAM, $5M–$100M revenue).";

  // ── Build Claude prompt ────────────────────────────────────────────────────
  const systemPrompt = `You are a senior private equity analyst at Pando, a LATAM-focused growth equity fund.
Your job is to scan documents and extract intelligence for the fund's investment radar.

Pando's Investment Policy (weigh this first — mandateFit should reflect fit against this policy, refined by the specific mandates below):
${firmThesis}

Active investment mandates:
${mandateSummary}

Companies already on the radar (do NOT re-add these):
${radarNames.slice(0, 80).join(", ")}

${userPrompt ? `\nADDITIONAL FOCUS FOR THIS DOCUMENT:\n${userPrompt}\n` : ""}
Analyze the document and return a JSON object with exactly this structure:
{
  "summary": "3–5 sentence executive summary of the document",
  "keyInsights": ["insight 1", "insight 2", "insight 3", "insight 4", "insight 5"],
  "companies": [
    {
      "name": "Company Name",
      "sector": "one of: Fintech|SaaS|E-commerce|Logistics|Healthtech|Edtech|Proptech|Agtech|Marketplace|Mobility|Other",
      "country": "country name",
      "description": "1-2 sentences: what they do and why they are relevant",
      "fundingStage": "Seed|Serie A|Serie B|Serie C|Growth|Bridge (if mentioned, else null)",
      "totalFunding": 50 (USD millions if mentioned, else null),
      "mandateFit": 8 (0-10 score against the mandates above),
      "mandateFitNote": "1 sentence explaining the fit score"
    }
  ],
  "signals": [
    {
      "companyName": "Name of company already on the radar",
      "type": "funding_due|strategic_buyer_interest|exec_change|revenue_inflection|risk_flag",
      "title": "Short signal title (max 120 chars)",
      "detail": "1-2 sentences with the specific information found in the document"
    }
  ]
}

RULES:
- Only add NEW companies not already on the radar
- Only include companies with mandateFit >= 5
- For signals, only reference companies whose names appear in the "already on radar" list above
- keyInsights: the 3-5 most important data points, trends, or opportunities in the document
- If no relevant companies or signals are found, return empty arrays
- Return ONLY the JSON object, no markdown, no preamble`;

  // ── Call Claude with native PDF support ───────────────────────────────────
  const userId = session.user.id;
  const userApiKey = await db.query.userSettings
    .findFirst({ where: (s, { eq }) => eq(s.userId, userId) })
    .then(s => s?.anthropicApiKey ?? null)
    .catch(() => null);

  const apiKey = userApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "No Anthropic API key configured. Add one in Settings or set ANTHROPIC_API_KEY." }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  let scanResult: ScanResult;
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: [
          {
            type: "document" as any,
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
            title: filename,
            context: "Investment document to be analyzed for PE opportunities",
          },
          {
            type: "text",
            text: "Analyze this document and return the JSON as instructed.",
          },
        ],
      }],
    });

    const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};

    scanResult = {
      summary:      parsed.summary      ?? "No summary generated.",
      keyInsights:  parsed.keyInsights  ?? [],
      companies:    parsed.companies    ?? [],
      signals:      parsed.signals      ?? [],
      companiesAdded: 0,
      signalsAdded:   0,
    };
  } catch (e: any) {
    return NextResponse.json({ error: `AI processing failed: ${e.message}` }, { status: 500 });
  }

  // ── Save new companies to Radar ────────────────────────────────────────────
  const companyNameToId: Record<string, string> = {};
  for (const co of existingCompanies) companyNameToId[co.name.toLowerCase()] = co.id;

  let companiesAdded = 0;
  for (const comp of scanResult.companies) {
    if (!comp.name || comp.name.length < 2) continue;
    if (existingNames.has(comp.name.toLowerCase())) continue;
    if ((comp.mandateFit ?? 0) < 5) continue;

    const slug = comp.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    try {
      const newId = uid();
      await db.insert(companies).values({
        id: newId,
        name: comp.name,
        slug: `${slug}-${uid().slice(0, 4)}`,
        sector:       comp.sector      ?? null,
        country:      comp.country     ?? "LATAM",
        description:  `${comp.description ?? ""} [Fit: ${comp.mandateFitNote ?? ""} Score: ${comp.mandateFit}/10]`,
        fundingStage: comp.fundingStage ?? null,
        totalFunding: comp.totalFunding ?? null,
        status: "monitoring",
        score:      Math.round((comp.mandateFit / 10) * 100),
        confidence: comp.mandateFit / 10,
        createdBy:  `PANDO Scan: ${filename}`,
        updatedBy:  `PANDO Scan: ${filename}`,
        addedAt:    new Date().toISOString(),
        updatedAt:  new Date().toISOString(),
      });
      existingNames.add(comp.name.toLowerCase());
      companyNameToId[comp.name.toLowerCase()] = newId;
      companiesAdded++;
    } catch { /* skip duplicates */ }
  }

  // ── Save signals for existing radar companies ──────────────────────────────
  let signalsAdded = 0;
  for (const sig of scanResult.signals) {
    const compId = companyNameToId[sig.companyName?.toLowerCase()];
    if (!compId) continue;

    try {
      await db.insert(signals).values({
        id:        uid(),
        companyId: compId,
        type:      sig.type ?? "revenue_inflection",
        title:     (sig.title ?? "").slice(0, 120),
        detail:    `Detected in document "${filename}": ${sig.detail ?? ""}`,
        severity:  sig.type === "risk_flag" ? "high" : sig.type === "funding_due" || sig.type === "strategic_buyer_interest" ? "high" : "medium",
        isRead:    false,
        date:      new Date().toISOString(),
      });
      signalsAdded++;
    } catch { /* skip */ }
  }

  return NextResponse.json({
    ok: true,
    summary:        scanResult.summary,
    keyInsights:    scanResult.keyInsights,
    companies:      scanResult.companies,
    signals:        scanResult.signals,
    companiesAdded,
    signalsAdded,
    filename,
  });
}
