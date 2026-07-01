import { NextRequest, NextResponse } from "next/server";
import { put, del, get } from "@vercel/blob";
import { auth } from "@/lib/auth";

const BLOB_STORE_ID = process.env.BLOBPUBLIC_STORE_ID ?? process.env.BLOB_STORE_ID ?? "";

// Assembles the private chunk blobs from /upload-chunk into one private
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
        const result = await get(url, { access: "private", storeId: BLOB_STORE_ID });
        if (!result) throw new Error(`Could not fetch chunk: ${url}`);
        return Buffer.from(await new Response(result.stream).arrayBuffer());
      }),
    );
    const assembled = Buffer.concat(buffers);

    const finalBlob = await put(
      `translate-uploads/${session.user.id}/${crypto.randomUUID()}-${filename}`,
      assembled,
      { access: "private", addRandomSuffix: false, storeId: BLOB_STORE_ID },
    );

    // Clean up chunk blobs (best-effort, don't block the response)
    del(chunkUrls, { storeId: BLOB_STORE_ID } as Parameters<typeof del>[1]).catch(() => {});

    return NextResponse.json({ blobUrl: finalBlob.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Assembly failed" }, { status: 500 });
  }
}
