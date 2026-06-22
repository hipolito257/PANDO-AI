import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const ALLOWED_MIME = [
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "application/zip",
];

// GET — diagnostic: tells us if BLOB_READ_WRITE_TOKEN is available
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    blobTokenSet: !!process.env.BLOB_READ_WRITE_TOKEN,
    blobTokenPrefix: process.env.BLOB_READ_WRITE_TOKEN?.slice(0, 20) ?? "(not set)",
  });
}

// POST — Vercel Blob client-side upload handler
// Called twice by @vercel/blob/client:
//   1. Browser → type:"blob.generate-client-token"  (user is authenticated)
//   2. Vercel  → type:"blob.upload-completed"        (no user session — skip auth)
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Auth only for token generation (step 1 from browser)
  // Step 2 (completion) comes from Vercel infrastructure — no session cookie
  if (body.type === "blob.generate-client-token") {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
        if (!["pptx", "docx", "xlsx"].includes(ext)) {
          throw new Error(`Tipo de archivo no permitido: .${ext}`);
        }
        return {
          allowedContentTypes: ALLOWED_MIME,
          maximumSizeInBytes: 25 * 1024 * 1024, // 25 MB
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log("Template blob uploaded:", blob.url);
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[templates/upload] handleUpload error:", msg);
    // Return the actual error so the client can show it
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
