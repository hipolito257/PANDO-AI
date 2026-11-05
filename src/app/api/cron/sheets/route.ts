import { NextRequest, NextResponse } from "next/server";
import { dueSyncs, runSync } from "@/lib/sheetSync";

export const maxDuration = 120;

// Daily: reads every connected sheet whose frequency (daily / weekly / monthly) is due.
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results = [];
  for (const s of await dueSyncs()) results.push({ syncId: s.id, ...(await runSync(s.id, "cron")) });
  return NextResponse.json({ ran: results.length, results });
}
