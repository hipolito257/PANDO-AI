import { NextRequest, NextResponse } from "next/server";
import { chunkFile, filesToChunk, indexStatus } from "@/lib/docIndex";

export const maxDuration = 300;

// Daily catch-up for the document search index: reads documents that haven't
// been read yet (the Search page and uploads also start this on demand).
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  const status = await indexStatus();
  if (status.job) return NextResponse.json({ skipped: "An indexing job is running" });

  let filesRead = 0;
  for (const f of await filesToChunk(200)) {
    if (Date.now() - started > 250_000) break;
    filesRead += (await chunkFile(f.id)) > 0 ? 1 : 0;
  }
  return NextResponse.json({ filesRead });
}
