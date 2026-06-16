import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies, newsItems } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ── RSS parser (no external deps) ─────────────────────────────────────────────
function parseRSS(xml: string) {
  const results: { title: string; url: string; date: string; source: string }[] = [];
  const itemRx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1];

    // Title — strip "- Source Name" suffix Google adds
    let title =
      block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ??
      block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    title = title
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/ - [^-]+$/, "")   // strip "- Source Name" at end
      .trim();

    // URL — Google News wraps in a redirect; we store that link
    const url =
      block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ??
      block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1] ?? "";

    // Date
    const rawDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";
    let date = new Date().toISOString();
    try { if (rawDate) date = new Date(rawDate).toISOString(); } catch {}

    // Source publication name
    const source =
      block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ??
      "Google News";

    if (title && url) results.push({ title, url, date, source });
  }
  return results;
}

// ── Sentiment heuristic ───────────────────────────────────────────────────────
function guessSentiment(title: string): "positive" | "negative" | "neutral" {
  const t = title.toLowerCase();
  const pos = ["levanta","ronda","financiamiento","crecimiento","expande","lanza","logra","récord","inversión","alianza","acuerdo","premio","mejor"];
  const neg = ["despidos","caída","quiebra","fraude","demanda","pérdida","cierra","crisis","multa","escándalo","baja","reduce"];
  if (pos.some(w => t.includes(w))) return "positive";
  if (neg.some(w => t.includes(w))) return "negative";
  return "neutral";
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { companyId } = body as { companyId?: string };

  // Which companies to sync?
  const cos = companyId
    ? await db.query.companies.findMany({ where: eq(companies.id, companyId) })
    : await db.query.companies.findMany();

  const report: { company: string; added: number; error?: string }[] = [];

  for (const co of cos) {
    const query = encodeURIComponent(`"${co.name}"`);
    const feedUrl = `https://news.google.com/rss/search?q=${query}&hl=es-419&gl=MX&ceid=MX:es-419`;

    try {
      const res = await fetch(feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PANDOBot/1.0)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml  = await res.text();
      const items = parseRSS(xml).slice(0, 8); // max 8 articles per company
      let added = 0;

      for (const item of items) {
        // Skip if URL already saved
        const exists = await db.query.newsItems.findFirst({ where: eq(newsItems.url, item.url) });
        if (exists) continue;

        await db.insert(newsItems).values({
          id:        uid(),
          companyId: co.id,
          title:     item.title,
          source:    item.source,
          url:       item.url,
          date:      item.date,
          sentiment: guessSentiment(item.title),
        });
        added++;
      }

      report.push({ company: co.name, added });
    } catch (err: any) {
      report.push({ company: co.name, added: 0, error: err.message });
    }
  }

  const totalAdded = report.reduce((s, r) => s + r.added, 0);
  return NextResponse.json({ ok: true, totalAdded, report });
}
