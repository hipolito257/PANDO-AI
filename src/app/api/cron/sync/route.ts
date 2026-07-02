import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies, newsItems, signals, cronLogs } from "@/lib/schema";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { getFirmThesis } from "@/lib/firmThesis";

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

// ── RSS sources specialized in LATAM tech ─────────────────────────────────────
const LATAM_RSS_FEEDS = [
  { url: "https://contxto.com/en/feed/",                              name: "Contxto EN" },
  { url: "https://contxto.com/es/feed/",                              name: "Contxto ES" },
  { url: "https://www.larepublica.co/feed",                           name: "La República" },
  { url: "https://www.eleconomista.com.mx/rss/tecnologia.xml",        name: "El Economista MX" },
  { url: "https://www.pulso.social/feed/",                            name: "Pulso Social" },
  { url: "https://startups.com.br/feed/",                             name: "Startups BR" },
];

async function fetchLatamFeeds(): Promise<{ title: string; url: string; date: string; source: string }[]> {
  const results = await Promise.allSettled(
    LATAM_RSS_FEEDS.map(async feed => {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PANDOBot/1.0)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      return parseRSS(await res.text())
        .slice(0, 10)
        .map(i => ({ ...i, source: feed.name }));
    })
  );
  return results.flatMap(r => (r.status === "fulfilled" ? r.value : []));
}

// ── Discovery queries ──────────────────────────────────────────────────────────
const VC_QUERIES = [
  '"Kaszek" invierte startup',
  '"Softbank LATAM" inversión startup',
  '"Magma Partners" startup LATAM',
  '"ALLVP" startup inversión',
  '"500 startups" LATAM seed serie',
  '"Y Combinator" LATAM startup 2025',
  '"Accel" LATAM startup inversión',
  '"a16z" latinoamerica startup',
  '"Monashees" startup inversión',
  '"Valor Capital" startup LATAM',
  '"QED Investors" fintech LATAM',
  '"Ribbit Capital" fintech latinoamerica',
  '"Base10" LATAM startup',
  '"Endeavor" startup latinoamerica inversión',
];

const SIGNAL_QUERIES = [
  'startup latinoamerica "serie A" 2025 millones',
  'startup latinoamerica "serie B" 2025 inversión',
  '"levanta ronda" startup latinoamerica 2025',
  'fintech latinoamerica ronda financiamiento 2025',
  '"SaaS" "B2B" LATAM startup inversión 2025',
  '"healthtech" OR "medtech" latinoamerica startup ronda',
  '"logística" "supply chain" latinoamerica startup serie',
  'proptech latinoamerica startup inversión ronda',
  'agtech latinoamerica startup ronda 2025',
  '"ecommerce" OR "marketplace" latinoamerica startup serie 2025',
];

const EXIT_DISCOVERY_QUERIES = [
  'startup latinoamerica IPO bolsa 2025 2026',
  'startup LATAM "oferta pública" debut bursátil 2025 2026',
  'startup latinoamerica "adquirida por" "comprada por" 2025 2026',
  'fintech LATAM "acquired" merger acquisition 2025 2026',
  'startup latinoamerica unicornio adquisición exit 2026',
  'startup latinoamerica "cierra" "shutdown" "cesa operaciones" 2025 2026',
];

async function fetchQueriesParallel(queries: string[]): Promise<string[]> {
  const BATCH = 5;
  const headlines: string[] = [];
  for (let i = 0; i < queries.length; i += BATCH) {
    const batch = queries.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(q => fetchGoogleNews(q)));
    results.forEach(items => headlines.push(...items.map(it => it.title)));
    if (i + BATCH < queries.length) await sleep(400);
  }
  return headlines;
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

// ── Score delta per signal ────────────────────────────────────────────────────
function signalScoreDelta(type: string, severity: string, title: string): number {
  const t = title.toLowerCase();
  // Negative signals (layoffs, cuts) reduce score
  if (type === "exec_change" && (t.includes("despido") || t.includes("recorte") || t.includes("reduce personal") || t.includes("layoff"))) {
    return -3;
  }
  if (severity === "high") return 5;
  if (severity === "medium") return 2;
  return 1;
}

// ── Exit detection helpers ────────────────────────────────────────────────────
function mightHaveExitSignal(titles: string[]): boolean {
  const text = titles.join(" ").toLowerCase();
  return (
    text.includes("ipo") || text.includes("oferta pública inicial") ||
    text.includes("sale a bolsa") || text.includes("salió a bolsa") ||
    text.includes("debut bursátil") || text.includes("cotiza en bolsa") ||
    text.includes("adquirida por") || text.includes("comprada por") ||
    text.includes("acquired by") || text.includes("merger with") ||
    text.includes("cierra operaciones") || text.includes("cesa operaciones") ||
    text.includes("quiebra definitiva") || text.includes("bancarrota") ||
    text.includes("shutdown") || text.includes("wind down")
  );
}

async function validateExitWithClaude(
  companyName: string,
  headlines: string[],
  apiKey: string
): Promise<{ confirmed: boolean; type: "public" | "acquired" | "closed" | null; confidence: number; summary: string } | null> {
  const prompt = `You are a strict PE analyst verifying exit events. Read these news headlines about "${companyName}" and determine if they CONFIRM a real exit event.

Headlines:
${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}

EXIT TYPES:
- "public": Company completed an IPO or started trading on a stock exchange
- "acquired": Company was acquired / merged / bought by another entity
- "closed": Company shut down operations, declared bankruptcy, or ceased business

STRICT RULES:
1. Only return confirmed: true if the headlines provide CLEAR evidence of a completed exit
2. A rumor, speculation, or intent to exit is NOT enough — must be confirmed
3. If headlines just mention a company name alongside an acquiring company without explicit acquisition language, that's NOT enough
4. "Fundraising" or "new investment" is NOT an exit — it's the opposite
5. Be very conservative — a false positive is much worse than a false negative

Return ONLY this JSON (no markdown):
{"confirmed": false, "type": null, "confidence": 0.0, "summary": "reason"}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text: string = data?.content?.[0]?.text ?? "{}";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch { return null; }
}

// ── Funding extraction ────────────────────────────────────────────────────────
function extractFundingFromTitles(titles: string[]): { amount: number | null; stage: string | null } {
  const text = titles.join(" ");
  const amtMatch = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(millones|M|MM|mil millones|B)/i) ??
                   text.match(/(\d+(?:\.\d+)?)\s*(million|millones)\s*(USD|dólares)?/i);
  let amount: number | null = null;
  if (amtMatch) {
    const n = parseFloat(amtMatch[1]);
    const unit = (amtMatch[2] ?? "").toLowerCase();
    amount = (unit.includes("mil millones") || unit === "b") ? n * 1000 : n;
  }
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

// ── Types ─────────────────────────────────────────────────────────────────────
type CompanyRow = Awaited<ReturnType<typeof db.query.companies.findMany>>[number];

type CompanyResult = {
  company: string;
  newsAdded: number;
  signalsAdded: number;
  exitsDetected: number;
  fundingUpdated: boolean;
};

// ── Process a single company ──────────────────────────────────────────────────
async function processCompany(
  co: CompanyRow,
  systemApiKey: string | null,
  sevenDaysAgo: string,
): Promise<CompanyResult> {
  let newsAdded = 0;
  let signalsAdded = 0;
  let exitsDetected = 0;
  let fundingUpdated = false;
  let scoreAdjustment = 0;
  const allTitles: string[] = [];

  try {
    const items = await fetchGoogleNews(`"${co.name}"`);

    for (const item of items) {
      allTitles.push(item.title);

      const exists = await db.query.newsItems.findFirst({
        where: (n, { eq }) => eq(n.url, item.url),
      });
      if (exists) continue;

      await db.insert(newsItems).values({
        id: uid(), companyId: co.id,
        title: item.title, source: item.source, url: item.url,
        date: item.date, sentiment: guessSentiment(item.title),
      });
      newsAdded++;

      const signalType = detectSignalType(item.title);
      if (signalType) {
        // Dedup: skip if same type already exists within the last 7 days
        const recent = await db.query.signals.findFirst({
          where: (s, { and, eq, gte }) => and(
            eq(s.companyId, co.id),
            eq(s.type, signalType),
            gte(s.date, sevenDaysAgo),
          ),
        });
        if (!recent) {
          const severity = signalType === "funding_due" || signalType === "strategic_buyer_interest" ? "high" : "medium";
          await db.insert(signals).values({
            id: randomUUID(), companyId: co.id,
            type: signalType, title: item.title.slice(0, 120),
            detail: `Automatically detected via Google News: ${item.source}`,
            severity, isRead: false, date: item.date,
          });
          signalsAdded++;
          scoreAdjustment += signalScoreDelta(signalType, severity, item.title);
        }
      }
    }

    // Exit detection: keyword pre-filter → Claude confirms
    if (mightHaveExitSignal(allTitles) && systemApiKey) {
      const exitValidation = await validateExitWithClaude(co.name, allTitles, systemApiKey);
      if (exitValidation?.confirmed && exitValidation.confidence >= 0.85 && exitValidation.type) {
        const exitTypeLabel =
          exitValidation.type === "public"   ? "IPO / Going public"   :
          exitValidation.type === "acquired" ? "Acquisition / Merger"   :
                                               "Ceased operations";
        const existingExitSignal = await db.query.signals.findFirst({
          where: (s, { and, eq }) => and(eq(s.companyId, co.id), eq(s.type, "exit_signal")),
        });
        if (!existingExitSignal) {
          await db.insert(signals).values({
            id: randomUUID(), companyId: co.id,
            type: "exit_signal",
            title: `⚠️ Possible ${exitTypeLabel} detected — requires confirmation`,
            detail: `${exitValidation.summary} (Confidence: ${Math.round(exitValidation.confidence * 100)}%). Confirm in Pipeline with 🏁 Exit.`,
            severity: "high", isRead: false, date: new Date().toISOString(),
          });
          exitsDetected++;
          signalsAdded++;
          scoreAdjustment += 5;
        }
      }
    }

    // Funding update from title keywords
    if (allTitles.some(t => t.toLowerCase().includes("ronda") || t.toLowerCase().includes("levanta") || t.toLowerCase().includes("millones"))) {
      const { amount, stage } = extractFundingFromTitles(allTitles);
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (amount && amount > (co.lastFundingAmt ?? 0)) {
        updates.lastFundingAmt = amount;
        updates.lastFundingDate = new Date().toISOString().slice(0, 10);
        updates.totalFunding = (co.totalFunding ?? 0) + amount;
        fundingUpdated = true;
      }
      if (stage) updates.fundingStage = stage;
      if (Object.keys(updates).length > 1) {
        await db.update(companies).set(updates as any).where(eq(companies.id, co.id));
      }
    }

    // Apply score delta (clamped 0–100)
    if (scoreAdjustment !== 0) {
      const newScore = Math.min(100, Math.max(0, (co.score ?? 0) + scoreAdjustment));
      await db.update(companies)
        .set({ score: newScore, updatedAt: new Date().toISOString() })
        .where(eq(companies.id, co.id));
    }
  } catch { /* skip failed company silently */ }

  return { company: co.name, newsAdded, signalsAdded, exitsDetected, fundingUpdated };
}

// ── Extraction / scoring types ────────────────────────────────────────────────
type ExtractedCompany = {
  name: string;
  sector: string;
  country: string;
  description: string;
  fundingStage?: string;
  totalFunding?: number;
  thesisScore?: number;
  thesisNote?: string;
};

async function extractCompaniesFromHeadlines(
  headlines: string[],
  existingNames: Set<string>,
  apiKey: string
): Promise<ExtractedCompany[]> {
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

Skip companies that already exist in this list: ${JSON.stringify([...existingNames])}

Headlines:
${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}

Return ONLY a valid JSON array. If no companies found, return [].`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
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

async function scoreAndFilterCompanies(
  candidates: ExtractedCompany[],
  apiKey: string,
  firmThesis: string
): Promise<ExtractedCompany[]> {
  if (!candidates.length) return [];

  const prompt = `You are a senior PE analyst at Pando, a Mexico-focused growth equity fund. Score each candidate against Pando's actual investment policy below.

Pando's Investment Policy:
${firmThesis}

Score each candidate company from 1–10 on thesis fit:
  9–10 → Perfect fit, high priority for pipeline
  7–8  → Strong fit, add to pipeline
  5–6  → Marginal, monitor only
  1–4  → Poor fit, skip

For each company, add:
- "thesisScore": number (1-10)
- "thesisNote": one sentence explaining the score

Return ONLY a JSON array containing companies with thesisScore >= 6 (filter out the rest).

Companies to evaluate:
${JSON.stringify(candidates, null, 2)}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2500,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return candidates;
    const data = await res.json();
    const text: string = data?.content?.[0]?.text ?? "[]";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return candidates;
    return JSON.parse(match[0]);
  } catch { return candidates; }
}

// ── Main cron handler ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const systemApiKey = process.env.ANTHROPIC_API_KEY ?? null;
  const cos = await db.query.companies.findMany();
  const activeCompanies = cos.filter(c => !["public", "acquired", "closed"].includes(c.status));

  // ── Save CronLog at the start with status "running" ───────────────────────
  // If the function times out, the "running" record stays in the DB (visible in the widget)
  const cronLogId = uid();
  await db.insert(cronLogs).values({
    id: cronLogId,
    ranAt: new Date().toISOString(),
    durationMs: null,
    companiesScanned: activeCompanies.length,
    newsAdded: 0,
    signalsAdded: 0,
    exitsDetected: 0,
    fundingUpdates: 0,
    discovered: 0,
    candidatesExtracted: 0,
    filteredByThesis: 0,
    status: "running",
  }).catch(() => {});

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  let totalNews = 0;
  let totalSignals = 0;
  let totalExits = 0;
  let totalFundingUpdates = 0;
  const report: Record<string, unknown>[] = [];

  // ── PHASE 1: Update companies — in parallel batches of 5 ─────────────────
  const BATCH = 5;
  for (let i = 0; i < activeCompanies.length; i += BATCH) {
    const batch = activeCompanies.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(co => processCompany(co, systemApiKey, sevenDaysAgo))
    );
    for (const r of results) {
      totalNews    += r.newsAdded;
      totalSignals += r.signalsAdded;
      totalExits   += r.exitsDetected;
      if (r.fundingUpdated) totalFundingUpdates++;
      report.push({ company: r.company, news: r.newsAdded, signals: r.signalsAdded });
    }
    // Small pause between batches to respect Google News rate limits
    if (i + BATCH < activeCompanies.length) await sleep(500);
  }

  // ── PHASE 2: Discovery with expanded sources + scoring ────────────────────
  let discovered = 0;
  let scored = 0;
  let filteredOut = 0;

  if (systemApiKey) {
    const existingNames = new Set(cos.map(c => c.name.toLowerCase()));
    const existingSlugs = new Set(cos.map(c => c.slug));
    const radarSectors = [...new Set(activeCompanies.map(c => c.sector).filter(Boolean) as string[])];

    const [latamFeedItems, vcHeadlines, signalHeadlines, exitHeadlines] = await Promise.all([
      fetchLatamFeeds(),
      fetchQueriesParallel(VC_QUERIES),
      fetchQueriesParallel([
        ...SIGNAL_QUERIES,
        ...radarSectors.slice(0, 4).map(s => `startup "${s}" latinoamerica ronda inversión 2025`),
      ]),
      fetchQueriesParallel(EXIT_DISCOVERY_QUERIES),
    ]);

    const allHeadlines = [...new Set([
      ...latamFeedItems.map(i => i.title),
      ...vcHeadlines,
      ...signalHeadlines,
      ...exitHeadlines,
    ])];

    const candidates = await extractCompaniesFromHeadlines(allHeadlines, existingNames, systemApiKey);
    const firmThesis = await getFirmThesis();
    const qualified = candidates.length > 0
      ? await scoreAndFilterCompanies(candidates, systemApiKey, firmThesis)
      : [];

    filteredOut = candidates.length - qualified.length;
    scored = candidates.length;

    for (const comp of qualified) {
      if (!comp.name || comp.name.length < 2) continue;
      const slug = comp.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (existingNames.has(comp.name.toLowerCase()) || existingSlugs.has(slug)) continue;

      const descWithNote = comp.thesisNote
        ? `${comp.description} [Thesis: ${comp.thesisNote} Score: ${comp.thesisScore}/10]`
        : comp.description;

      try {
        await db.insert(companies).values({
          id: uid(),
          name: comp.name,
          slug: slug + "-" + uid().slice(0, 4),
          sector: comp.sector ?? null,
          country: comp.country ?? "LATAM",
          description: descWithNote ?? null,
          fundingStage: comp.fundingStage ?? null,
          totalFunding: comp.totalFunding ?? null,
          status: "monitoring",
          score: comp.thesisScore ? Math.round(comp.thesisScore * 10) : 0,
          confidence: comp.thesisScore ? comp.thesisScore / 10 : 0.3,
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

  // ── Update CronLog with final results ─────────────────────────────────────
  const durationMs = Date.now() - startedAt;
  await db.update(cronLogs)
    .set({
      durationMs,
      newsAdded:           totalNews,
      signalsAdded:        totalSignals,
      exitsDetected:       totalExits,
      fundingUpdates:      totalFundingUpdates,
      discovered,
      candidatesExtracted: scored,
      filteredByThesis:    filteredOut,
      status:              "ok",
    })
    .where(eq(cronLogs.id, cronLogId))
    .catch(() => {});

  return NextResponse.json({
    ok: true,
    ran: new Date().toISOString(),
    durationMs,
    companies: activeCompanies.length,
    totalNews,
    totalSignals,
    totalExits,
    totalFundingUpdates,
    discovery: {
      candidatesExtracted: scored,
      filteredByThesis: filteredOut,
      added: discovered,
      enabled: !!systemApiKey,
    },
    report,
  });
}
