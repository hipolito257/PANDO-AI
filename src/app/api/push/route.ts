import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { db, pushSubscriptions, userSettings } from "@/lib/db";
import { PUSH_KINDS, notify, parsePrefs, pushConfigured, savePrefs, vapidPublicKey, type PushKind } from "@/lib/push";

// GET — the public key, this person's devices and which notifications they want
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [subs, setting] = await Promise.all([
    db.select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, device: pushSubscriptions.device, createdAt: pushSubscriptions.createdAt })
      .from(pushSubscriptions).where(eq(pushSubscriptions.userId, session.user.id)),
    db.query.userSettings.findFirst({ where: eq(userSettings.userId, session.user.id), columns: { pushPrefs: true } }),
  ]);
  return NextResponse.json({ configured: pushConfigured(), publicKey: vapidPublicKey(), devices: subs, prefs: parsePrefs(setting?.pushPrefs), kinds: PUSH_KINDS });
}

// POST { subscription, device } — turn notifications on for this device
// POST { test: true } — send a test notification to my devices
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (b.test) {
    const sent = await notify([session.user.id], "test", { title: "PANDO", body: "Notifications are working on this device.", url: "/settings", tag: "test" });
    return NextResponse.json({ sent });
  }
  const sub = b.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  const device = typeof b.device === "string" ? b.device.slice(0, 120) : null;
  const [existing] = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint)).limit(1);
  if (existing) {
    await db.update(pushSubscriptions).set({ userId: session.user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth, device }).where(eq(pushSubscriptions.id, existing.id));
  } else {
    await db.insert(pushSubscriptions).values({ id: randomUUID(), userId: session.user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, device, createdAt: new Date().toISOString() });
  }
  return NextResponse.json({ ok: true });
}

// PATCH { prefs } — which kinds of notifications to receive
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const prefs: Partial<Record<PushKind, boolean>> = {};
  for (const k of PUSH_KINDS) if (typeof b.prefs?.[k.key] === "boolean") prefs[k.key] = b.prefs[k.key];
  await savePrefs(session.user.id, prefs);
  return NextResponse.json({ ok: true });
}

// DELETE { endpoint } — turn notifications off for a device
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (typeof b.endpoint === "string") {
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, b.endpoint), eq(pushSubscriptions.userId, session.user.id)));
  } else if (typeof b.id === "string") {
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, b.id), eq(pushSubscriptions.userId, session.user.id)));
  }
  return NextResponse.json({ ok: true });
}
