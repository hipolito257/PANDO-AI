import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cronLogs } from "@/lib/schema";
import { desc } from "drizzle-orm";

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

export async function GET() {
  // Insert a test entry
  const testId = uid();
  await db.insert(cronLogs).values({
    id: testId,
    ranAt: new Date().toISOString(),
    durationMs: 1234,
    companiesScanned: 99,
    newsAdded: 42,
    signalsAdded: 7,
    exitsDetected: 0,
    fundingUpdates: 1,
    discovered: 3,
    candidatesExtracted: 12,
    filteredByThesis: 9,
    status: "ok",
  });

  // Read it back
  const rows = await db.query.cronLogs.findMany({
    orderBy: [desc(cronLogs.ranAt)],
    limit: 5,
  });

  return NextResponse.json({ inserted: testId, rows });
}
