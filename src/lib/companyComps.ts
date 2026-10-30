// Adds public comparables to a company's comp set (the one the Comparables
// page shows), used when comps are found in the company's documents.
import { db, compSets, publicComps } from "@/lib/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

type Quote = { ticker: string; name: string; exchange: string };

async function yahooSearch(q: string): Promise<Quote[]> {
  const res = await fetch(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0`,
    { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, signal: AbortSignal.timeout(6000) },
  );
  if (!res.ok) throw new Error(`Yahoo search ${res.status}`);
  const data = await res.json();
  return (data.quotes ?? [])
    .filter((x: { quoteType?: string }) => x.quoteType === "EQUITY")
    .map((x: { symbol: string; longname?: string; shortname?: string; exchDisp?: string; exchange?: string }) => ({
      ticker: x.symbol, name: x.longname ?? x.shortname ?? x.symbol, exchange: x.exchDisp ?? x.exchange ?? "",
    }));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Finds the listed security for a comparable named in a document. Uses the
 * stated ticker when Yahoo confirms it, otherwise searches by name and takes
 * the top equity match whose name resembles it. Null when nothing credible.
 */
export async function resolveTicker(name: string, ticker: string, exchange = ""): Promise<Quote | null> {
  const t = ticker.trim().toUpperCase();
  try {
    if (t) {
      const hit = (await yahooSearch(t)).find(q => q.ticker.toUpperCase() === t);
      if (hit) return hit;
    }
    const quotes = await yahooSearch(name);
    const key = norm(name).slice(0, 6);
    return quotes.find(q => key && norm(q.name).includes(key)) ?? null;
  } catch {
    // Yahoo unreachable: trust an explicit ticker, skip the rest.
    return t ? { ticker: t, name, exchange } : null;
  }
}

/** Adds tickers to the company's comp set (creating it if needed). Returns the tickers newly added. */
export async function addCompsToCompany(
  companyId: string,
  companyName: string,
  comps: { quote: Quote; note: string }[],
): Promise<string[]> {
  if (!comps.length) return [];
  for (const { quote } of comps) {
    const existing = await db.query.publicComps.findFirst({ where: eq(publicComps.ticker, quote.ticker) });
    if (!existing) {
      await db.insert(publicComps).values({ id: randomUUID(), ticker: quote.ticker, name: quote.name, exchange: quote.exchange || null });
    }
  }

  let set = await db.query.compSets.findFirst({ where: eq(compSets.companyId, companyId) });
  if (!set) {
    const id = randomUUID();
    await db.insert(compSets).values({ id, name: `${companyName} — Comparables`, companyId, tickers: "[]" });
    set = await db.query.compSets.findFirst({ where: eq(compSets.id, id) });
  }
  if (!set) return [];

  const tickers: string[] = JSON.parse(set.tickers || "[]");
  const descs: Record<string, { reason: string; businessModel: string; similarity: string }> =
    set.aiDescriptions ? JSON.parse(set.aiDescriptions) : {};
  const added: string[] = [];
  for (const { quote, note } of comps) {
    if (!tickers.includes(quote.ticker)) {
      tickers.push(quote.ticker);
      added.push(quote.ticker);
    }
    if (!descs[quote.ticker]) descs[quote.ticker] = { reason: note, businessModel: "", similarity: "From company documents" };
  }
  try {
    await db.update(compSets)
      .set({ tickers: JSON.stringify(tickers), aiDescriptions: JSON.stringify(descs) })
      .where(eq(compSets.id, set.id));
  } catch {
    // Older databases may lack aiDescriptions; the tickers are what matter.
    await db.update(compSets).set({ tickers: JSON.stringify(tickers) }).where(eq(compSets.id, set.id));
  }
  return added;
}
