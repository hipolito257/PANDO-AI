import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { dueSyncs, runSync } from "@/lib/sheetSync";
import { db, investorSheetSyncs } from "@/lib/db";
import { INVESTOR_SYNC_ID, runInvestorSync } from "@/lib/investorSheet";

export const maxDuration = 120;

// Daily: reads every connected sheet whose frequency (daily / weekly / monthly) is due.
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results = [];
  for (const s of await dueSyncs()) results.push({ syncId: s.id, ...(await runSync(s.id, "cron")) });
  // Fundraising: the investors sheet, once a day.
  let fundraising: unknown = null;
  const [inv] = await db.select({ frequency: investorSheetSyncs.frequency }).from(investorSheetSyncs)
    .where(eq(investorSheetSyncs.id, INVESTOR_SYNC_ID)).limit(1).catch(() => []);
  if (inv?.frequency === "daily") {
    fundraising = await runInvestorSync("cron").then(s => ({ created: s.created, updated: s.updated, contacts: s.contacts }))
      .catch(e => ({ error: e instanceof Error ? e.message : "failed" }));
  }
  return NextResponse.json({ ran: results.length, results, fundraising });
}
