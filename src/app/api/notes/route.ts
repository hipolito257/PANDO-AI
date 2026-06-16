import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notes } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId = req.nextUrl.searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  const rows = await db.query.notes.findMany({
    where: eq(notes.companyId, companyId),
    orderBy: [desc(notes.createdAt)],
  });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { companyId, content, authorName } = await req.json();
  if (!companyId || !content?.trim()) {
    return NextResponse.json({ error: "companyId and content required" }, { status: 400 });
  }

  const id = uid();
  await db.insert(notes).values({
    id,
    companyId,
    content: content.trim(),
    authorName: authorName ?? session.user?.name ?? "Equipo PANDO",
  });

  const note = await db.query.notes.findFirst({ where: eq(notes.id, id) });
  return NextResponse.json(note, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await db.delete(notes).where(eq(notes.id, id));
  return NextResponse.json({ ok: true });
}
