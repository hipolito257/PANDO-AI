// Shared constants and server helpers for deals.
import { db, activityLog, dealStages, dealMembers } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { notify } from "@/lib/push";
import { randomUUID } from "crypto";

export const DEAL_TYPES = [
  { value: "buy_side",  label: "Buy-side" },
  { value: "sell_side", label: "Sell-side" },
  { value: "minority",  label: "Minority investment" },
  { value: "add_on",    label: "Add-on" },
] as const;

export const DEAL_ROLES = [
  { value: "lead",      label: "Deal lead" },
  { value: "partner",   label: "Partner" },
  { value: "associate", label: "Associate" },
  { value: "analyst",   label: "Analyst" },
  { value: "advisor",   label: "Advisor" },
] as const;

export const TASK_STATUSES = ["todo", "doing", "done"] as const;

export type DealStageRow = { key: string; label: string; position: number; kind: string };

export async function listStages(): Promise<DealStageRow[]> {
  return db.select().from(dealStages).orderBy(asc(dealStages.position));
}

export const nowIso = () => new Date().toISOString();
export const newId = () => randomUUID();

/** Pushes a notification to the deal's team (minus whoever made the change). */
export async function notifyDealTeam(dealId: string, actorId: string | null, msg: { title: string; body: string }) {
  const members = await db.select({ userId: dealMembers.userId }).from(dealMembers).where(eq(dealMembers.dealId, dealId));
  await notify(members.map(m => m.userId), "deals", { ...msg, url: `/deals/${dealId}`, tag: `deal-${dealId}` }, [actorId]);
}

export async function logDeal(userId: string, userName: string, action: string, dealId: string, dealName: string, detail?: string) {
  try {
    await db.insert(activityLog).values({
      id: randomUUID(), userId, userName, action, entityType: "deal", entityId: dealId, entityName: dealName, detail: detail ?? null,
    });
  } catch { /* non-blocking */ }
}
