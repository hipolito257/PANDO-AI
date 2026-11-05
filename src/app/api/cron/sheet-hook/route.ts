import { NextRequest, NextResponse, after } from "next/server";
import { timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db, sheetSyncs } from "@/lib/db";
import { runSync } from "@/lib/sheetSync";

export const maxDuration = 90;

// Waits for edits to settle so typing a row triggers one reading, not twenty.
const SETTLE_MS = 20_000;

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// POST — called by the Apps Script trigger in the Google Sheet whenever it's edited
// ("Immediate" frequency). Authenticated by the connection's own token, since
// Google can't carry a platform session. Lives under /api/cron to skip the login check.
export async function POST(req: NextRequest) {
  const token = req.headers.get("x-pando-token") ?? "";
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const syncs = await db.select({ id: sheetSyncs.id, hookToken: sheetSyncs.hookToken, frequency: sheetSyncs.frequency }).from(sheetSyncs);
  const sync = syncs.find(s => safeEqual(s.hookToken, token));
  if (!sync) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sync.frequency !== "immediate") return NextResponse.json({ skipped: "Immediate sync is off for this sheet" });

  const receivedAt = Date.now();
  after(async () => {
    await new Promise(r => setTimeout(r, SETTLE_MS));
    const [s] = await db.select({ lastRunAt: sheetSyncs.lastRunAt }).from(sheetSyncs).where(eq(sheetSyncs.id, sync.id)).limit(1);
    // A reading that started after this edit already includes it.
    if (s?.lastRunAt && new Date(s.lastRunAt).getTime() > receivedAt) return;
    await runSync(sync.id, "hook");
  });
  return NextResponse.json({ queued: true });
}
