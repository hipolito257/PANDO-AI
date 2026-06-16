import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentTemplates } from "@/lib/schema";
import { desc } from "drizzle-orm";
import { randomUUID } from "crypto";

// Extract {{placeholder}} names from PPTX/DOCX/XLSX
function extractPlaceholders(buffer: Buffer, type: string): string[] {
  const found = new Set<string>();
  const regex = /\{\{([^{}]+)\}\}/g;

  if (type === "pptx" || type === "docx") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const PizZip = require("pizzip");
      const zip = new PizZip(buffer);
      Object.keys(zip.files).forEach((name) => {
        if (
          (type === "pptx" && name.match(/^ppt\/slides\/slide\d+\.xml$/)) ||
          (type === "docx" && name === "word/document.xml")
        ) {
          try {
            const plain = zip.files[name].asText().replace(/<[^>]*>/g, " ");
            let m: RegExpExecArray | null;
            while ((m = regex.exec(plain)) !== null) found.add(m[1].trim());
          } catch { /* skip */ }
        }
      });
    } catch { /* not a valid zip */ }
  } else if (type === "xlsx") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const PizZip = require("pizzip");
      const zip = new PizZip(buffer);
      Object.keys(zip.files).forEach((name) => {
        if (name.match(/xl\/worksheets\/sheet\d+\.xml/)) {
          try {
            let m: RegExpExecArray | null;
            const raw = zip.files[name].asText();
            while ((m = regex.exec(raw)) !== null) found.add(m[1].trim());
          } catch { /* skip */ }
        }
      });
    } catch { /* skip */ }
  }

  return Array.from(found).sort();
}

// GET /api/templates
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.query.documentTemplates.findMany({
    orderBy: [desc(documentTemplates.createdAt)],
  });

  return NextResponse.json(rows.map((r) => ({
    ...r,
    placeholders: JSON.parse(r.placeholders ?? "[]") as string[],
  })));
}

// POST /api/templates
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file        = formData.get("file") as File | null;
  const name        = (formData.get("name") as string | null)?.trim();
  const description = (formData.get("description") as string | null)?.trim() || null;

  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["pptx", "docx", "xlsx"].includes(ext)) {
    return NextResponse.json({ error: "Solo PPTX, DOCX o XLSX." }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const placeholders = extractPlaceholders(buffer, ext);
  const id = randomUUID();

  // Store file as base64 data URL in the database (no external storage needed)
  const mimeMap: Record<string, string> = {
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  const filePath = `data:${mimeMap[ext] ?? "application/octet-stream"};base64,${buffer.toString("base64")}`;

  const userId   = session.user.id;
  const userName = session.user.name ?? session.user.email ?? "Usuario";

  await db.insert(documentTemplates).values({
    id,
    name,
    type: ext,
    description,
    filePath,
    fileSize: buffer.length,
    placeholders: JSON.stringify(placeholders),
    createdBy: userId,
  });

  // Log activity
  try {
    const { activityLog } = await import("@/lib/schema");
    await db.insert(activityLog).values({
      id: randomUUID(), userId, userName,
      action: "uploaded_template", entityType: "template", entityId: id, entityName: name,
    });
  } catch { /* non-blocking */ }

  const row = await db.query.documentTemplates.findFirst({
    where: (t, { eq }) => eq(t.id, id),
  });

  return NextResponse.json({ ...row, placeholders });
}
