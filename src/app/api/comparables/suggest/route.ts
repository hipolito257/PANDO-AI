import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies, userSettings } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId  = req.nextUrl.searchParams.get("companyId");
  const userPrompt = req.nextUrl.searchParams.get("userPrompt")?.trim() || null;
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  const company = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
  if (!company) return NextResponse.json({ error: "not found" }, { status: 404 });

  const userId = session.user.id;
  const userSetting = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  const apiKey = userSetting?.anthropicApiKey ?? null;

  if (!apiKey) {
    return NextResponse.json({
      error: "no_key",
      message: "Configura tu API key de Anthropic en Configuración para activar sugerencias IA",
      suggestions: [],
    });
  }

  const client = new Anthropic({ apiKey });

  const prompt = `You are a senior private equity analyst building a trading comps table for a valuation.

Target private company:
- Name: ${company.name}
- Sector: ${company.sector ?? "Unknown"}
- Description: ${company.description?.slice(0, 500) ?? "N/A"}
- Country: ${company.country}
- Stage: ${company.fundingStage ?? company.stage ?? "Unknown"}
- Revenue: ${company.revenueUsd ? `$${company.revenueUsd}M USD` : "Unknown"}

${userPrompt ? `SPECIFIC INSTRUCTIONS FROM USER:\n${userPrompt}\n\nThese instructions take priority over the default criteria below.\n\n` : ""}SELECTION CRITERIA (apply unless overridden above):
1. Select publicly listed companies that sell THE SAME PRODUCT OR SERVICE as the target — prioritize what they sell, not the business model structure. For example, if the target sells eyeglasses, select all public companies that sell eyeglasses worldwide, regardless of whether they are direct-to-consumer, wholesale, online, or brick-and-mortar.
2. Geography does NOT matter — include companies from any country or exchange (US, Europe, Asia, LATAM, etc.) as long as they are publicly traded.
3. Prioritize companies whose core revenue comes from the same product/service category as the target.
4. Include 6–10 companies. If there are many direct product comparables, prefer those over indirect ones.

For each company, write:
- "reason": 1 sentence explaining WHY it is a comparable (what specific product/service matches)
- "businessModel": 1–2 sentences describing how this public company makes money and how its model compares to the target (similarities and key differences)
- "similarity": rate the product/service similarity as "Alta", "Media", or "Baja" with a brief justification

Return ONLY a JSON array (no markdown, no preamble, no explanation):
[{"ticker":"LGN","name":"Luxottica Group","exchange":"NYSE","reason":"Global eyewear manufacturer and retailer — same product category","businessModel":"Vertically integrated: designs, manufactures, and retails eyewear brands (Ray-Ban, Oakley). Similar to the target in selling eyeglasses; differs in that Luxottica owns the full supply chain and has massive wholesale distribution.","similarity":"Alta — ambas venden lentes ópticos al consumidor final"}]`;

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "[]";

    let suggestions;
    try {
      suggestions = JSON.parse(text);
    } catch {
      const match = text.match(/\[[\s\S]*?\]/);
      suggestions = match ? JSON.parse(match[0]) : [];
    }

    return NextResponse.json({ suggestions });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, suggestions: [] }, { status: 500 });
  }
}
