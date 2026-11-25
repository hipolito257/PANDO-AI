"use client";
// Portfolio › Companies: one card per portfolio company (deals in the Portfolio
// section) with its numbers, team and next milestone. Cards can be dragged onto
// the "Exit" section of the menu to start an exit.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/Topbar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetchJson";
import { Avatar, StagePill, fmtDay, fmtSize, type Stage } from "@/components/deals/dealUi";
import { NewDealModal } from "@/components/deals/NewDealModal";
import { DEAL_DRAG_END, DEAL_DRAG_START, DEAL_DRAG_TYPE, DEAL_MOVED } from "@/lib/phases";

type Company = { id: string; name: string; slug: string; sector: string | null; country: string; website: string | null;
  revenueUsd: number | null; ebitdaUsd: number | null; revenueGrowth: number | null; employees: number | null };
type PortfolioDeal = {
  id: string; codeName: string; stage: string; onHold: boolean; dealSize: number | null; currency: string;
  company: Company | null; lead: { id: string; name: string } | null;
  members: { userId: string; user: { id: string; name: string } }[];
  openTasks: number; overdueTasks: number; nextMilestone: { label: string; date: string } | null;
};

const fmtUsd = (v: number | null) => (v == null ? "—" : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}bn` : `$${(v / 1e6).toFixed(1)}m`);

export default function PortfolioPage() {
  const [rows, setRows] = useState<PortfolioDeal[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [showNew, setShowNew] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchJson<{ deals: PortfolioDeal[]; stages: Stage[] }>("/api/deals?phase=portfolio");
      setRows(d.deals); setStages(d.stages); setState("ok");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onMoved = () => load();
    window.addEventListener(DEAL_MOVED, onMoved);
    return () => window.removeEventListener(DEAL_MOVED, onMoved);
  }, [load]);

  const stageByKey = new Map(stages.map(s => [s.key, s]));
  const currencies = [...new Set(rows.filter(r => r.dealSize != null).map(r => r.currency))];
  const invested = currencies.length === 1 ? rows.reduce((n, r) => n + (r.dealSize ?? 0), 0) : null;
  const late = rows.reduce((n, r) => n + r.overdueTasks, 0);

  return (
    <div>
      <Topbar title="Portfolio" subtitle={state === "ok" ? `${rows.length} compan${rows.length === 1 ? "y" : "ies"}` : ""}
        actions={<Button variant="fill" size="sm" onClick={() => setShowNew(true)}>+ Add company</Button>} />
      <div className="p-6 space-y-5">
        {state === "ok" && rows.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { v: String(rows.length), l: "Portfolio companies" },
              { v: invested != null ? fmtSize(invested, currencies[0]) : "Mixed", l: "Invested (deal size)" },
              { v: String(rows.filter(r => r.stage === "pf_watchlist" || r.onHold).length), l: "On the watchlist" },
              { v: String(late), l: "Overdue tasks" },
            ].map(k => (
              <Card key={k.l}>
                <p className="eyebrow !text-[10px] !tracking-[.22em] mb-2">{k.l}</p>
                <p className="text-[30px] font-light text-carbon font-poly leading-none">{k.v}</p>
              </Card>
            ))}
          </div>
        )}

        {state === "loading" ? <Card><p className="text-[13px] text-slate">Loading the portfolio…</p></Card>
          : state === "error" ? (
            <Card><p className="text-[13px] text-carbon mb-2">Couldn&apos;t load the portfolio</p><Button variant="outline" size="sm" onClick={load}>Try again</Button></Card>
          ) : rows.length === 0 ? (
            <Card className="text-center py-12">
              <p className="eyebrow">Portfolio</p>
              <p className="mt-3 font-display text-[22px] font-light text-carbon">No portfolio companies yet</p>
              <p className="text-[12px] text-slate mt-2 mb-5 max-w-md mx-auto">When a deal closes, drag it from the Pipeline onto “Portfolio” in the menu, or use “Move to” on the deal.</p>
              <Link href="/deals"><Button variant="outline" size="sm">Open the pipeline</Button></Link>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {rows.map(d => {
                const c = d.company;
                const margin = c?.revenueUsd && c.ebitdaUsd != null ? (c.ebitdaUsd / c.revenueUsd) * 100 : null;
                return (
                  <div key={d.id} draggable
                    onDragStart={e => {
                      setDragId(d.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData(DEAL_DRAG_TYPE, d.id); e.dataTransfer.setData("text/plain", d.id);
                      window.dispatchEvent(new CustomEvent(DEAL_DRAG_START, { detail: { dealId: d.id, phase: "portfolio" } }));
                    }}
                    onDragEnd={() => { setDragId(null); window.dispatchEvent(new Event(DEAL_DRAG_END)); }}
                    className={`bg-paper shadow-card p-5 flex flex-col cursor-grab active:cursor-grabbing transition-all duration-200 ${dragId === d.id ? "opacity-40 scale-[0.98]" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="eyebrow !text-[10px]">{d.codeName}</p>
                        <Link href={`/deals/${d.id}`} className="block mt-1.5 font-display text-[20px] text-carbon leading-tight hover:underline truncate">{c?.name ?? d.codeName}</Link>
                        <p className="text-[11px] text-slate mt-0.5">{[c?.sector, c?.country].filter(Boolean).join(" · ")}</p>
                      </div>
                      <StagePill stage={stageByKey.get(d.stage)} onHold={d.onHold} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-chalk">
                      {[
                        { l: "Revenue", v: fmtUsd(c?.revenueUsd ?? null) },
                        { l: "EBITDA", v: fmtUsd(c?.ebitdaUsd ?? null) },
                        { l: margin != null ? "Margin" : "Growth", v: margin != null ? `${margin.toFixed(0)}%` : c?.revenueGrowth != null ? `${c.revenueGrowth.toFixed(0)}%` : "—" },
                      ].map(k => (
                        <div key={k.l}>
                          <p className="font-display text-[19px] font-light text-carbon leading-none">{k.v}</p>
                          <p className="text-[10px] text-slate mt-1 uppercase tracking-[.12em]">{k.l}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 text-[11px] text-graphite space-y-1 flex-1">
                      <p>Invested: <span className="text-carbon">{d.dealSize != null ? fmtSize(d.dealSize, d.currency) : "—"}</span>{d.lead ? <> · Lead: <span className="text-carbon">{d.lead.name}</span></> : null}</p>
                      {d.nextMilestone && <p>Next: <span className="text-carbon">{d.nextMilestone.label}</span> · {fmtDay(d.nextMilestone.date)}</p>}
                      {d.openTasks > 0 && <p className={d.overdueTasks ? "text-red-600" : ""}>{d.openTasks} open task{d.openTasks === 1 ? "" : "s"}{d.overdueTasks ? ` (${d.overdueTasks} late)` : ""}</p>}
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-chalk">
                      <div className="flex -space-x-1.5">{d.members.slice(0, 5).map(m => <Avatar key={m.userId} name={m.user.name} size={22} />)}</div>
                      <div className="flex gap-3 font-display text-[10.5px] uppercase tracking-[.16em]">
                        <Link href={`/deals/${d.id}`} className="text-olive hover:underline">Deal</Link>
                        {c && <Link href={`/valuation/${c.id}`} className="text-olive hover:underline">Valuation</Link>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        {rows.length > 0 && <p className="text-[11px] text-slate">Tip: drag a card onto “Exit” in the menu when Pando starts preparing that company&apos;s exit.</p>}
      </div>
      {showNew && <NewDealModal phase="portfolio" onClose={() => { setShowNew(false); load(); }} />}
    </div>
  );
}
