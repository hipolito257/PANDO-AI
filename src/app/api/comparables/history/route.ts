import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const YF_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Accept": "application/json",
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tickersParam = req.nextUrl.searchParams.get("tickers");
  if (!tickersParam) return NextResponse.json({ error: "tickers required" }, { status: 400 });

  const tickers = tickersParam.split(",").map(t => t.trim()).filter(Boolean).slice(0, 12);
  const result: Record<string, { date: string; indexed: number }[]> = {};

  await Promise.all(tickers.map(async (ticker) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1y&interval=1mo&includeAdjustedClose=true`;
      const res = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const json = await res.json();
      const r = json?.chart?.result?.[0];
      if (!r) return;

      const timestamps: number[] = r.timestamp ?? [];
      const adjCloses: (number | null)[] = r.indicators?.adjclose?.[0]?.adjclose ?? [];
      const rawCloses: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
      const closes = adjCloses.length ? adjCloses : rawCloses;

      if (!timestamps.length || !closes.length) return;

      // Find first valid price for indexing to 100
      const firstValid = closes.find((c): c is number => c != null);
      if (!firstValid) return;

      result[ticker] = timestamps
        .map((ts, i) => {
          const price = closes[i];
          if (price == null) return null;
          return {
            date: new Date(ts * 1000).toISOString().slice(0, 7), // YYYY-MM
            indexed: Math.round((price / firstValid) * 1000) / 10, // 1 decimal
          };
        })
        .filter((d): d is { date: string; indexed: number } => d !== null);
    } catch {
      // Skip failed tickers silently
    }
  }));

  return NextResponse.json(result);
}
