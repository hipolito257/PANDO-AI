// Push notifications to the devices where someone turned them on (the phone
// app installed from the browser, or a desktop browser). Uses standard Web
// Push with VAPID keys (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in Vercel);
// without them, sending is a no-op. Sending never throws into the caller.
import webpush from "web-push";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pushSubscriptions, userSettings, users } from "@/lib/db";

export const PUSH_KINDS = [
  { key: "sheet", label: "Google Sheet changes waiting for approval" },
  { key: "tasks", label: "Tasks assigned to me" },
  { key: "deals", label: "Stage changes on my deals" },
  { key: "radar", label: "New radar signals" },
] as const;
export type PushKind = (typeof PUSH_KINDS)[number]["key"];
export type PushPrefs = Record<PushKind, boolean>;
export const DEFAULT_PREFS: PushPrefs = { sheet: true, tasks: true, deals: true, radar: true };

export type PushMessage = { title: string; body: string; url?: string; tag?: string };

export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? null;

let configured = false;
function configure() {
  if (configured || !pushConfigured()) return configured;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:notifications@pando.mx", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
  return true;
}

export function parsePrefs(raw: string | null | undefined): PushPrefs {
  try { return { ...DEFAULT_PREFS, ...(raw ? JSON.parse(raw) : {}) }; } catch { return { ...DEFAULT_PREFS }; }
}

export async function savePrefs(userId: string, prefs: Partial<PushPrefs>) {
  const row = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  const next = JSON.stringify({ ...parsePrefs(row?.pushPrefs), ...prefs });
  if (row) await db.update(userSettings).set({ pushPrefs: next }).where(eq(userSettings.userId, userId));
  else await db.insert(userSettings).values({ id: randomUUID(), userId, pushPrefs: next });
}

/**
 * Sends to the given people (or everyone active with "all"), skipping those who
 * turned this kind off and anyone in `except` (usually whoever caused it).
 */
export async function notify(to: string[] | "all", kind: PushKind | "test", msg: PushMessage, except: (string | null | undefined)[] = []) {
  try {
    if (!configure()) return 0;
    const ids = to === "all"
      ? (await db.select({ id: users.id }).from(users).where(eq(users.status, "active"))).map(u => u.id)
      : [...new Set(to.filter(Boolean))];
    const targets = ids.filter(id => !except.includes(id));
    if (!targets.length) return 0;

    const [subs, settings] = await Promise.all([
      db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, targets)),
      db.select({ userId: userSettings.userId, pushPrefs: userSettings.pushPrefs }).from(userSettings).where(inArray(userSettings.userId, targets)),
    ]);
    const prefs = new Map(settings.map(s => [s.userId, parsePrefs(s.pushPrefs)]));
    const payload = JSON.stringify({ ...msg, url: msg.url ?? "/", tag: msg.tag ?? kind });
    let sent = 0;
    await Promise.all(subs.filter(s => kind === "test" || (prefs.get(s.userId) ?? DEFAULT_PREFS)[kind]).map(async s => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "normal" });
        sent++;
        await db.update(pushSubscriptions).set({ lastUsedAt: new Date().toISOString() }).where(eq(pushSubscriptions.id, s.id));
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        // The device unsubscribed or the browser dropped it: forget it.
        if (code === 404 || code === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        else console.error("[push] send failed", code, (err as Error).message);
      }
    }));
    return sent;
  } catch (err) {
    console.error("[push]", err);
    return 0;
  }
}
