import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentLibrary } from "@/lib/schema";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// GET /api/document-library?docType=presentation|twopager — flat, shared across all users
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const docType = req.nextUrl.searchParams.get("docType");
  const rows = await db.query.documentLibrary.findMany({
    where: docType ? eq(documentLibrary.docType, docType) : undefined,
    orderBy: [desc(documentLibrary.createdAt)],
  });
  return NextResponse.json(rows);
}

// POST — register an already-uploaded blob (file itself goes through the
// generic chunk-upload endpoints) as a named library entry.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as {
    docType?: string; name?: string; fileUrl?: string; fileSize?: number;
  } | null;
  if (!body?.docType || !body?.name?.trim() || !body?.fileUrl) {
    return NextResponse.json({ error: "docType, name and fileUrl are required" }, { status: 400 });
  }

  const id = randomUUID();
  await db.insert(documentLibrary).values({
    id,
    docType: body.docType,
    name: body.name.trim(),
    fileUrl: body.fileUrl,
    fileSize: body.fileSize ?? null,
    createdBy: session.user.id,
  });
  return NextResponse.json({ success: true, id });
}
