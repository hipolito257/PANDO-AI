import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signals, companies } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";

// GET /api/signals — returns recent unread signals with company info
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "20");
  const unreadOnly = req.nextUrl.searchParams.get("unread") === "true";

  const rows = await db.query.signals.findMany({
    where: unreadOnly ? (s, { eq: eqS }) => eqS(s.isRead, false) : undefined,
    with: { company: { columns: { id: true, name: true, slug: true, status: true } } },
    orderBy: (s, { desc: d }) => [d(s.date)],
    limit,
  });

  const unreadCount = await db.query.signals.findMany({
    where: (s, { eq: eqS }) => eqS(s.isRead, false),
    columns: { id: true },
  }).then(r => r.length);

  return NextResponse.json({ signals: rows, unreadCount });
}

// PATCH /api/signals — mark signals as read
// body: { ids: string[] } — specific IDs, or { all: true } to mark all read
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  if (body.all) {
    await db.update(signals).set({ isRead: true });
    return NextResponse.json({ ok: true });
  }

  if (Array.isArray(body.ids) && body.ids.length > 0) {
    for (const id of body.ids) {
      await db.update(signals).set({ isRead: true }).where(eq(signals.id, id));
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Provide ids[] or all:true" }, { status: 400 });
}
