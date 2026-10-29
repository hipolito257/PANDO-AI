import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { db, companyFiles } from "@/lib/db";
import { auth } from "@/lib/auth";
import { decryptBuffer } from "@/lib/blobCrypto";
import { and, eq } from "drizzle-orm";

export const maxDuration = 60;

const BLOB_STORE_ID = process.env.BLOBPUBLIC_STORE_ID ?? process.env.BLOB_STORE_ID ?? "";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv", txt: "text/plain",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};

async function findFile(companyId: string, fileId: string) {
  return db.query.companyFiles.findFirst({
    where: and(eq(companyFiles.id, fileId), eq(companyFiles.companyId, companyId)),
  });
}

// GET — download the decrypted original
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, fileId } = await params;

  const file = await findFile(id, fileId);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const res = await fetch(file.blobUrl);
    if (!res.ok) throw new Error(`Blob fetch failed (${res.status})`);
    const buffer = decryptBuffer(Buffer.from(await res.arrayBuffer()));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": CONTENT_TYPES[file.ext] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[company file GET]", err);
    return NextResponse.json({ error: "Could not download file" }, { status: 500 });
  }
}

// DELETE — remove the file and its blob
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, fileId } = await params;

  const file = await findFile(id, fileId);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.delete(companyFiles).where(eq(companyFiles.id, fileId));
  del(file.blobUrl, { storeId: BLOB_STORE_ID } as Parameters<typeof del>[1]).catch(() => {});
  return NextResponse.json({ ok: true });
}
