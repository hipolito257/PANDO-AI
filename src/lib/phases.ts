// The three sections a deal moves through (General and Fundraising don't hold
// deals). Safe to import from client components.

export const PHASES = [
  { key: "sourcing",  label: "Deal Sourcing",        short: "Sourcing",  href: "/deals",           companyStatus: "pipeline" },
  { key: "portfolio", label: "Portfolio Management", short: "Portfolio", href: "/portfolio/board", companyStatus: "portfolio" },
  { key: "exit",      label: "Exit",                 short: "Exit",      href: "/exits",           companyStatus: "portfolio" },
] as const;

export type Phase = (typeof PHASES)[number]["key"];

export const isPhase = (v: unknown): v is Phase => PHASES.some(p => p.key === v);
export const phaseInfo = (key: string | null | undefined) => PHASES.find(p => p.key === key) ?? PHASES[0];

/** Drag data type used when a deal card is dragged (boards ⇄ sidebar sections). */
export const DEAL_DRAG_TYPE = "application/x-pando-deal";
/** Window events fired while a deal is being dragged, so drop targets can light up. */
export const DEAL_DRAG_START = "pando:deal-drag-start";
export const DEAL_DRAG_END = "pando:deal-drag-end";
/** Fired after a deal changed section, so open boards refresh. */
export const DEAL_MOVED = "pando:deal-moved";

/** Moves a deal to another section from the browser (used by boards, sidebar and deal page). */
export async function moveDealToPhase(dealId: string, phase: Phase): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/deals/${dealId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phase }),
  }).catch(() => null);
  if (!res?.ok) {
    const j = await res?.json().catch(() => ({}));
    return { ok: false, error: (j as { error?: string })?.error ?? "Couldn't move the deal" };
  }
  window.dispatchEvent(new CustomEvent(DEAL_MOVED, { detail: { dealId, phase } }));
  return { ok: true };
}
