import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies, newsItems, signals } from "@/lib/schema";
import { randomUUID } from "crypto";
import { eq, notInArray } from "drizzle-orm";

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── RSS parser ────────────────────────────────────────────────────────────────
function parseRSS(xml: string) {
  const results: { title: string; url: string; date: string; source: string }[] = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1];
    let title =
      block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ??
      block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    title = title
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/ - [^-]+$/, "").trim();
    const url =
      block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ??
      block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1] ?? "";
    const rawDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";
    let date = new Date().toISOString();
    try { if (rawDate) date = new Date(rawDate).toISOString(); } catch {}
    const source = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "Google News";
    if (title && url) results.push({ title, url, date, source });
  }
  return results;
}

async function fetchGoogleNews(query: string): Promise<{ title: string; url: string; date: string; source: string }[]> {
  try {
    const q = encodeURIComponent(query);
    const res = await fetch(
      `https://news.google.com/rss/search?q=${q}&hl=es-419&gl=MX&ceid=MX:es-419`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; PANDOBot/1.0)" }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    return parseRSS(await res.text()).slice(0, 8);
  } catch { return []; }
}

// ── Sentiment / signal helpers ────────────────────────────────────────────────
function guessSentiment(title: string): "positive" | "negative" | "neutral" {
  const t = title.toLowerCase();
  const pos = ["levanta","ronda","financiamiento","crecimiento","expande","lanza","logra","récord","inversión","alianza","acuerdo","premio","adquiere","fusión"];
  const neg = ["despidos","caída","quiebra","fraude","demanda","pérdida","cierra","crisis","multa","escándalo","baja","reduce","deuda"];
  if (pos.some(w => t.includes(w))) return "positive";
  if (neg.some(w => t.includes(w))) return "negative";
  return "neutral";
}

function detectSignalType(title: string): string | null {
  const t = title.toLowerCase();
  if (t.includes("ronda") || t.includes("financiamiento") || t.includes("levanta") || t.includes("inversión")) return "funding_due";
  if (t.includes("adquiere") || t.includes("adquisición") || t.includes("fusión") || t.includes("compra")) return "strategic_buyer_interest";
  if (t.includes("contrata") || t.includes("ceo") || t.includes("director") || t.includes("nombra")) return "exec_change";
  if (t.includes("despidos") || t.includes("recorte") || t.includes("reduce personal")) return "exec_change";
  if (t.includes("récord") || t.includes("crecimiento") || t.includes("expande")) return "revenue_inflection";
  return null;
}

// ── Exit detection ─────────────────────────────────────────────────────────────
function detectExitStatus(titles: string[]): "public" | "acquired" | "closed" | null {
  const text = titles.join(" ").toLowerCase();
  if (
    text.includes("ipo") || text.includes("oferta pública") || text.includes("sale a bolsa") ||
    text.includes("salió a bolsa") || text.includes("cotiza en") || text.includes("debut bursátil") ||
    text.includes("listing") || text.includes("nasdaq") || text.includes("nyse") && text.includes("debut")
  ) return "public";
  if (
    text.includes("adquirida por") || text.includes("comprada por") || text.includes("adquisición de") ||
    text.includes("fusión con") || text.includes("merger") || text.includes("acquired by")
  ) return "acquired";
  if (
    text.includes("cierra operaciones") || text.includes("cesa operaciones") ||
    text.includes("quiebra") || text.includes("bancarrota") || text.includes("shutdown")
  ) return "closed";
  return null;
}

// ── Funding extraction ─────────────────────────────────────────────────────────
function extractFundingFromTitles(titles: string[]): { amount: number | null; stage: string | null } {
  const text = titles.join(" ");
  // Match "$X millones", "USD X M", "X million", etc.
  const amtMatch = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(millones|M|MM|mil millones|B)/i) ??
                   text.match(/(\d+(?:\.\d+)?)\s*(million|millones)\s*(USD|dólares)?/i);
  let amount: number | null = null;
  if (amtMatch) {
    const n = parseFloat(amtMatch[1]);
    const unit = (amtMatch[2] ?? "").toLowerCase();
    amount = (unit.includes("mil millones") || unit === "b") ? n * 1000 : n;
  }
  // Stage
  const stageMatch = text.match(/serie\s+([a-e])|seed|pre-seed|crecimiento|growth/i);
  let stage: string | null = null;
  if (stageMatch) {
    const s = (stageMatch[0] ?? "").toLowerCase();
    if (s.includes("pre-seed")) stage = "Pre-Seed";
    else if (s.includes("seed")) stage = "Seed";
    else if (s.includes("serie")) stage = `Serie ${(stageMatch[1] ?? "").toUpperCase()}`;
    else if (s.includes("crecimiento") || s.includes("growth")) stage = "Growth";
  }
  return { amount, stage };
}

// ── Claude AI extraction for discovery ────────────────────────────────────────
async function extractCompaniesFromHeadlines(
  headlines: string[],
  existingNames: Set<string>,
  apiKey: string
): Promise<{ name: string; sector: string; country: string; description: string; fundingStage?: string; totalFunding?: number }[]> {
  if (!headlines.length) return [];

  const prompt = `You are a private equity analyst assistant scanning news for investment targets.

Given the following news headlines, extract any PRIVATE startup or growth-stage companies that:
- Are based in Latin America (Mexico, Colombia, Brazil, Chile, Peru, Argentina, etc.)
- Have raised funding, announced growth, or are receiving investor attention
- Are NOT already public companies, large corporations, or well-known global brands
- Are NOT government entities or universities

For each company found, provide:
- name: company name exactly as mentioned
- sector: one of [Fintech, SaaS, E-commerce, Logistics, Healthtech, Edtech, Proptech, Agtech, Marketplace, Mobility, Other]
- country: country of origin
- description: 1 sentence describing what the company does based on the headline
- fundingStage: if mentioned (Seed, Serie A, Serie B, Serie C, Growth, etc.)
- totalFunding: funding amount in USD millions if clearly mentioned (number only, no symbols)

Skip companies that already exist in this list: ${JSON.stringify([...existingNames].slice(0, 50))}

Headlines:
${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}

Return ONLY a valid JSON array. If no companies found, return [].
Example: [{"name":"Konfio","sector":"Fintech","country":"México","description":"Plataforma de crédito para PYMEs","fundingStage":"Serie D","totalFunding":110}]`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text: string = data?.content?.[0]?.text ?? "[]";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    return JSON.parse(match[0]);
  } catch { return []; }
}

// ── Main cron handler ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const systemApiKey = process.env.ANTHROPIC_API_KEY ?? null;
  const cos = await db.query.companies.findMany();
  const activeCompanies = cos.filter(c => !["public","acquired","closed"].includes(c.status));

  const report: Record<string, unknown>[] = [];
  let totalNews = 0;
  let totalSignals = 0;
  let totalExits = 0;
  let totalFundingUpdates = 0;

  // ── PHASE 1: Update existing companies ───────────────────────────────────────
  for (const co of activeCompanies) {
    let newsAdded = 0;
    let signalsAdded = 0;
    const allTitles: string[] = [];

    try {
      const items = await fetchGoogleNews(`"${co.name}"`);
      for (const item of items) {
        allTitles.push(item.title);
        const exists = await db.query.newsItems.findFirst({ where: (n, { eq }) => eq(n.url, item.url) });
        if (exists) continue;

        await db.insert(newsItems).values({
          id: uid(), companyId: co.id,
          title: item.title, source: item.source, url: item.url,
          date: item.date, sentiment: guessSentiment(item.title),
        });
        newsAdded++;

        const signalType = detectSignalType(item.title);
        if (signalType) {
          await db.insert(signals).values({
            id: randomUUID(), companyId: co.id,
            type: signalType, title: item.title.slice(0, 120),
            detail: `Detectado automáticamente via Google News: ${item.source}`,
            severity: signalType === "funding_due" || signalType === "strategic_buyer_interest" ? "high" : "medium",
            isRead: false, date: item.date,
          });
          signalsAdded++;
        }
      }

      // Exit detection
      const exitStatus = detectExitStatus(allTitles);
      if (exitStatus && co.status !== exitStatus) {
        await db.update(companies).set({ status: exitStatus, updatedAt: new Date().toISOString() }).where(eq(companies.id, co.id));
        await db.insert(signals).values({
          id: randomUUID(), companyId: co.id,
          type: exitStatus === "public" ? "strategic_buyer_interest" : "strategic_buyer_interest",
          title: exitStatus === "public" ? `${co.name} habría salido a bolsa` : exitStatus === "acquired" ? `${co.name} habría sido adquirida` : `${co.name} habría cerrado operaciones`,
          detail: `Detectado automáticamente via noticias. Verificar y actualizar status manualmente.`,
          severity: "high", isRead: false, date: new Date().toISOString(),
        });
        totalExits++;
      }

      // Funding update from news
      if (allTitles.some(t => t.toLowerCase().includes("ronda") || t.toLowerCase().includes("levanta") || t.toLowerCase().includes("millones"))) {
        const { amount, stage } = extractFundingFromTitles(allTitles);
        const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        if (amount && amount > (co.lastFundingAmt ?? 0)) {
          updates.lastFundingAmt = amount;
          updates.lastFundingDate = new Date().toISOString().slice(0, 10);
          const prev = co.totalFunding ?? 0;
          updates.totalFunding = prev + amount;
          totalFundingUpdates++;
        }
        if (stage) updates.fundingStage = stage;
        if (Object.keys(updates).length > 1) {
          await db.update(companies).set(updates as any).where(eq(companies.id, co.id));
        }
      }
    } catch { /* skip failed companies */ }

    report.push({ company: co.name, news: newsAdded, signals: signalsAdded });
    totalNews += newsAdded;
    totalSignals += signalsAdded;
    await sleep(300);
  }

  // ── PHASE 2: Discovery (requires ANTHROPIC_API_KEY) ──────────────────────────
  let discovered = 0;
  if (systemApiKey) {
    const existingNames = new Set(cos.map(c => c.name.toLowerCase()));
    const existingSlugs = new Set(cos.map(c => c.slug));

    // Build discovery queries from sectors in radar + generic LATAM searches
    const sectors = [...new Set(activeCompanies.map(c => c.sector).filter(Boolean))];
    const discoveryQueries: string[] = [
      "startup latinoamerica levanta ronda inversión 2025",
      "empresa tecnología México Colombia ronda financiamiento",
      "fintech latam funding series round 2025",
      "startup brasil chile peru argentina serie seed",
      ...sectors.slice(0, 3).map(s => `startup ${s} latam ronda inversión`),
    ];

    const allHeadlines: string[] = [];
    for (const q of discoveryQueries) {
      const items = await fetchGoogleNews(q);
      allHeadlines.push(...items.map(i => i.title));
      await sleep(200);
    }

    // Deduplicate headlines
    const uniqueHeadlines = [...new Set(allHeadlines)];

    // Use Claude to extract companies
    const extracted = await extractCompaniesFromHeadlines(uniqueHeadlines, existingNames, systemApiKey);

    for (const comp of extracted) {
      if (!comp.name || comp.name.length < 2) continue;
      const slug = comp.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (existingNames.has(comp.name.toLowerCase()) || existingSlugs.has(slug)) continue;

      try {
        await db.insert(companies).values({
          id: uid(),
          name: comp.name,
          slug: slug + "-" + uid().slice(0, 4),
          sector: comp.sector ?? null,
          country: comp.country ?? "LATAM",
          description: comp.description ?? null,
          fundingStage: comp.fundingStage ?? null,
          totalFunding: comp.totalFunding ?? null,
          status: "pipeline",
          score: 0,
          confidence: 0.3,
          createdBy: "PANDO Auto-Discovery",
          updatedBy: "PANDO Auto-Discovery",
          addedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        existingNames.add(comp.name.toLowerCase());
        existingSlugs.add(slug);
        discovered++;
      } catch { /* skip duplicates */ }
    }
  }

  return NextResponse.json({
    ok: true,
    ran: new Date().toISOString(),
    companies: activeCompanies.length,
    totalNews,
    totalSignals,
    totalExits,
    totalFundingUpdates,
    discovered,
    discoveryEnabled: !!systemApiKey,
    report,
  });
}
