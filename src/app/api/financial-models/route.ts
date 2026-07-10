import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { financialModels } from "@/lib/schema";
import { desc } from "drizzle-orm";
import { randomUUID } from "crypto";

// GET /api/financial-models — flat, shared library list (no company scoping)
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.query.financialModels.findMany({
    orderBy: [desc(financialModels.createdAt)],
  });

  return NextResponse.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    status: r.status,
    workbookUrl: r.workbookUrl,
    workbookSize: r.workbookSize,
    createdAt: r.createdAt,
  })));
}

// POST — register a manually uploaded workbook (already blob-uploaded via the
// generic chunk-upload endpoints) as a shared library entry.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as {
    name?: string; fileUrl?: string; fileSize?: number;
  } | null;
  if (!body?.name?.trim() || !body?.fileUrl) {
    return NextResponse.json({ error: "name and fileUrl are required" }, { status: 400 });
  }

  const id = randomUUID();
  await db.insert(financialModels).values({
    id,
    companyId: null,
    companyName: null,
    modelType: "lbo",
    name: body.name.trim(),
    status: "uploaded",
    assumptions: "{}",
    contextFiles: "[]",
    workbookUrl: body.fileUrl,
    workbookSize: body.fileSize ?? null,
    createdBy: session.user.id,
    updatedBy: session.user.id,
  });
  return NextResponse.json({ success: true, id });
}
