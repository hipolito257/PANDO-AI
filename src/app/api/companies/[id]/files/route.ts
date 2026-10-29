import { NextRequest, NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { db, companies, companyFiles, activityLog } from "@/lib/db";
import { auth } from "@/lib/auth";
import { encryptBuffer, decryptBuffer } from "@/lib/blobCrypto";
import { SUPPORTED_EXTS, LEGACY_EXTS } from "@/lib/companyFileExtract";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

export const maxDuration = 60;

const BLOB_STORE_ID = process.env.BLOBPUBLIC_STORE_ID ?? process.env.BLOB_STORE_ID ?? "";

// Never expose blobUrl to the browser; downloads go through /files/[fileId].
function toClient(f: typeof companyFiles.$inferSelect) {
  const { blobUrl: _omit, extraction, ...rest } = f; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...rest, extraction: extraction ? JSON.parse(extraction) : null };
}

// GET /api/companies/[id]/files — files uploaded to this company
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  try {
    const rows = await db.query.companyFiles.findMany({
      where: eq(companyFiles.companyId, id),
      orderBy: [desc(companyFiles.createdAt)],
    });
    return NextResponse.json(rows.map(toClient));
  } catch (err) {
    console.error("[company files GET]", err);
    return NextResponse.json({ error: "Failed to load files" }, { status: 500 });
  }
}

// POST /api/companies/[id]/files — assemble the encrypted chunks uploaded via
// /api/documents/translate/upload-chunk into one encrypted blob and register it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const { chunkUrls, filename } = (await req.json().catch(() => ({}))) as { chunkUrls?: string[]; filename?: string };
  if (!chunkUrls?.length || !filename) return NextResponse.json({ error: "Missing chunkUrls or filename" }, { status: 400 });

  // Only accept chunks this user just uploaded to our own store.
  const ownPrefix = `/translate-uploads/${session.user.id}/`;
  if (!chunkUrls.every(u => { try { return new URL(u).pathname.startsWith(ownPrefix); } catch { return false; } })) {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (LEGACY_EXTS[ext]) return NextResponse.json({ error: `.${ext} files can't be read. Save it as ${LEGACY_EXTS[ext]} and upload again.` }, { status: 400 });
  if (!SUPPORTED_EXTS.includes(ext)) return NextResponse.json({ error: `Unsupported file type .${ext}. Use PDF, PPTX, XLSX, DOCX, CSV, TXT or an image.` }, { status: 400 });

  const company = await db.query.companies.findFirst({ where: eq(companies.id, id) });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  try {
    const buffers = await Promise.all(chunkUrls.map(async url => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Could not read an uploaded chunk");
      return decryptBuffer(Buffer.from(await res.arrayBuffer()));
    }));
    const assembled = Buffer.concat(buffers);

    const fileId = randomUUID();
    const blob = await put(`company-files/${id}/${fileId}.${ext}.enc`, encryptBuffer(assembled), {
      access: "public", addRandomSuffix: false, storeId: BLOB_STORE_ID,
    } as Parameters<typeof put>[2]);
    del(chunkUrls, { storeId: BLOB_STORE_ID } as Parameters<typeof del>[1]).catch(() => {});

    const row = {
      id: fileId,
      companyId: id,
      filename,
      ext,
      sizeBytes: assembled.length,
      blobUrl: blob.url,
      uploadedBy: session.user.id,
      uploadedByName: session.user.name ?? session.user.email ?? "User",
      createdAt: new Date().toISOString(),
    };
    await db.insert(companyFiles).values(row);

    try {
      await db.insert(activityLog).values({
        id: randomUUID(), userId: session.user.id, userName: row.uploadedByName,
        action: "uploaded_company_file", entityType: "company", entityId: id, entityName: company.name, detail: filename,
      });
    } catch { /* non-blocking */ }

    const saved = await db.query.companyFiles.findFirst({ where: eq(companyFiles.id, fileId) });
    return NextResponse.json(toClient(saved!), { status: 201 });
  } catch (err) {
    console.error("[company files POST]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 });
  }
}
