import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { auth } from "@/lib/auth";

const BLOB_STORE_ID =
  process.env.BLOBPUBLIC_STORE_ID ?? process.env.BLOB_STORE_ID ?? "";

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

  try {
    const blob = await put(
      `temp-chunks/${uploadId}/${chunkIdx}`,
      buf,
      { access: "public", addRandomSuffix: false, storeId: BLOB_STORE_ID },
    );
    return NextResponse.json({ chunkUrl: blob.url });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error("[templates/chunk] put() error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
