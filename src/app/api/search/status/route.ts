import { NextRequest, NextResponse } from "next/server";
import { sql, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, companies, companyFiles } from "@/lib/db";
import { indexStatus } from "@/lib/docIndex";

// GET ?companyId= — how many documents are searchable, whether indexing is
// running, and the companies that have documents (for the scope filter).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [status, withDocs] = await Promise.all([
    indexStatus(req.nextUrl.searchParams.get("companyId")),
    db.select({ id: companies.id, name: companies.name, files: sql<number>`count(*)::int` })
      .from(companyFiles).innerJoin(companies, eq(companies.id, companyFiles.companyId))
      .groupBy(companies.id, companies.name).orderBy(companies.name),
  ]);
  return NextResponse.json({ ...status, companies: withDocs });
}
