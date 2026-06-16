import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { activityLog } from "@/lib/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.query.activityLog.findMany({
    orderBy: [desc(activityLog.createdAt)],
    limit: 100,
  });

  return NextResponse.json(rows);
}
