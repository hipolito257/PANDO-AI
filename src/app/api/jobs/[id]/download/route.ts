import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, jobs } from "@/lib/db";
import { decryptBuffer } from "@/lib/blobCrypto";

export const maxDuration = 60;

// GET — download the file a finished job produced (e.g. a presentation)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const job = await db.query.jobs.findFirst({ where: and(eq(jobs.id, id), eq(jobs.userId, session.user.id)) });
  if (!job || job.status !== "done" || !job.result) return NextResponse.json({ error: "Not available" }, { status: 404 });

  const result = JSON.parse(job.result) as { blobUrl?: string; filename?: string; contentType?: string };
  if (!result.blobUrl) return NextResponse.json({ error: "This job has no file" }, { status: 404 });
  try {
    const res = await fetch(result.blobUrl);
    if (!res.ok) throw new Error(`Blob fetch failed (${res.status})`);
    const buffer = decryptBuffer(Buffer.from(await res.arrayBuffer()));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": result.contentType ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename ?? "download")}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[jobs download]", err);
    return NextResponse.json({ error: "Could not download the file" }, { status: 500 });
  }
}
