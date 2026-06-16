import { NextRequest, NextResponse } from "next/server";
import { db, dataSources } from "@/lib/db";
import { auth } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.query.dataSources.findMany({
    orderBy: [asc(dataSources.category), asc(dataSources.displayName)],
  });

  // Never return the raw API key to the client — only whether it's configured
  const safe = rows.map(({ apiKey, ...rest }) => ({
    ...rest,
    apiKeyConfigured: !!(apiKey && apiKey.trim().length > 0),
  }));

  return NextResponse.json(safe);
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, isSubscribed, isEnabled, apiKey } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (isSubscribed !== undefined) update.isSubscribed = isSubscribed;
  if (isEnabled   !== undefined) update.isEnabled   = isEnabled;
  if (apiKey      !== undefined) update.apiKey      = apiKey === "" ? null : apiKey;

  await db.update(dataSources).set(update as any).where(eq(dataSources.id, id));

  const source = await db.query.dataSources.findFirst({ where: eq(dataSources.id, id) });
  if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { apiKey: _key, ...rest } = source;
  return NextResponse.json({ ...rest, apiKeyConfigured: !!(_key && _key.trim().length > 0) });
}
