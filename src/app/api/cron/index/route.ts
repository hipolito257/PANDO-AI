import { NextRequest, NextResponse } from "next/server";
import { chunkFile, embedPending, filesToChunk, indexStatus } from "@/lib/docIndex";
import { embeddingsAvailable } from "@/lib/embeddings";

export const maxDuration = 300;

// Daily catch-up for the document search index: reads new documents and embeds
// whatever passages are still waiting (the Search page also starts this on demand).
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!embeddingsAvailable()) return NextResponse.json({ skipped: "VOYAGE_API_KEY not configured" });

  const started = Date.now();
  const status = await indexStatus();
  if (status.job) return NextResponse.json({ skipped: "An indexing job is running" });

  let filesRead = 0;
  for (const f of await filesToChunk(60)) {
    if (Date.now() - started > 90_000) break;
    filesRead += (await chunkFile(f.id)) > 0 ? 1 : 0;
  }
  const r = await embedPending({ deadline: started + 270_000 });
  return NextResponse.json({ filesRead, ...r });
}
