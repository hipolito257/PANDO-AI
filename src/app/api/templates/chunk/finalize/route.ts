import { NextRequest, NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { auth } from "@/lib/auth";

const BLOB_TOKEN =
  process.env.BLOBPUBLIC_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN ?? "";

// Downloads all chunk blobs, assembles them into one file, stores the final
// blob, and deletes the temp chunk blobs.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chunkUrls, filename } = (await req.json()) as {
    chunkUrls: string[];
    filename: string;
  };

  if (!chunkUrls?.length || !filename) {
    return NextResponse.json({ error: "Missing chunkUrls or filename" }, { status: 400 });
  }

  try {
    // Download all chunks and concatenate
    const buffers = await Promise.all(
      chunkUrls.map(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not fetch chunk: ${url}`);
        return Buffer.from(await res.arrayBuffer());
      }),
    );
    const assembled = Buffer.concat(buffers);

    // Upload final assembled file to Vercel Blob
    const finalBlob = await put(filename, assembled, {
      access: "public",
      addRandomSuffix: true,
      token: BLOB_TOKEN,
    });

    // Clean up chunk blobs (best-effort, don't block response)
    del(chunkUrls, { token: BLOB_TOKEN }).catch(() => {});

    return NextResponse.json({ blobUrl: finalBlob.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Assembly failed" }, { status: 500 });
  }
}
