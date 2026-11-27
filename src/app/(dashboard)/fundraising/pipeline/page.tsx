"use client";
// Fundraising › Investor pipeline: investors move between stages by dragging
// their card (on a phone, tap a card and change its stage).
import { TopScroll } from "@/components/ui/TopScroll";
import { useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { InvestorModal, SheetSyncButton, useInvestors } from "@/components/fundraising/InvestorModal";
import { useRouter } from "next/navigation";
import { INVESTOR_STAGES, fmtMoney, investorTypeInfo, type Investor, scoreTone } from "@/lib/fundraising";

export default function InvestorPipelinePage() {
  const { investors, team, state, load, patch, sheet } = useInvestors();
  const router = useRouter();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [editing, setEditing] = useState<Investor | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [type, setType] = useState("all");

  const visible = investors.filter(i => type === "all" || i.type === type);
  const inPlay = investors.filter(i => !["committed", "declined"].includes(i.stage)).length;

  return (
    <div>
      <Topbar title="Investor pipeline" subtitle={state === "ok" ? `${inPlay} in conversation · ${investors.length} total` : ""}
        actions={<><SheetSyncButton sheet={sheet} onDone={load} /><Button variant="fill" size="sm" onClick={() => setAdding("identified")}>+ Add investor</Button></>} />
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <select value={type} onChange={e => setType(e.target.value)} className="text-[12px] bg-paper border border-chalk px-2.5 py-1.5 text-graphite">
            <option value="all">All investor types</option>
            {[...new Set(investors.map(i => i.type))].map(t => <option key={t} value={t}>{investorTypeInfo(t).label}</option>)}
          </select>
          <p className="text-[11px] text-slate ml-auto hidden md:block">Drag a card to move an investor to another stage.</p>
        </div>
        {state === "loading" ? <Card><p className="text-[13px] text-slate">Loading…</p></Card>
          : state === "error" ? <Card><p className="text-[13px] mb-2">Couldn&apos;t load the investors</p><Button size="sm" variant="outline" onClick={load}>Try again</Button></Card>
          : (
            <TopScroll>
            <div className="flex gap-3 pb-3 w-max min-w-full">
              {INVESTOR_STAGES.map(s => {
                const cards = visible.filter(i => i.stage === s.key);
                const amount = cards.reduce((n, i) => n + (i.committedAmount ?? i.targetAmount ?? 0), 0);
                const cur = cards[0]?.currency ?? "USD";
                return (
                  <div key={s.key}
                    onDragOver={e => { e.preventDefault(); setOver(s.key); }}
                    onDragLeave={() => setOver(o => (o === s.key ? null : o))}
                    onDrop={() => { if (dragId) patch(dragId, { stage: s.key }); setDragId(null); setOver(null); }}
                    className={`w-[250px] shrink-0 p-2 transition-colors duration-200 ${over === s.key && dragId ? "bg-pistacho/60" : s.kind === "open" ? "bg-fog" : "bg-fog/50"}`}>
                    <div className="px-1 pb-2">
                      <div className="flex items-center justify-between">
                        <p className="font-display text-[11px] uppercase tracking-[.16em] text-carbon pt-[2px]">{s.label}</p>
                        <span className="text-[11px] text-slate">{cards.length}</span>
                      </div>
                      {amount > 0 && <p className="text-[10px] text-slate mt-0.5">{fmtMoney(amount, cur)}</p>}
                    </div>
                    <div className="space-y-2 min-h-[60px]">
                      {cards.map(i => (
                        <button key={i.id} draggable onClick={() => router.push(`/fundraising/investors/${i.id}`)}
                          onDragStart={e => { setDragId(i.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", i.id); }}
                          onDragEnd={() => { setDragId(null); setOver(null); }}
                          className={`w-full text-left bg-paper border border-chalk p-3 hover:border-olive transition-all duration-200 cursor-grab active:cursor-grabbing ${dragId === i.id ? "opacity-40 scale-[0.98]" : ""}`}>
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: investorTypeInfo(i.type).color }} />
                            <span className="text-[10px] text-slate truncate">{investorTypeInfo(i.type).label}</span>
                          </div>
                          <div className="flex items-start justify-between gap-2 mt-1">
                            <p className="text-[13px] font-semibold text-carbon leading-snug">{i.name}</p>
                            {i.probability != null && <span title={`Chance to commit · fit ${i.fitScore ?? "—"}/100`} className={`shrink-0 text-[10px] font-semibold border px-1.5 py-0.5 ${scoreTone(i.probability)}`}>{i.probability}%</span>}
                          </div>
                          <p className="text-[11px] text-graphite">{[i.city, i.country].filter(Boolean).join(", ")}</p>
                          {(i.committedAmount ?? i.targetAmount) != null && (
                            <p className="text-[11px] text-carbon mt-1">{i.committedAmount != null ? "Committed " : "Ticket "}{fmtMoney(i.committedAmount ?? i.targetAmount, i.currency)}</p>
                          )}
                          {i.nextStep && <p className="text-[10px] text-slate mt-1.5 pt-1.5 border-t border-chalk">Next: {i.nextStep}{i.nextStepDate ? ` · ${i.nextStepDate.slice(5)}` : ""}</p>}
                        </button>
                      ))}
                      <button onClick={() => setAdding(s.key)} className="w-full text-[11px] text-slate hover:text-olive py-1.5 border border-dashed border-transparent hover:border-olive/30 transition-colors">+ Add</button>
                    </div>
                  </div>
                );
              })}
            </div>
            </TopScroll>
          )}
      </div>
      {(editing || adding) && (
        <InvestorModal investor={editing} team={team} defaultStage={adding ?? undefined}
          onClose={() => { setEditing(null); setAdding(null); }}
          onSaved={() => { setEditing(null); setAdding(null); load(); }} />
      )}
    </div>
  );
}
