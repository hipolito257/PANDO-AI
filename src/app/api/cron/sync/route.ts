import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies, newsItems, signals } from "@/lib/schema";
import { randomUUID } from "crypto";

// Vercel Cron Job — runs on schedule defined in vercel.json
// This endpoint is protected by CRON_SECRET to prevent unauthorized calls

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

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

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cos = await db.query.companies.findMany();
  const report: { company: string; news: number; signals: number }[] = [];
  let totalNews = 0;
  let totalSignals = 0;

  for (const co of cos) {
    let newsAdded = 0;
    let signalsAdded = 0;

    // ── Google News RSS ────────────────────────────────────────────────────────
    try {
      const query = encodeURIComponent(`"${co.name}"`);
      const feedUrl = `https://news.google.com/rss/search?q=${query}&hl=es-419&gl=MX&ceid=MX:es-419`;
      const res = await fetch(feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PANDOBot/1.0)" },
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const xml = await res.text();
        const items = parseRSS(xml).slice(0, 5);

        for (const item of items) {
          const exists = await db.query.newsItems.findFirst({ where: (n, { eq }) => eq(n.url, item.url) });
          if (exists) continue;

          await db.insert(newsItems).values({
            id: uid(), companyId: co.id,
            title: item.title, source: item.source, url: item.url,
            date: item.date, sentiment: guessSentiment(item.title),
          });
          newsAdded++;

          // Auto-generate signal if title indicates important event
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
      }
    } catch { /* skip failed companies */ }

    report.push({ company: co.name, news: newsAdded, signals: signalsAdded });
    totalNews += newsAdded;
    totalSignals += signalsAdded;
  }

  return NextResponse.json({
    ok: true,
    ran: new Date().toISOString(),
    companies: cos.length,
    totalNews,
    totalSignals,
    report,
  });
}
