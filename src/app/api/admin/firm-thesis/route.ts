import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { firmSettings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { FIRM_SETTINGS_ID, getFirmThesis } from "@/lib/firmThesis";
import { extractPlainText } from "@/lib/extractDocumentText";
import { dbErrorMessage } from "@/lib/utils";

// GET /api/admin/firm-thesis — any logged-in user can view the firm's investment thesis
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const thesis = await getFirmThesis();
  const row = await db.query.firmSettings.findFirst({ where: eq(firmSettings.id, FIRM_SETTINGS_ID) }).catch(() => null);
  return NextResponse.json({ thesis, fileName: row?.investmentThesisFileName ?? null });
}

// PATCH /api/admin/firm-thesis — admin-only: replace the thesis by uploading a reference document.
// The admin uploads a .docx file (via the chunk-upload flow); its text is extracted and stored
// as-is. There is no free-text editing — the only way to change the thesis is to upload a new file.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!url || !name) return NextResponse.json({ error: "A file url and name are required" }, { status: 400 });

  const ext = name.split(".").pop()?.toLowerCase();
  if (ext !== "docx") return NextResponse.json({ error: "Please upload a .docx file" }, { status: 400 });

  try {
    const fileRes = await fetch(url);
    if (!fileRes.ok) return NextResponse.json({ error: "Could not download the uploaded file" }, { status: 400 });
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const thesis = await extractPlainText(buffer, "docx");
    if (!thesis.trim()) {
      return NextResponse.json({ error: "Could not extract any text from that file" }, { status: 400 });
    }

    await db
      .insert(firmSettings)
      .values({ id: FIRM_SETTINGS_ID, investmentThesis: thesis, investmentThesisFileName: name, updatedBy: session.user.id })
      .onConflictDoUpdate({
        target: firmSettings.id,
        set: { investmentThesis: thesis, investmentThesisFileName: name, updatedBy: session.user.id, updatedAt: new Date().toISOString() },
      });

    return NextResponse.json({ thesis, fileName: name });
  } catch (e) {
    console.error("[firm-thesis PATCH]", e);
    return NextResponse.json({ error: dbErrorMessage(e) }, { status: 500 });
  }
}
