import { NextRequest, NextResponse } from "next/server";
import { put, get } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import {
  Direction, TranslateJob,
  extractDocxTexts, extractPptxTexts, extractXlsxSegments,
  docxPartNames, pptxPartNames,
} from "@/lib/documentTranslate";

export const maxDuration = 60;

const BLOB_STORE_ID = process.env.BLOBPUBLIC_STORE_ID ?? process.env.BLOB_STORE_ID ?? "";

// POST /api/documents/translate/start
// Body: { blobUrl, filename, direction }
// Downloads the uploaded document, extracts every translatable text segment
// (no AI calls here — this must stay fast even for very large documents),
// and stores a job record in Blob so /batch can translate it incrementally.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { blobUrl, filename, direction: rawDirection } = await req.json() as {
    blobUrl?: string; filename?: string; direction?: string;
  };
  const direction: Direction = rawDirection === "en-es" ? "en-es" : "es-en";

  if (!blobUrl || !filename) {
    return NextResponse.json({ error: "blobUrl and filename are required" }, { status: 400 });
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!["docx", "pptx", "xlsx"].includes(ext)) {
    return NextResponse.json({ error: "Unsupported file type. Upload a .docx, .pptx, or .xlsx file." }, { status: 400 });
  }

  const userId = session.user.id;
  const userSetting = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  if (!userSetting?.anthropicApiKey) {
    return NextResponse.json({
      error: "no_key",
      message: "Configure your Anthropic API key in Settings to use document translation.",
    }, { status: 400 });
  }

  try {
    const sourceResult = await get(blobUrl, { access: "private", storeId: BLOB_STORE_ID });
    if (!sourceResult) throw new Error("Could not download uploaded file");
    const buffer = Buffer.from(await new Response(sourceResult.stream).arrayBuffer());

    const parts: { name: string; length: number }[] = [];
    const segments: string[] = [];

    if (ext === "docx" || ext === "pptx") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const PizZip = require("pizzip");
      const zip = new PizZip(buffer);
      const names = ext === "docx" ? docxPartNames(zip) : pptxPartNames(zip);
      for (const name of names) {
        const xml = zip.files[name].asText();
        const texts = ext === "docx" ? extractDocxTexts(xml) : extractPptxTexts(xml);
        parts.push({ name, length: texts.length });
        segments.push(...texts);
      }
    } else {
      const { cellTexts, sheetNames } = await extractXlsxSegments(buffer);
      parts.push({ name: "__cells__", length: cellTexts.length });
      parts.push({ name: "__sheetnames__", length: sheetNames.length });
      segments.push(...cellTexts, ...sheetNames);
    }

    const jobId = crypto.randomUUID();
    const job: TranslateJob = {
      id: jobId,
      ext: ext as "docx" | "pptx" | "xlsx",
      direction,
      filename,
      sourceBlobUrl: blobUrl,
      parts,
      total: segments.length,
      segments,
      translated: new Array(segments.length).fill(null),
      createdAt: Date.now(),
    };

    const jobBlob = await put(`translate-jobs/${userId}/${jobId}.json`, JSON.stringify(job), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      storeId: BLOB_STORE_ID,
    });

    return NextResponse.json({ jobId, jobUrl: jobBlob.url, total: segments.length });
  } catch (e: any) {
    console.error("[translate/start] error:", e.message);
    return NextResponse.json({ error: e.message || "Failed to start translation job" }, { status: 500 });
  }
}
