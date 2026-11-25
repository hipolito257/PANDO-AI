// How the team rates each deal: interest (high / on the radar / low) and
// status (active / on hold / pending). High interest + pending = alert.

export const INTERESTS = [
  { key: "high",  label: "High interest", short: "High",  cls: "bg-olive text-paper border-olive" },
  { key: "radar", label: "On the radar",  short: "Radar", cls: "bg-pistacho/60 text-olive border-pistacho" },
  { key: "low",   label: "Low interest",  short: "Low",   cls: "bg-fog text-slate border-chalk" },
] as const;

export const DEAL_STATUSES = [
  { key: "active",  label: "Active",  cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { key: "on_hold", label: "On hold", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  { key: "pending", label: "Pending", cls: "bg-orange/10 text-orange border-orange/30" },
] as const;

export type Interest = (typeof INTERESTS)[number]["key"];
export type DealStatus = (typeof DEAL_STATUSES)[number]["key"];

export const isInterest = (v: unknown): v is Interest => INTERESTS.some(i => i.key === v);
export const isDealStatus = (v: unknown): v is DealStatus => DEAL_STATUSES.some(s => s.key === v);
export const interestInfo = (k: string | null | undefined) => INTERESTS.find(i => i.key === k) ?? INTERESTS[1];
export const statusInfo = (k: string | null | undefined) => DEAL_STATUSES.find(s => s.key === k) ?? DEAL_STATUSES[0];

/** A deal the team cares about that is waiting on something: flag it. */
export const isAlert = (d: { interest?: string | null; dealStatus?: string | null }) => d.interest === "high" && d.dealStatus === "pending";
