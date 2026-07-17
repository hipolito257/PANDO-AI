import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies, userSettings } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Yahoo Finance crumb (same approach as refresh route) ──────────────────────
async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  for (const url of ["https://fc.yahoo.com", "https://consent.yahoo.com"]) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(6000), redirect: "follow",
      });
      const setCookies: string[] =
        (res.headers as any).getSetCookie?.() ??
        (res.headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/).map((s: string) => s.trim());
      const cookieMap: Record<string, string> = {};
      for (const h of setCookies) {
        const m = h.match(/^([^=]+)=([^;]*)/);
        if (m) cookieMap[m[1].trim()] = m[2].trim();
      }
      const cookieStr = Object.entries(cookieMap)
        .filter(([k]) => /^A[0-9S]/.test(k))
        .map(([k, v]) => `${k}=${v}`).join("; ");
      if (!cookieStr) continue;
      for (const qhost of ["query1", "query2"]) {
        try {
          const cr = await fetch(`https://${qhost}.finance.yahoo.com/v1/test/getcrumb`, {
            headers: { "User-Agent": UA, Accept: "*/*", Cookie: cookieStr },
            cache: "no-store", signal: AbortSignal.timeout(6000),
          });
          if (!cr.ok) continue;
          const crumb = (await cr.text()).trim();
          if (!crumb || crumb.startsWith("{") || crumb.length > 50) continue;
          return { crumb, cookie: cookieStr };
        } catch { /* try next */ }
      }
    } catch { /* try next */ }
  }
  return null;
}

// ── Validate a ticker against Yahoo Finance ───────────────────────────────────
// Returns true only if Yahoo has real market data for this ticker (i.e., it's
// an active publicly traded security). Private companies, delisted stocks, and
// bad tickers will return false.
async function validateTicker(
  ticker: string,
  crumb: string,
  cookie: string
): Promise<boolean> {
  for (const host of ["query1", "query2"]) {
    try {
      const url =
        `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
        `?modules=price&crumb=${encodeURIComponent(crumb)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json", Cookie: cookie },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const result = json?.quoteSummary?.result?.[0];
      if (!result) continue;
      // Must have a real market cap or price to be considered public
      const price = result?.price;
      if (price?.regularMarketPrice?.raw) return true;
    } catch { /* try next host */ }
  }
  return false;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId  = req.nextUrl.searchParams.get("companyId");
  const userPrompt = req.nextUrl.searchParams.get("userPrompt")?.trim() || null;
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  const company = await db.query.companies.findFirst({ where: eq(companies.id, companyId) });
  if (!company) return NextResponse.json({ error: "not found" }, { status: 404 });

  const userId = session.user.id;
  const userSetting = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  const apiKey = userSetting?.anthropicApiKey ?? null;

  if (!apiKey) {
    return NextResponse.json({
      error: "no_key",
      message: "Configure your Anthropic API key in Settings to enable AI suggestions",
      suggestions: [],
    });
  }

  const client = new Anthropic({ apiKey });

  const prompt = `You are a senior private equity analyst building a trading comps table for a valuation. Use web search to actually research the target company and candidate comps — do not rely on memory alone, and never guess a ticker.

Target private company:
- Name: ${company.name}
- Sector: ${company.sector ?? "Unknown"}
- Description: ${company.description?.slice(0, 500) ?? "N/A"}
- Country: ${company.country}
- Stage: ${company.fundingStage ?? company.stage ?? "Unknown"}
- Revenue: ${company.revenueUsd ? `$${company.revenueUsd}M USD` : "Unknown"}
${company.website ? `- Website: ${company.website}` : ""}

${userPrompt ? `SPECIFIC INSTRUCTIONS FROM USER:\n${userPrompt}\n\nThese instructions take priority over the default criteria below.\n\n` : ""}RESEARCH PROCESS — do this before answering:
1. Search for and read about the target company itself (its website, news, any description of what it actually sells and to whom) so you understand its real business, not just its sector label.
2. Search for publicly traded companies that compete in or serve the same specific product/service niche — not just the same broad sector. Verify each candidate's actual current business via search, don't assume from the company name alone (many companies pivot).
3. For each candidate, search for and confirm its current ticker and exchange — do not output a ticker you have not verified is correct and currently trading today.

CRITICAL REQUIREMENTS — NON-NEGOTIABLE:
⚠️  ONLY include companies you have verified via search are ACTIVELY TRADED on a major stock exchange RIGHT NOW.
⚠️  Do NOT include: private companies, pre-IPO companies, unicorns, SPACs, delisted stocks, recently acquired companies, or any company without a current stock ticker.
⚠️  If you cannot verify a candidate is public and actively traded via search, do NOT include it — a shorter, accurate list is better than a longer, wrong one.

SELECTION CRITERIA:
1. Select publicly listed companies that sell THE SAME PRODUCT OR SERVICE as the target — prioritize what they sell, not the business model structure. For example, if the target sells eyeglasses, select all public companies that sell eyeglasses worldwide, regardless of channel.
2. Geography does NOT matter — include companies from any country or exchange (NYSE, NASDAQ, LSE, TSE, HKEx, etc.).
3. Include 8–12 companies to allow for some to be filtered out. The more direct the product/service match, the better — reject generic "same industry" matches that don't actually compete for the same customer.

For each company provide:
- "ticker": the exact stock ticker as listed on its primary exchange, verified via search (e.g. "LVMH.PA", "7203.T", "AAPL")
- "name": full company name
- "exchange": exchange name (NYSE, NASDAQ, TSE, LSE, HKEx, etc.)
- "website": the company's main website URL (e.g. "https://www.apple.com", "https://www.mercadolibre.com") — required, never omit
- "reason": 1 sentence — what specific product/service matches the target, based on what you actually found
- "businessModel": 1–2 sentences describing the business model and similarities/differences vs. target
- "similarity": "High", "Medium", or "Low" with a brief justification

After your research, respond with ONLY a valid JSON array (no markdown, no preamble, no commentary about your search process):
[{"ticker":"EL","name":"Estée Lauder Companies","exchange":"NYSE","website":"https://www.esteelauder.com","reason":"Global beauty company selling direct-to-consumer cosmetics","businessModel":"Sells luxury beauty products through retail and DTC channels. Similar in DTC approach; differs in having massive wholesale and travel retail distribution.","similarity":"Medium — same category but different price positioning"}]`;

  // ── Step 1: Get AI suggestions, grounded in real web research ─────────────
  let rawSuggestions: any[] = [];
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 12 }],
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .trim();
    try {
      rawSuggestions = JSON.parse(text);
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      rawSuggestions = match ? JSON.parse(match[0]) : [];
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message, suggestions: [] }, { status: 500 });
  }

  if (!rawSuggestions.length) {
    return NextResponse.json({ suggestions: [] });
  }

  // ── Step 2: Validate each ticker against Yahoo Finance ────────────────────
  // Only return tickers that actually have live market data — filters out
  // private companies, delisted stocks, and hallucinated tickers.
  const auth2 = await getYahooCrumb();
  if (!auth2) {
    // If we can't get a crumb, return raw suggestions with a warning
    return NextResponse.json({ suggestions: rawSuggestions, warning: "Could not validate tickers against Yahoo Finance" });
  }

  const validationResults = await Promise.all(
    rawSuggestions.map(async (s: any) => ({
      ...s,
      _valid: await validateTicker(s.ticker, auth2.crumb, auth2.cookie),
    }))
  );

  const suggestions = validationResults
    .filter(s => s._valid)
    .map(({ _valid, ...s }) => s);

  return NextResponse.json({ suggestions });
}
