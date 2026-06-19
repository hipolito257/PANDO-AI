import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicComps } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { eq, inArray } from "drizzle-orm";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Yahoo Finance auth (crumb + cookie) ──────────────────────────────────────
// Yahoo requires a crumb since 2024. We get it fresh before each ticker to
// avoid stale-crumb failures when processing many tickers.
async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  // Try two consent endpoints — Yahoo A/B tests these
  const consentUrls = ["https://fc.yahoo.com", "https://consent.yahoo.com"];

  for (const url of consentUrls) {
    try {
      const consentRes = await fetch(url, {
        headers: { "User-Agent": UA },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
      });

      const setCookies: string[] =
        (consentRes.headers as any).getSetCookie?.() ??
        (consentRes.headers.get("set-cookie") ?? "")
          .split(/,(?=\s*\w+=)/)
          .map((s: string) => s.trim());

      const cookieMap: Record<string, string> = {};
      for (const h of setCookies) {
        const m = h.match(/^([^=]+)=([^;]*)/);
        if (m) cookieMap[m[1].trim()] = m[2].trim();
      }

      // Accept any cookie — Yahoo sometimes sends just "A1" or just "A3"
      const cookieStr = Object.entries(cookieMap)
        .filter(([k]) => /^A[0-9S]/.test(k))
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");

      if (!cookieStr) continue;

      // Try both query hosts for the crumb
      for (const qhost of ["query1", "query2"]) {
        try {
          const crumbRes = await fetch(
            `https://${qhost}.finance.yahoo.com/v1/test/getcrumb`,
            {
              headers: { "User-Agent": UA, Accept: "*/*", Cookie: cookieStr },
              cache: "no-store",
              signal: AbortSignal.timeout(8000),
            }
          );
          if (!crumbRes.ok) continue;
          const crumb = (await crumbRes.text()).trim();
          if (!crumb || crumb.startsWith("{") || crumb.length > 50) continue;
          return { crumb, cookie: cookieStr };
        } catch { /* try next */ }
      }
    } catch { /* try next consent url */ }
  }
  return null;
}

// ── Fetch one ticker from Yahoo Finance quoteSummary ─────────────────────────
async function fetchYahoo(ticker: string, crumb: string, cookie: string) {
  // Try both query hosts to work around occasional 401/429 from one host
  const hosts = ["query1", "query2"];
  let lastErr = new Error("No response");

  for (const host of hosts) {
    try {
      const url =
        `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
        `?modules=defaultKeyStatistics,financialData,summaryDetail,assetProfile` +
        `&crumb=${encodeURIComponent(crumb)}`;

      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": "en-US,en;q=0.9", Cookie: cookie },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });

      if (res.status === 429) throw new Error(`RATE_LIMIT`);
      if (res.status === 401 || res.status === 403) throw new Error(`AUTH_FAILED`);
      if (!res.ok) throw new Error(`HTTP_${res.status}`);

      const json = await res.json();
      const r = json?.quoteSummary?.result?.[0];
      if (!r) {
        const desc = json?.quoteSummary?.error?.description ?? "no result";
        throw new Error(`NO_DATA: ${desc}`);
      }

      const ks = r.defaultKeyStatistics ?? {};
      const fd = r.financialData ?? {};
      const sd = r.summaryDetail ?? {};
      const ap = r.assetProfile ?? {};

      const rev    = fd.totalRevenue?.raw ?? null;
      const ebitda = fd.ebitda?.raw ?? null;

      return {
        marketCapUsd:    sd.marketCap?.raw ?? null,
        evUsd:           ks.enterpriseValue?.raw ?? null,
        revenueUsd:      rev,
        ebitdaUsd:       ebitda,
        revenueGrowth:   fd.revenueGrowth?.raw ?? null,
        grossMargin:     fd.grossMargins?.raw ?? null,
        ebitdaMargin:    rev && ebitda ? ebitda / rev : (fd.ebitdaMargins?.raw ?? null),
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
        website:         ap.website ?? null,
        description:     ap.longBusinessSummary ?? null,
        lastRefreshed:   new Date().toISOString(),
      };
    } catch (e: any) {
      lastErr = e;
      if (e.message === "RATE_LIMIT" || e.message === "AUTH_FAILED") break; // no point trying other host
    }
  }
  throw lastErr;
}

// ── Fetch with retry + fresh crumb on auth failures ──────────────────────────
async function fetchWithRetry(
  ticker: string,
  initialAuth: { crumb: string; cookie: string }
): Promise<{ data: Awaited<ReturnType<typeof fetchYahoo>>; ticker: string }> {
  let auth2 = initialAuth;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const data = await fetchYahoo(ticker, auth2.crumb, auth2.cookie);
      return { ticker, data };
    } catch (e: any) {
      const isAuthErr = e.message === "AUTH_FAILED" || e.message?.includes("AUTH");
      const isRateLimit = e.message === "RATE_LIMIT";

      if (attempt === maxAttempts) throw e;

      if (isAuthErr || isRateLimit) {
        // Get a completely fresh crumb before retrying
        await sleep(isRateLimit ? 3000 : 800);
        const fresh = await getYahooCrumb();
        if (fresh) auth2 = fresh;
      } else {
        await sleep(600 * attempt);
      }
    }
  }
  throw new Error("Max retries exceeded");
}

// ── POST /api/comparables/refresh ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tickers } = (await req.json()) as { tickers: string[] };
  if (!tickers?.length) return NextResponse.json({ error: "tickers required" }, { status: 400 });

  // Get initial crumb — shared across tickers, refreshed on auth failures
  let initialAuth = await getYahooCrumb();
  if (!initialAuth) {
    // One retry for the crumb itself
    await sleep(1500);
    initialAuth = await getYahooCrumb();
  }
  if (!initialAuth) {
    return NextResponse.json(
      { error: "Could not obtain Yahoo Finance session — try again in a minute", report: [], updated: [] },
      { status: 502 }
    );
  }

  const report: { ticker: string; ok: boolean; error?: string }[] = [];

  for (const ticker of tickers) {
    try {
      const { data } = await fetchWithRetry(ticker, initialAuth);

      const existing = await db.query.publicComps.findFirst({
        where: eq(publicComps.ticker, ticker),
      });
      if (existing) {
        await db.update(publicComps).set(data as any).where(eq(publicComps.ticker, ticker));
      }
      report.push({ ticker, ok: true });
    } catch (e: any) {
      const msg: string = e.message ?? "unknown";
      // Classify error for the user
      const friendly = msg.startsWith("NO_DATA")
        ? "sin datos en Yahoo Finance"
        : msg === "RATE_LIMIT"
        ? "rate limit — intenta de nuevo"
        : msg === "AUTH_FAILED"
        ? "error de autenticación"
        : msg.startsWith("HTTP_404")
        ? "ticker no encontrado"
        : msg;
      report.push({ ticker, ok: false, error: friendly });
    }

    // Polite delay between requests to reduce rate-limit risk
    await sleep(400);
  }

  // Return updated rows (with fallback for missing columns)
  let updated: any[] = [];
  try {
    updated = await db.query.publicComps.findMany({
      where: inArray(publicComps.ticker, tickers),
    });
  } catch { updated = []; }

  return NextResponse.json({ report, updated });
}
