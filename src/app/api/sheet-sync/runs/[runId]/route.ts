import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { applyRun, dismissRun } from "@/lib/sheetSync";

// POST { action: "apply", ids?: string[] } | { action: "dismiss" } — review a reading of the sheet
export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { runId } = await params;
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === "dismiss") {
      await dismissRun(runId, session.user.id);
      return NextResponse.json({ ok: true });
    }
    const ids = Array.isArray(b.ids) ? b.ids.filter((x: unknown): x is string => typeof x === "string") : null;
    const r = await applyRun(runId, ids, { id: session.user.id, name: session.user.name ?? "User" });
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't apply the changes" }, { status: 400 });
  }
}
