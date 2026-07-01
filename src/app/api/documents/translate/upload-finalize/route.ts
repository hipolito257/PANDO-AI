import { NextRequest, NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { encryptBuffer, decryptBuffer } from "@/lib/blobCrypto";

const BLOB_STORE_ID = process.env.BLOBPUBLIC_STORE_ID ?? process.env.BLOB_STORE_ID ?? "";

// Assembles the encrypted chunk blobs from /upload-chunk into one encrypted
// source-document blob, then deletes the temp chunks.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chunkUrls, filename } = (await req.json()) as { chunkUrls: string[]; filename: string };
  if (!chunkUrls?.length || !filename) {
    return NextResponse.json({ error: "Missing chunkUrls or filename" }, { status: 400 });
  }

  try {
    const buffers = await Promise.all(
      chunkUrls.map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not fetch chunk: ${url}`);
        return decryptBuffer(Buffer.from(await res.arrayBuffer()));
      }),
    );
    const assembled = Buffer.concat(buffers);

    const finalBlob = await put(
      `translate-uploads/${session.user.id}/${crypto.randomUUID()}-${filename}`,
      encryptBuffer(assembled),
      { access: "public", addRandomSuffix: false, storeId: BLOB_STORE_ID },
    );

    // Clean up chunk blobs (best-effort, don't block the response)
    del(chunkUrls, { storeId: BLOB_STORE_ID } as Parameters<typeof del>[1]).catch(() => {});

    return NextResponse.json({ blobUrl: finalBlob.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Assembly failed" }, { status: 500 });
  }
}
