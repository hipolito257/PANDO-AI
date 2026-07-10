import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { financialModels } from "@/lib/schema";
import { desc, eq } from "drizzle-orm";

// GET /api/financial-models?companyId=... — list saved models, optionally filtered by company
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId = req.nextUrl.searchParams.get("companyId");

  const rows = await db.query.financialModels.findMany({
    where: companyId ? eq(financialModels.companyId, companyId) : undefined,
    orderBy: [desc(financialModels.updatedAt)],
  });

  return NextResponse.json(rows.map(r => ({
    id: r.id,
    companyId: r.companyId,
    companyName: r.companyName,
    modelType: r.modelType,
    name: r.name,
    status: r.status,
    workbookUrl: r.workbookUrl,
    workbookSize: r.workbookSize,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })));
}
