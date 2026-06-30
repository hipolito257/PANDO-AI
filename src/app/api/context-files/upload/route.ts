import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Vercel Blob client-side upload handler for context/research files.
// Called twice by @vercel/blob/client:
//   1. Browser → type:"blob.generate-client-token"  (auth required)
//   2. Vercel  → type:"blob.upload-completed"        (no session — skip auth)
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.type === "blob.generate-client-token") {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "text/plain", "text/csv",
          "image/png", "image/jpeg", "image/jpg", "image/webp",
          "application/octet-stream",
        ],
        maximumSizeInBytes: 50 * 1024 * 1024, // 50 MB per file
      }),
      onUploadCompleted: async ({ blob }) => {
        console.log("[context-files] uploaded:", blob.url);
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[context-files/upload]", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
