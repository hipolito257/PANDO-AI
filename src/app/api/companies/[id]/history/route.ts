import { NextRequest, NextResponse } from "next/server";
import { db, fieldChanges } from "@/lib/db";
import { auth } from "@/lib/auth";
import { desc, eq } from "drizzle-orm";

// GET — the change history of a company's data points, newest first.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const limit = Math.min(1000, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 500)));
  const rows = await db.select().from(fieldChanges)
    .where(eq(fieldChanges.companyId, id))
    .orderBy(desc(fieldChanges.createdAt))
    .limit(limit);
  return NextResponse.json({ changes: rows });
}
