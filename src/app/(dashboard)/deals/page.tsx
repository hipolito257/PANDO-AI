"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Topbar } from "@/components/layout/Topbar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetchJson";
import { NewDealModal } from "@/components/deals/NewDealModal";
import { StagesEditor } from "@/components/deals/StagesEditor";
import { Avatar, DEAL_TYPE_LABEL, StagePill, fmtDay, fmtSize, type Stage } from "@/components/deals/dealUi";

type DealCard = {
  id: string; codeName: string; type: string; stage: string; onHold: boolean; statusNote: string | null;
  dealSize: number | null; currency: string; updatedAt: string; leadUserId: string | null;
  company: { id: string; name: string; slug: string; sector: string | null; country: string } | null;
  lead: { id: string; name: string } | null;
  members: { userId: string; role: string; allocation: number; user: { id: string; name: string } }[];
  openTasks: number; overdueTasks: number;
  nextMilestone: { label: string; date: string } | null;
};

export default function DealsPage() {
  const { data: session } = useSession();
  const myId = session?.user?.id;
  const [deals, setDeals] = useState<DealCard[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [view, setView] = useState<"board" | "list">("board");
  const [mine, setMine] = useState(false);
  const [type, setType] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [editStages, setEditStages] = useState(false);
  const isAdmin = session?.user?.role === "admin";

  const load = useCallback(async () => {
    try {
      const d = await fetchJson<{ deals: DealCard[]; stages: Stage[] }>("/api/deals");
      setDeals(d.deals); setStages(d.stages); setState("ok");
    } catch {
      setState("error");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Changes read from the team's Google Sheet that are waiting for someone to approve them.
  const [sheet, setSheet] = useState<{ connected: boolean; pending: number } | null>(null);
  useEffect(() => {
    fetch("/api/sheet-sync").then(r => (r.ok ? r.json() : null)).then(j => {
      if (!j) return;
      const pending = (j.pending?.changes ?? []).filter((c: { kind: string }) => c.kind === "update" || c.kind === "create").length;
      setSheet({ connected: !!j.sync, pending });
    }).catch(() => {});
  }, []);

  const visible = useMemo(() => deals.filter(d =>
    (!mine || d.members.some(m => m.userId === myId) || d.leadUserId === myId) && (type === "all" || d.type === type),
  ), [deals, mine, type, myId]);

  async function moveTo(dealId: string, stage: string) {
    const deal = deals.find(d => d.id === dealId);
    if (!deal || deal.stage === stage) return;
    setDeals(ds => ds.map(d => (d.id === dealId ? { ...d, stage } : d))); // optimistic
    const res = await fetch(`/api/deals/${dealId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }) });
    if (!res.ok) load();
  }

  const stageByKey = new Map(stages.map(s => [s.key, s]));
  const active = deals.filter(d => stageByKey.get(d.stage)?.kind === "open");

  return (
    <div>
      <Topbar title="Deals" subtitle={state === "ok" ? `${active.length} active · ${deals.length} total` : ""}
        actions={<Button variant="fill" size="sm" onClick={() => setShowNew(true)}>+ New deal</Button>} />

      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-paper border border-chalk rounded-[8px] p-0.5">
            {(["board", "list"] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`text-[12px] px-3 py-1 rounded-[6px] ${view === v ? "bg-carbon text-white" : "text-graphite hover:text-carbon"}`}>
                {v === "board" ? "Board" : "List"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-graphite bg-paper border border-chalk rounded-[8px] px-3 py-1.5">
            <input type="checkbox" checked={mine} onChange={() => setMine(v => !v)} /> My deals
          </label>
          <select value={type} onChange={e => setType(e.target.value)} className="text-[12px] bg-paper border border-chalk rounded-[8px] px-2.5 py-1.5 text-graphite">
            <option value="all">All types</option>
            {Object.entries(DEAL_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <Link href="/deals/sync" className="ml-auto text-[12px] text-slate hover:text-carbon">
            {sheet?.connected ? "Google Sheet sync" : "Sync from Google Sheet"}
          </Link>
          {isAdmin && (
            <button onClick={() => setEditStages(true)} className="text-[12px] text-slate hover:text-carbon">Edit stages</button>
          )}
        </div>

        {!!sheet?.pending && (
          <Link href="/deals/sync" className="flex items-center justify-between gap-3 bg-orange/10 border border-orange/30 rounded-[10px] px-4 py-2.5 hover:border-orange">
            <span className="text-[13px] text-carbon"><b>{sheet.pending} change{sheet.pending === 1 ? "" : "s"}</b> from the Google Sheet waiting for review</span>
            <span className="text-[12px] text-orange font-medium">Review →</span>
          </Link>
        )}

        {state === "loading" ? (
          <Card><p className="text-[13px] text-slate">Loading deals…</p></Card>
        ) : state === "error" ? (
          <Card>
            <p className="text-[13px] text-carbon mb-2">Couldn&apos;t load the deals</p>
            <Button variant="outline" size="sm" onClick={() => { setState("loading"); load(); }}>Try again</Button>
          </Card>
        ) : deals.length === 0 ? (
          <Card className="text-center py-10">
            <p className="text-[14px] font-semibold text-carbon">No deals yet</p>
            <p className="text-[12px] text-slate mt-1 mb-4">Create one for a company you&apos;re working on to track its team, stage, tasks and milestones.</p>
            <Button variant="fill" size="sm" onClick={() => setShowNew(true)}>+ New deal</Button>
          </Card>
        ) : view === "board" ? (
          <div className="flex gap-3 overflow-x-auto pb-3">
            {stages.map(s => {
              const cards = visible.filter(d => d.stage === s.key);
              return (
                <div key={s.key}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => { if (dragId) moveTo(dragId, s.key); setDragId(null); }}
                  className={`w-[250px] shrink-0 rounded-[10px] p-2 ${s.kind === "open" ? "bg-fog" : "bg-fog/50"}`}>
                  <div className="flex items-center justify-between px-1 pb-2">
                    <p className="text-[12px] font-semibold text-carbon">{s.label}</p>
                    <span className="text-[11px] text-slate">{cards.length}</span>
                  </div>
                  <div className="space-y-2 min-h-[60px]">
                    {cards.map(d => (
                      <Link key={d.id} href={`/deals/${d.id}`} draggable
                        onDragStart={() => setDragId(d.id)} onDragEnd={() => setDragId(null)}
                        className={`block bg-paper rounded-[8px] border border-chalk p-3 hover:border-carbon transition-colors ${dragId === d.id ? "opacity-50" : ""}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[13px] font-semibold text-carbon leading-snug">{d.codeName}</p>
                          {d.onHold && <StagePill stage={undefined} onHold />}
                        </div>
                        <p className="text-[11px] text-graphite">{d.company?.name}{d.company?.country ? ` · ${d.company.country}` : ""}</p>
                        <p className="text-[10px] text-slate mt-0.5">{DEAL_TYPE_LABEL[d.type] ?? d.type}{d.dealSize != null ? ` · ${fmtSize(d.dealSize, d.currency)}` : ""}</p>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex -space-x-1.5">
                            {d.members.slice(0, 4).map(m => <Avatar key={m.userId} name={m.user.name} size={20} title={`${m.user.name} · ${m.allocation}%`} />)}
                          </div>
                          <div className="text-[10px] text-slate text-right">
                            {d.openTasks > 0 && <span className={d.overdueTasks ? "text-red-600 font-medium" : ""}>{d.openTasks} task{d.openTasks === 1 ? "" : "s"}{d.overdueTasks ? ` (${d.overdueTasks} late)` : ""}</span>}
                            {d.nextMilestone && <span className="block">{d.nextMilestone.label} · {fmtDay(d.nextMilestone.date)}</span>}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <Card padding="none" className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-chalk text-slate text-[10px] uppercase tracking-wide">
                  {["Deal", "Company", "Stage", "Type", "Size", "Team", "Open tasks", "Next milestone"].map(h => <th key={h} className="text-left font-semibold px-4 py-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map(d => (
                  <tr key={d.id} className="border-b border-chalk last:border-0 hover:bg-fog/50">
                    <td className="px-4 py-2.5"><Link href={`/deals/${d.id}`} className="font-semibold text-carbon hover:underline">{d.codeName}</Link></td>
                    <td className="px-4 py-2.5 text-graphite">{d.company?.name}</td>
                    <td className="px-4 py-2.5"><StagePill stage={stageByKey.get(d.stage)} onHold={d.onHold} /></td>
                    <td className="px-4 py-2.5 text-graphite">{DEAL_TYPE_LABEL[d.type] ?? d.type}</td>
                    <td className="px-4 py-2.5 text-graphite">{fmtSize(d.dealSize, d.currency)}</td>
                    <td className="px-4 py-2.5"><div className="flex -space-x-1.5">{d.members.slice(0, 5).map(m => <Avatar key={m.userId} name={m.user.name} size={20} />)}</div></td>
                    <td className={`px-4 py-2.5 ${d.overdueTasks ? "text-red-600 font-medium" : "text-graphite"}`}>{d.openTasks || "—"}{d.overdueTasks ? ` (${d.overdueTasks} late)` : ""}</td>
                    <td className="px-4 py-2.5 text-graphite">{d.nextMilestone ? `${d.nextMilestone.label} · ${fmtDay(d.nextMilestone.date)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {showNew && <NewDealModal onClose={() => setShowNew(false)} />}
      {editStages && <StagesEditor stages={stages} onClose={() => setEditStages(false)} onSaved={s => { setStages(s); setEditStages(false); }} />}
    </div>
  );
}
