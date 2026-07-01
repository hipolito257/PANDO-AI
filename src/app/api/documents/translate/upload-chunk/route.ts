import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { auth } from "@/lib/auth";

const BLOB_STORE_ID = process.env.BLOBPUBLIC_STORE_ID ?? process.env.BLOB_STORE_ID ?? "";

// Dedicated (private) chunk-upload endpoint for the translator, kept separate
// from /api/templates/chunk because translated documents can be confidential
// legal/financial files — everything here is stored with access: "private",
// never publicly reachable by URL.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const fd = await req.formData();
  const chunkFile = fd.get("chunk") as File | null;
  const uploadId  = fd.get("uploadId")   as string | null;
  const chunkIdx  = fd.get("chunkIndex") as string | null;

  if (!chunkFile || !uploadId || chunkIdx === null) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const buf = Buffer.from(await chunkFile.arrayBuffer());

  try {
    const blob = await put(
      `translate-uploads/${session.user.id}/${uploadId}/${chunkIdx}`,
      buf,
      { access: "private", addRandomSuffix: false, allowOverwrite: true, storeId: BLOB_STORE_ID },
    );
    return NextResponse.json({ chunkUrl: blob.url });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error("[translate/upload-chunk] put() error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
