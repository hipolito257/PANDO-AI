"use client";
// Fundraising › Investor map: every investor by type (family offices, AFOREs,
// institutional, DFIs…), searchable and filterable.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { InvestorModal, SheetSyncButton, useInvestors } from "@/components/fundraising/InvestorModal";
import { INVESTOR_STAGES, INVESTOR_TYPES, fmtMoney, investorStageInfo, scoreTone, type Investor } from "@/lib/fundraising";

const stageCls = (k: string) => {
  const s = investorStageInfo(k);
  return s.kind === "won" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : s.kind === "lost" ? "bg-fog text-slate border-chalk" : "bg-pistacho/40 text-olive border-pistacho";
};

export default function InvestorMapPage() {
  const { investors, team, state, load, sheet } = useInvestors();
  const router = useRouter();
  const [sort, setSort] = useState<"name" | "fit" | "probability">("name");
  const [type, setType] = useState<string>("all");
  const [stage, setStage] = useState("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Investor | null>(null);
  const [adding, setAdding] = useState(false);

  const counts = useMemo(() => Object.fromEntries(INVESTOR_TYPES.map(t => [t.key, investors.filter(i => i.type === t.key).length])), [investors]);
  const rows = investors.filter(i =>
    (type === "all" || i.type === type) && (stage === "all" || i.stage === stage) &&
    (!q || `${i.name} ${i.city ?? ""} ${i.country ?? ""} ${(i.contacts ?? []).map(c => `${c.name} ${c.email ?? ""}`).join(" ")}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : ((sort === "fit" ? (b.fitScore ?? -1) - (a.fitScore ?? -1) : (b.probability ?? -1) - (a.probability ?? -1))));

  return (
    <div>
      <Topbar title="Investor map" subtitle={state === "ok" ? `${investors.length} investors · ${INVESTOR_TYPES.filter(t => counts[t.key]).length} types` : ""}
        actions={<><SheetSyncButton sheet={sheet} onDone={load} /><Button variant="fill" size="sm" onClick={() => setAdding(true)}>+ Add investor</Button></>} />
      <div className="p-6 space-y-5">
        {/* One tile per investor type: click to filter */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {INVESTOR_TYPES.map(t => (
            <button key={t.key} onClick={() => setType(v => (v === t.key ? "all" : t.key))}
              className={`text-left p-4 border transition-colors duration-300 ${type === t.key ? "bg-olive border-olive text-white" : "bg-paper border-chalk hover:border-olive/40"}`}>
              <span className="block w-6 h-[3px] mb-3" style={{ background: t.color }} />
              <p className={`font-display text-[28px] font-light leading-none ${type === t.key ? "text-white" : "text-carbon"}`}>{counts[t.key] ?? 0}</p>
              <p className={`text-[11px] mt-2 leading-snug ${type === t.key ? "text-white/75" : "text-graphite"}`}>{t.label}</p>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, city or contact…" className="text-[12px] bg-paper border border-chalk px-3 py-1.5 text-carbon w-full sm:w-[260px]" />
          <select value={stage} onChange={e => setStage(e.target.value)} className="text-[12px] bg-paper border border-chalk px-2.5 py-1.5 text-graphite">
            <option value="all">All stages</option>
            {INVESTOR_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sort" className="text-[12px] bg-paper border border-chalk px-2.5 py-1.5 text-graphite">
            <option value="name">Sort by name</option>
            <option value="fit">Best fit first</option>
            <option value="probability">Most likely first</option>
          </select>
          {type !== "all" && <button onClick={() => setType("all")} className="text-[12px] text-slate hover:text-carbon">Clear type filter ×</button>}
        </div>

        {state === "loading" ? <Card><p className="text-[13px] text-slate">Loading…</p></Card>
          : state === "error" ? <Card><p className="text-[13px] mb-2">Couldn&apos;t load the investors</p><Button size="sm" variant="outline" onClick={load}>Try again</Button></Card>
          : investors.length === 0 ? (
            <Card className="text-center py-12">
              <p className="eyebrow">Fundraising</p>
              <p className="mt-3 font-display text-[22px] font-light text-carbon">Map the investors Pando is raising from</p>
              <p className="text-[12px] text-slate mt-2 mb-5 max-w-md mx-auto">Family offices, AFOREs, institutional investors, DFIs… Add each one with its contact, ticket and next step, then follow them in the investor pipeline.</p>
              <Button variant="fill" size="sm" onClick={() => setAdding(true)}>+ Add the first investor</Button>
            </Card>
          ) : (
            <Card padding="none" className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-chalk text-slate text-[10px] uppercase">
                    {["Investor", "Fit", "Chance", "Type", "Location", "Contact", "Stage", "Ticket / committed", "Owner", "Next step"].map(h => <th key={h} className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(i => (
                    <tr key={i.id} onClick={() => router.push(`/fundraising/investors/${i.id}`)} className="border-b border-chalk last:border-0 hover:bg-fog/50 cursor-pointer">
                      <td className="px-4 py-2.5 font-semibold text-carbon whitespace-nowrap">{i.name}</td>
                      <td className="px-4 py-2.5"><span className={`text-[11px] font-semibold border px-1.5 py-0.5 ${scoreTone(i.fitScore)}`}>{i.fitScore ?? "—"}</span></td>
                      <td className="px-4 py-2.5"><span className={`text-[11px] font-semibold border px-1.5 py-0.5 ${scoreTone(i.probability)}`}>{i.probability != null ? `${i.probability}%` : "—"}</span></td>
                      <td className="px-4 py-2.5 text-graphite whitespace-nowrap">{INVESTOR_TYPES.find(t => t.key === i.type)?.label ?? i.type}</td>
                      <td className="px-4 py-2.5 text-graphite whitespace-nowrap">{[i.city, i.country].filter(Boolean).join(", ") || "—"}</td>
                      <td className="px-4 py-2.5 text-graphite whitespace-nowrap">{i.contactName ? `${i.contactName}${i.contactRole ? ` · ${i.contactRole}` : ""}` : "—"}{(i.contacts?.length ?? 0) > 1 ? <span className="text-slate"> +{i.contacts!.length - 1}</span> : null}</td>
                      <td className="px-4 py-2.5"><span className={`text-[10px] font-medium border px-2 py-0.5 whitespace-nowrap ${stageCls(i.stage)}`}>{investorStageInfo(i.stage).label}</span></td>
                      <td className="px-4 py-2.5 text-carbon whitespace-nowrap">{i.committedAmount != null ? fmtMoney(i.committedAmount, i.currency) : fmtMoney(i.targetAmount, i.currency)}</td>
                      <td className="px-4 py-2.5 text-graphite whitespace-nowrap">{i.owner?.name ?? "—"}</td>
                      <td className="px-4 py-2.5 text-graphite min-w-[240px]">{i.nextStep ?? "—"}{i.nextStepDate ? <span className="text-slate"> · {i.nextStepDate}</span> : null}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={10} className="px-4 py-6 text-center text-slate">No investors match these filters.</td></tr>}
                </tbody>
              </table>
            </Card>
          )}
      </div>
      {(editing || adding) && (
        <InvestorModal investor={editing} team={team} defaultType={type !== "all" ? type : undefined}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSaved={() => { setEditing(null); setAdding(false); load(); }} />
      )}
    </div>
  );
}
