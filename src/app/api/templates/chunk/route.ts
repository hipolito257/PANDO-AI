import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { auth } from "@/lib/auth";

// Receives one chunk (≤3 MB) and stores it in Vercel Blob as a temp file.
// Returns the blob URL for that chunk.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const fd = await req.formData();
  const chunkFile = fd.get("chunk") as File | null;
  const uploadId  = fd.get("uploadId")    as string | null;
  const chunkIdx  = fd.get("chunkIndex")  as string | null;
  const filename  = fd.get("filename")    as string | null;

  if (!chunkFile || !uploadId || chunkIdx === null || !filename) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const buf = Buffer.from(await chunkFile.arrayBuffer());

  // Store chunk as a temp blob: temp-chunks/{uploadId}/{index}
  const blob = await put(
    `temp-chunks/${uploadId}/${chunkIdx}`,
    buf,
    { access: "public", addRandomSuffix: false },
  );

  return NextResponse.json({ chunkUrl: blob.url });
}
