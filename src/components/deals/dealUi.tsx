"use client";
// Small shared pieces for the deals pages.
export const DEAL_TYPE_LABEL: Record<string, string> = {
  buy_side: "Buy-side", sell_side: "Sell-side", minority: "Minority", add_on: "Add-on",
};
export const DEAL_ROLE_LABEL: Record<string, string> = {
  lead: "Deal lead", partner: "Partner", associate: "Associate", analyst: "Analyst", advisor: "Advisor",
};
export const CURRENCIES = ["USD", "MXN", "EUR", "COP", "BRL", "CLP", "PEN"];

export type Stage = { key: string; label: string; position: number; kind: string };

export function initials(name: string | null | undefined) {
  return (name ?? "?").trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

export function Avatar({ name, size = 22, title }: { name: string | null | undefined; size?: number; title?: string }) {
  return (
    <span title={title ?? name ?? ""} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      className="inline-flex items-center justify-center rounded-full bg-forest text-white font-semibold shrink-0 border border-paper">
      {initials(name)}
    </span>
  );
}

export function StagePill({ stage, onHold }: { stage: Stage | undefined; onHold?: boolean }) {
  if (onHold) return <span className="text-[10px] font-medium rounded-full px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200">On hold</span>;
  const cls = stage?.kind === "won" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : stage?.kind === "lost" ? "bg-fog text-slate border-chalk"
    : "bg-forest/10 text-forest border-forest/20";
  return <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 border ${cls}`}>{stage?.label ?? "—"}</span>;
}

export function fmtDay(d: string | null | undefined) {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtSize(v: number | null | undefined, currency: string) {
  if (v == null) return "";
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(v / 1e9).toFixed(1)}bn` : a >= 1e6 ? `${(v / 1e6).toFixed(0)}m` : a >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : v.toFixed(0);
  return `${currency} ${s}`;
}
