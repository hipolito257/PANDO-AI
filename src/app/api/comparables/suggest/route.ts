import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies, userSettings } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId = req.nextUrl.searchParams.get("companyId");
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

  const prompt = `You are a senior private equity analyst doing a trading comps (comparable companies) analysis for a valuation.

Target private company:
- Name: ${company.name}
- Sector: ${company.sector ?? "Unknown"}
- Description: ${company.description?.slice(0, 500) ?? "N/A"}
- Country: ${company.country}
- Stage: ${company.fundingStage ?? company.stage ?? "Unknown"}
- Revenue: ${company.revenueUsd ? `$${company.revenueUsd}M USD` : "Unknown"}

Select 6-8 publicly listed comparable companies ideal for a trading comps valuation table. Selection criteria:
1. Same or very similar business model
2. Similar end-customer and product category  
3. Same geography when available (LATAM-focused preferred), plus US/global category leaders
4. At least 3-4 should be direct category leaders even if different geography

Return ONLY a JSON array (no markdown, no preamble, no explanation):
[{"ticker":"TWLO","name":"Twilio Inc.","exchange":"NYSE","reason":"CPaaS leader, most direct comparable"},{"ticker":"BAND","name":"Bandwidth Inc.","exchange":"NASDAQ","reason":"Voice/SMS APIs for enterprises"}]`;

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
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
