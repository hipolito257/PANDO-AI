import { NextRequest, NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { TranslateJob, callTranslateBatch } from "@/lib/documentTranslate";
import { encryptBuffer, decryptBuffer } from "@/lib/blobCrypto";

export const maxDuration = 120;

const BLOB_STORE_ID = process.env.BLOBPUBLIC_STORE_ID ?? process.env.BLOB_STORE_ID ?? "";

// How many segments to translate per call. Kept well within maxDuration —
// the client loops this endpoint until the whole job is done, so documents
// of any size just take more (short) round-trips instead of one long one.
const BATCH_SIZE = 200;

// POST /api/documents/translate/batch
// Body: { jobId, jobUrl }
// Translates the next untranslated slice of segments and persists progress.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { jobId, jobUrl } = await req.json() as { jobId?: string; jobUrl?: string };
  if (!jobId || !jobUrl) return NextResponse.json({ error: "jobId and jobUrl required" }, { status: 400 });

  const userId = session.user.id;
  if (!jobUrl.includes(`/translate-jobs/${userId}/`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userSetting = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  const apiKey = userSetting?.anthropicApiKey ?? null;
  if (!apiKey) {
    return NextResponse.json({ error: "no_key", message: "Configure your Anthropic API key in Settings." }, { status: 400 });
  }

  try {
    // Cache-bust: the job blob is overwritten on every batch, and public
    // blobs can be CDN-cached, so a plain fetch could return a stale copy.
    const jobRes = await fetch(`${jobUrl}?t=${Date.now()}`, { cache: "no-store" });
    if (!jobRes.ok) throw new Error("Translation job not found (it may have expired)");
    const job = JSON.parse(decryptBuffer(Buffer.from(await jobRes.arrayBuffer())).toString("utf-8")) as TranslateJob;

    if (job.total === 0) {
      return NextResponse.json({ done: true, translatedCount: 0, total: 0 });
    }

    const startIdx = job.translated.findIndex(t => t === null);
    if (startIdx === -1) {
      return NextResponse.json({ done: true, translatedCount: job.total, total: job.total });
    }

    const endIdx = Math.min(startIdx + BATCH_SIZE, job.total);
    const originals = job.segments.slice(startIdx, endIdx);

    const translatedSlice = await callTranslateBatch(originals, apiKey, job.direction);
    for (let i = 0; i < translatedSlice.length; i++) {
      job.translated[startIdx + i] = translatedSlice[i];
    }

    // Write to a fresh, never-before-fetched URL rather than overwriting
    // jobUrl in place — a public blob is served through Vercel's CDN, and
    // overwriting the same path isn't guaranteed to invalidate an edge's
    // cached copy immediately. On a large document with many sequential
    // batch round-trips, that staleness window compounds: /finalize (or the
    // next /batch call) can keep reading an old, not-fully-translated
    // snapshot no matter how much it retries the same URL. A brand-new URL
    // has no prior cache entry, so this class of bug can't happen at all.
    const newJobBlob = await put(`translate-jobs/${userId}/${jobId}.enc`, encryptBuffer(Buffer.from(JSON.stringify(job))), {
      access: "public",
      addRandomSuffix: true,
      storeId: BLOB_STORE_ID,
    });
    // Best-effort cleanup of the now-superseded previous revision.
    del(jobUrl, { storeId: BLOB_STORE_ID } as Parameters<typeof del>[1]).catch(() => {});

    const translatedCount = job.translated.filter(t => t !== null).length;
    return NextResponse.json({
      done: translatedCount >= job.total, translatedCount, total: job.total,
      jobUrl: newJobBlob.url,
    });
  } catch (e: any) {
    console.error("[translate/batch] error:", e.message);
    return NextResponse.json({ error: e.message || "Batch translation failed" }, { status: 500 });
  }
}
