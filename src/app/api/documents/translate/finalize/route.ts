import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { auth } from "@/lib/auth";
import {
  TranslateJob, reconstructDocxXml, reconstructPptxXml, applyXlsxSegments,
} from "@/lib/documentTranslate";
import { decryptBuffer } from "@/lib/blobCrypto";

export const maxDuration = 60;

const BLOB_STORE_ID = process.env.BLOBPUBLIC_STORE_ID ?? process.env.BLOB_STORE_ID ?? "";

// POST /api/documents/translate/finalize
// Body: { jobId, jobUrl }
// Reassembles the fully-translated document. No AI calls here — just XML/
// workbook reconstruction — so this stays fast regardless of document size.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { jobId, jobUrl } = await req.json() as { jobId?: string; jobUrl?: string };
  if (!jobId || !jobUrl) return NextResponse.json({ error: "jobId and jobUrl required" }, { status: 400 });

  const userId = session.user.id;
  if (!jobUrl.includes(`/translate-jobs/${userId}/`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // The client only calls finalize once /batch itself reports done:true —
    // but that response comes right after this same job blob was overwritten,
    // and public blobs are served through Vercel's CDN, so this fetch can
    // still land on an edge that hasn't caught up with the last write yet.
    // Retry briefly before concluding the job is genuinely unfinished.
    let job: TranslateJob | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const jobRes = await fetch(`${jobUrl}?t=${Date.now()}`, { cache: "no-store" });
      if (!jobRes.ok) throw new Error("Translation job not found (it may have expired)");
      job = JSON.parse(decryptBuffer(Buffer.from(await jobRes.arrayBuffer())).toString("utf-8")) as TranslateJob;
      if (!job.translated.some(t => t === null)) break;
      if (attempt < 4) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
    if (!job) throw new Error("Translation job not found (it may have expired)");

    if (job.translated.some(t => t === null)) {
      return NextResponse.json({ error: "Translation is not finished yet" }, { status: 409 });
    }

    const sourceRes = await fetch(job.sourceBlobUrl);
    if (!sourceRes.ok) throw new Error("Could not download the original uploaded file");
    const buffer = decryptBuffer(Buffer.from(await sourceRes.arrayBuffer()));

    let outBuffer: Buffer;

    if (job.ext === "docx" || job.ext === "pptx") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const PizZip = require("pizzip");
      const zip = new PizZip(buffer);
      let offset = 0;
      for (const part of job.parts) {
        const slice = job.translated.slice(offset, offset + part.length) as string[];
        offset += part.length;
        const xml = zip.files[part.name].asText();
        const newXml = job.ext === "docx" ? reconstructDocxXml(xml, slice) : reconstructPptxXml(xml, slice);
        zip.file(part.name, newXml);
      }
      outBuffer = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
    } else {
      const cellsLen = job.parts.find(p => p.name === "__cells__")?.length ?? 0;
      const namesLen = job.parts.find(p => p.name === "__sheetnames__")?.length ?? 0;
      const cellTexts = job.translated.slice(0, cellsLen) as string[];
      const sheetNames = job.translated.slice(cellsLen, cellsLen + namesLen) as string[];
      outBuffer = await applyXlsxSegments(buffer, cellTexts, sheetNames);
    }

    const baseName = job.filename.replace(/\.[^.]+$/, "");
    const suffix = job.direction === "es-en" ? "EN" : "ES";
    const outName = `${baseName}_${suffix}.${job.ext}`;

    const mimeMap: Record<string, string> = {
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };

    // Best-effort cleanup — don't block the response on it
    del([jobUrl, job.sourceBlobUrl], { storeId: BLOB_STORE_ID } as Parameters<typeof del>[1]).catch(() => {});

    return new NextResponse(new Uint8Array(outBuffer), {
      headers: {
        "Content-Type": mimeMap[job.ext],
        "Content-Disposition": `attachment; filename="${encodeURIComponent(outName)}"`,
      },
    });
  } catch (e: any) {
    console.error("[translate/finalize] error:", e.message);
    return NextResponse.json({ error: e.message || "Finalization failed" }, { status: 500 });
  }
}
