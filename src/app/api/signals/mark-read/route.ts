import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signals } from "@/lib/schema";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { auth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { types, excludeTypes } = body as { types?: string[]; excludeTypes?: string[] };

  const unread = eq(signals.isRead, false);

  const condition =
    types?.length        ? and(unread, inArray(signals.type, types))    :
    excludeTypes?.length ? and(unread, notInArray(signals.type, excludeTypes)) :
                           unread;

  await db.update(signals).set({ isRead: true }).where(condition);

  return NextResponse.json({ ok: true });
}
