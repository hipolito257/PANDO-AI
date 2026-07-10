import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { financialModels } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { del } from "@vercel/blob";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const row = await db.query.financialModels.findFirst({ where: (m, { eq }) => eq(m.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    ...row,
    assumptions: JSON.parse(row.assumptions),
    contextFiles: JSON.parse(row.contextFiles ?? "[]"),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const row = await db.query.financialModels.findFirst({ where: (m, { eq }) => eq(m.id, id) });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (row.workbookUrl?.startsWith("http")) {
    await del(row.workbookUrl).catch(() => {});
  }
  await db.delete(financialModels).where(eq(financialModels.id, id));
  return NextResponse.json({ ok: true });
}
