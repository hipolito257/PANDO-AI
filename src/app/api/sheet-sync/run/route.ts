import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, sheetSyncs } from "@/lib/db";
import { runSync } from "@/lib/sheetSync";

export const maxDuration = 60;

// POST — read the sheet now ("Sync now")
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sync = (await db.select({ id: sheetSyncs.id }).from(sheetSyncs).limit(1))[0];
  if (!sync) return NextResponse.json({ error: "No sheet connected" }, { status: 404 });
  const r = await runSync(sync.id, "manual");
  return NextResponse.json(r, { status: r.status === "error" ? 400 : 200 });
}
