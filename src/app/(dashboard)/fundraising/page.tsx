"use client";
// Fundraising › Overview: committed vs. target, the funnel by stage, who the
// money comes from (by investor type) and the next steps due.
import { useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { InvestorModal, useInvestors } from "@/components/fundraising/InvestorModal";
import { INVESTOR_STAGES, INVESTOR_TYPES, fmtMoney, investorStageInfo, type Investor } from "@/lib/fundraising";

const input = "text-[13px] bg-paper border border-chalk px-3 py-2 text-carbon focus:outline-none focus:border-olive";

export default function FundraisingOverviewPage() {
  const { investors, team, fund, state, load, setFund } = useInvestors();
  const [editingFund, setEditingFund] = useState(false);
  const [draft, setDraft] = useState({ name: "", target: "", currency: "USD" });
  const [editing, setEditing] = useState<Investor | null>(null);
  const [adding, setAdding] = useState(false);

  const cur = fund.currency || "USD";
  const amt = (i: Investor) => i.committedAmount ?? i.targetAmount ?? 0;
  const committed = investors.filter(i => i.stage === "committed").reduce((n, i) => n + (i.committedAmount ?? 0), 0);
  const soft = investors.filter(i => i.stage === "soft_commit").reduce((n, i) => n + amt(i), 0);
  const pipeline = investors.filter(i => !["committed", "declined", "soft_commit"].includes(i.stage)).reduce((n, i) => n + (i.targetAmount ?? 0), 0);
  const target = fund.target ?? 0;
  const pct = (v: number) => (target ? Math.min(100, (v / target) * 100) : 0);
  const today = new Date().toISOString().slice(0, 10);
  const nextSteps = investors.filter(i => i.nextStep && !["committed", "declined"].includes(i.stage))
    .sort((a, b) => (a.nextStepDate ?? "9999").localeCompare(b.nextStepDate ?? "9999")).slice(0, 8);
  const byType = INVESTOR_TYPES.map(t => {
    const list = investors.filter(i => i.type === t.key && i.stage !== "declined");
    return { ...t, count: list.length, committed: list.filter(i => i.stage === "committed").reduce((n, i) => n + (i.committedAmount ?? 0), 0), pipeline: list.reduce((n, i) => n + amt(i), 0) };
  }).filter(t => t.count);
  const maxType = Math.max(1, ...byType.map(t => t.pipeline));

  async function saveFund() {
    const body = { name: draft.name, target: draft.target, currency: draft.currency };
    await fetch("/api/investors", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setFund({ name: draft.name || null, target: Number(String(draft.target).replace(/[,\s$]/g, "")) || null, currency: draft.currency });
    setEditingFund(false);
  }

  return (
    <div>
      <Topbar title="Fundraising" subtitle={fund.name ?? "Investor relations and capital raising"}
        actions={<Button variant="fill" size="sm" onClick={() => setAdding(true)}>+ Add investor</Button>} />
      <div className="p-6 space-y-5">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow">{fund.name ?? "The fund"}</p>
              <p className="mt-3 font-display text-[clamp(2rem,4vw,3rem)] font-light leading-none text-carbon">
                {fmtMoney(committed, cur)} <span className="text-[16px] text-slate">committed</span>
              </p>
              <p className="text-[12px] text-graphite mt-2">
                {target ? <>Target {fmtMoney(target, cur)} · <b className="font-semibold">{pct(committed).toFixed(0)}%</b> raised</> : "Set the fund's target to see progress."}
              </p>
            </div>
            {editingFund ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[11px] text-slate">Fund name<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className={`${input} block mt-1 w-[180px]`} placeholder="e.g. Pando Fund I" /></label>
                <label className="text-[11px] text-slate">Target<input inputMode="decimal" value={draft.target} onChange={e => setDraft({ ...draft, target: e.target.value })} className={`${input} block mt-1 w-[150px]`} placeholder="e.g. 150000000" /></label>
                <label className="text-[11px] text-slate">Currency<select value={draft.currency} onChange={e => setDraft({ ...draft, currency: e.target.value })} className={`${input} block mt-1`}>{["USD", "MXN", "EUR"].map(c => <option key={c}>{c}</option>)}</select></label>
                <Button size="sm" variant="fill" onClick={saveFund}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingFund(false)}>Cancel</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => { setDraft({ name: fund.name ?? "", target: fund.target ? String(fund.target) : "", currency: cur }); setEditingFund(true); }}>
                {target ? "Edit target" : "Set fund target"}
              </Button>
            )}
          </div>
          {target > 0 && (
            <div className="mt-5">
              <div className="h-2.5 bg-fog relative overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-olive transition-all duration-700" style={{ width: `${pct(committed)}%` }} />
                <div className="absolute inset-y-0 bg-pistacho transition-all duration-700" style={{ left: `${pct(committed)}%`, width: `${Math.min(100 - pct(committed), pct(soft))}%` }} />
                <div className="absolute inset-y-0 bg-sage/40 transition-all duration-700" style={{ left: `${pct(committed) + pct(soft)}%`, width: `${Math.max(0, Math.min(100 - pct(committed) - pct(soft), pct(pipeline)))}%` }} />
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[11px] text-graphite">
                <span><span className="inline-block w-2 h-2 bg-olive mr-1.5" />Committed {fmtMoney(committed, cur)}</span>
                <span><span className="inline-block w-2 h-2 bg-pistacho mr-1.5" />Soft commits {fmtMoney(soft, cur)}</span>
                <span><span className="inline-block w-2 h-2 bg-sage/40 mr-1.5" />In conversation {fmtMoney(pipeline, cur)}</span>
              </div>
            </div>
          )}
        </Card>

        {state === "ok" && investors.length === 0 ? (
          <Card className="text-center py-12">
            <p className="eyebrow">Fundraising</p>
            <p className="mt-3 font-display text-[22px] font-light text-carbon">Start mapping your investors</p>
            <p className="text-[12px] text-slate mt-2 mb-5 max-w-md mx-auto">Add family offices, AFOREs and institutional investors with their ticket and next step. Their progress shows up here and in the investor pipeline.</p>
            <Button variant="fill" size="sm" onClick={() => setAdding(true)}>+ Add the first investor</Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <SectionHeader title="Funnel" subtitle="Investors by stage" action={<Link href="/fundraising/pipeline" className="text-[11px] text-olive hover:underline">Open pipeline →</Link>} />
              <div className="space-y-2">
                {INVESTOR_STAGES.map(s => {
                  const list = investors.filter(i => i.stage === s.key);
                  const max = Math.max(1, ...INVESTOR_STAGES.map(x => investors.filter(i => i.stage === x.key).length));
                  return (
                    <div key={s.key} className="flex items-center gap-3">
                      <span className="w-[96px] text-[11px] text-graphite shrink-0">{s.label}</span>
                      <div className="flex-1 h-5 bg-fog relative">
                        <div className={`absolute inset-y-0 left-0 ${s.kind === "won" ? "bg-olive" : s.kind === "lost" ? "bg-chalk" : "bg-sage/60"}`} style={{ width: `${(list.length / max) * 100}%` }} />
                      </div>
                      <span className="w-6 text-right text-[12px] text-carbon">{list.length}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card>
              <SectionHeader title="By investor type" subtitle="Ticket or commitment, excluding declined" action={<Link href="/fundraising/investors" className="text-[11px] text-olive hover:underline">Investor map →</Link>} />
              {byType.length === 0 ? <p className="text-[12px] text-slate">No investors yet.</p> : (
                <div className="space-y-3">
                  {byType.map(t => (
                    <div key={t.key}>
                      <div className="flex justify-between text-[11px]"><span className="text-carbon">{t.label} <span className="text-slate">· {t.count}</span></span><span className="text-graphite">{fmtMoney(t.pipeline, cur)}</span></div>
                      <div className="h-1.5 bg-fog mt-1"><div className="h-1.5" style={{ width: `${(t.pipeline / maxType) * 100}%`, background: t.color }} /></div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <SectionHeader title="Next steps" subtitle="Soonest first" />
              {nextSteps.length === 0 ? <p className="text-[12px] text-slate">No next steps set.</p> : (
                <div className="divide-y divide-chalk">
                  {nextSteps.map(i => (
                    <button key={i.id} onClick={() => setEditing(i)} className="w-full text-left flex items-start justify-between gap-3 py-2 hover:bg-fog/60 -mx-2 px-2">
                      <span className="text-[12px] text-carbon">{i.nextStep}<span className="block text-[10px] text-slate">{i.name} · {investorStageInfo(i.stage).label}</span></span>
                      {i.nextStepDate && <span className={`text-[11px] shrink-0 ${i.nextStepDate < today ? "text-red-600 font-medium" : "text-slate"}`}>{i.nextStepDate.slice(5)}</span>}
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
      {(editing || adding) && (
        <InvestorModal investor={editing} team={team}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSaved={() => { setEditing(null); setAdding(false); load(); }} />
      )}
    </div>
  );
}
