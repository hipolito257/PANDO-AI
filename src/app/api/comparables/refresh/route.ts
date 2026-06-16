import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicComps } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { eq, inArray } from "drizzle-orm";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const YF_HEADERS = { "User-Agent": UA, "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9" };

// Yahoo Finance requires a crumb (CSRF token) since 2024.
// Flow: 1) fetch fc.yahoo.com to get cookies, 2) get crumb, 3) use crumb in API calls
async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  try {
    // Step 1: Get cookies — cache: "no-store" prevents Next.js from returning a
    // cached response that has no Set-Cookie headers.
    const consentRes = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });

    // getSetCookie() returns ALL Set-Cookie headers as an array (Node 18+)
    const setCookies: string[] = (consentRes.headers as any).getSetCookie?.() ??
      (consentRes.headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/).map((s: string) => s.trim());

    const cookieMap: Record<string, string> = {};
    for (const header of setCookies) {
      const m = header.match(/^([^=]+)=([^;]*)/);
      if (m) cookieMap[m[1].trim()] = m[2].trim();
    }
    const cookieStr = Object.entries(cookieMap)
      .filter(([k]) => ["A1","A3","A1S"].includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");

    if (!cookieStr) return null;

    // Step 2: Get crumb — must use Accept: */* (not application/json, causes 406)
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, "Accept": "*/*", "Cookie": cookieStr },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!crumbRes.ok) return null;
    const crumb = await crumbRes.text();
    if (!crumb || crumb.startsWith("{") || crumb.length > 30) return null;

    return { crumb, cookie: cookieStr };
  } catch {
    return null;
  }
}

async function fetchYahoo(ticker: string, crumb: string, cookie: string) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=defaultKeyStatistics,financialData,summaryDetail&crumb=${encodeURIComponent(crumb)}`;
  const res = await fetch(url, {
    headers: { ...YF_HEADERS, "Cookie": cookie },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status} for ${ticker}`);
  const json = await res.json();
  const r = json?.quoteSummary?.result?.[0];
  if (!r) {
    const err = json?.quoteSummary?.error;
    throw new Error(`No data for ${ticker}: ${err?.description ?? "unknown"}`);
  }

  const ks = r.defaultKeyStatistics ?? {};
  const fd = r.financialData ?? {};
  const sd = r.summaryDetail ?? {};

  const rev   = fd.totalRevenue?.raw ?? null;
  const ebitda = fd.ebitda?.raw ?? null;

  return {
    marketCapUsd:    sd.marketCap?.raw ?? null,
    evUsd:           ks.enterpriseValue?.raw ?? null,
    revenueUsd:      rev,
    ebitdaUsd:       ebitda,
    revenueGrowth:   fd.revenueGrowth?.raw ?? null,
    grossMargin:     fd.grossMargins?.raw ?? null,
    ebitdaMargin:    rev && ebitda ? ebitda / rev : null,
    operatingMargin: fd.operatingMargins?.raw ?? null,
    netMargin:       fd.profitMargins?.raw ?? null,
    fcfUsd:          fd.freeCashflow?.raw ?? null,
    evRevenue:       ks.enterpriseToRevenue?.raw ?? null,
    evEbitda:        ks.enterpriseToEbitda?.raw ?? null,
    peRatio:         sd.trailingPE?.raw ?? ks.forwardPE?.raw ?? null,
    psRatio:         ks.priceToSalesTrailing12Months?.raw ?? null,
    pbRatio:         ks.priceToBook?.raw ?? null,
    roe:             fd.returnOnEquity?.raw ?? null,
    debtToEquity:    fd.debtToEquity?.raw ?? null,
    beta:            sd.beta?.raw ?? ks.beta?.raw ?? null,
    lastRefreshed:   new Date().toISOString(),
  };
}

// POST — refresh Yahoo Finance data for a list of tickers
// Body: { tickers: string[] }
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tickers } = await req.json() as { tickers: string[] };
  if (!tickers?.length) return NextResponse.json({ error: "tickers required" }, { status: 400 });

  // Get Yahoo Finance crumb (required since 2024)
  const auth2 = await getYahooCrumb();
  if (!auth2) {
    return NextResponse.json({ error: "Could not obtain Yahoo Finance crumb", report: [], updated: [] }, { status: 502 });
  }

  const report: { ticker: string; ok: boolean; error?: string }[] = [];

  for (const ticker of tickers) {
    try {
      const data = await fetchYahoo(ticker, auth2.crumb, auth2.cookie);
      const existing = await db.query.publicComps.findFirst({ where: eq(publicComps.ticker, ticker) });
      if (existing) {
        await db.update(publicComps).set(data as any).where(eq(publicComps.ticker, ticker));
      }
      report.push({ ticker, ok: true });
    } catch (e: any) {
      report.push({ ticker, ok: false, error: e.message });
    }
  }

  const updated = await db.query.publicComps.findMany({ where: inArray(publicComps.ticker, tickers) });
  return NextResponse.json({ report, updated });
}
