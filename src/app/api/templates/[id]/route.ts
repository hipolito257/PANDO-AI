import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentTemplates } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { del } from "@vercel/blob";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const row = await db.query.documentTemplates.findFirst({
    where: (t, { eq }) => eq(t.id, id),
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Delete file
  if (row.filePath.startsWith("http")) {
    // Vercel Blob URL
    await del(row.filePath);
  } else if (row.filePath.startsWith("local:")) {
    // Local dev filesystem
    const path = await import("path");
    const fs   = await import("fs");
    const filename = row.filePath.replace("local:", "");
    const fullPath = path.join(process.cwd(), "uploads", "templates", filename);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }

  await db.delete(documentTemplates).where(eq(documentTemplates.id, id));
  return NextResponse.json({ ok: true });
}
