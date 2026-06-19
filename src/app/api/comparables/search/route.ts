import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicComps } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// GET — search Yahoo Finance for a ticker and optionally add to PublicComp
// ?q=TWLO  or  ?q=twilio
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json([]);

  const res = await fetch(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`,
    { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }, signal: AbortSignal.timeout(6000) }
  );

  if (!res.ok) return NextResponse.json({ error: "Yahoo Finance search failed" }, { status: 500 });

  const data = await res.json();
  const quotes = (data.quotes ?? [])
    .filter((q: any) => q.quoteType === "EQUITY")
    .slice(0, 8)
    .map((q: any) => ({
      ticker:    q.symbol,
      name:      q.longname ?? q.shortname ?? q.symbol,
      exchange:  q.exchDisp ?? q.exchange ?? "",
      sector:    q.sector ?? null,
    }));

  return NextResponse.json(quotes);
}

// POST — add a public comp to the DB (called before refresh)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker, name, exchange, sector, description, website } = await req.json();
  if (!ticker || !name) return NextResponse.json({ error: "ticker and name required" }, { status: 400 });

  const existing = await db.query.publicComps.findFirst({ where: eq(publicComps.ticker, ticker) });
  if (existing) {
    // Backfill website if we now have it and it was missing
    if (website && !existing.website) {
      await db.update(publicComps).set({ website } as any).where(eq(publicComps.ticker, ticker));
    }
    return NextResponse.json({ ...existing, website: website ?? existing.website });
  }

  const id = uid();
  await db.insert(publicComps).values({ id, ticker, name, exchange: exchange ?? null, sector: sector ?? null, description: description ?? null, website: website ?? null } as any);
  const created = await db.query.publicComps.findFirst({ where: eq(publicComps.ticker, ticker) });
  return NextResponse.json(created, { status: 201 });
}
