"use client";
// Deals and companies always go together: wherever a tool works "on a company"
// (comps, documents, models), you pick the deal and it uses that deal's company.
import { useEffect, useState } from "react";
import { PHASES } from "@/lib/phases";

export type DealOption = {
  id: string; codeName: string; phase: string; stage: string;
  companyId: string; company: { id: string; name: string; sector: string | null; website: string | null };
};

let cache: DealOption[] | null = null;

export function useDealOptions() {
  const [deals, setDeals] = useState<DealOption[]>(cache ?? []);
  const [state, setState] = useState<"loading" | "ok" | "error">(cache ? "ok" : "loading");
  useEffect(() => {
    let alive = true;
    fetch("/api/deals").then(r => (r.ok ? r.json() : Promise.reject())).then(j => {
      cache = (j.deals ?? []) as DealOption[];
      if (alive) { setDeals(cache); setState("ok"); }
    }).catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, []);
  return { deals, state };
}

export const dealLabel = (d: DealOption) => (d.codeName && d.codeName !== d.company.name ? `${d.codeName} · ${d.company.name}` : d.company.name);

/** <option>s for a company select, one per deal, grouped by section. Value = the deal's company id. */
export function DealCompanyOptions({ deals }: { deals: DealOption[] }) {
  const seen = new Set<string>();
  return (
    <>
      {PHASES.map(p => {
        const items = deals.filter(d => d.phase === p.key && !seen.has(d.companyId) && seen.add(d.companyId));
        return items.length ? (
          <optgroup key={p.key} label={p.label}>
            {items.map(d => <option key={d.id} value={d.companyId}>{dealLabel(d)}</option>)}
          </optgroup>
        ) : null;
      })}
    </>
  );
}
