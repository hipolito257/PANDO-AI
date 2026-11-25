"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Topbar } from "@/components/layout/Topbar";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetchJson";
import { NewDealModal } from "@/components/deals/NewDealModal";
import { StagesEditor } from "@/components/deals/StagesEditor";
import { DEAL_STATUSES, INTERESTS, isAlert } from "@/lib/dealRating";
import { Avatar, DEAL_TYPE_LABEL, StagePill, fmtDay, fmtSize, type Stage } from "@/components/deals/dealUi";
import { DEAL_DRAG_END, DEAL_DRAG_START, DEAL_DRAG_TYPE, DEAL_MOVED, PHASES, moveDealToPhase, phaseInfo, type Phase } from "@/lib/phases";

type DealCard = {
  id: string; codeName: string; type: string; stage: string; onHold: boolean; statusNote: string | null;
  interest: string; dealStatus: string;
  dealSize: number | null; currency: string; updatedAt: string; leadUserId: string | null;
  company: { id: string; name: string; slug: string; sector: string | null; country: string } | null;
  lead: { id: string; name: string } | null;
  members: { userId: string; role: string; allocation: number; user: { id: string; name: string } }[];
  openTasks: number; overdueTasks: number;
  nextMilestone: { label: string; date: string } | null;
};

type BoardProps = {
  phase: Phase;
  title: string;
  /** Shown when the section has no deals yet. */
  emptyTitle: string;
  emptyText: string;
};

// The deals board of one section (Deal Sourcing, Portfolio or Exit). Cards drag
// between stages; while one is dragged, "Move to" targets for the other sections
// appear (and the sidebar sections light up) so a deal can change section.
export function DealBoard({ phase, title, emptyTitle, emptyText }: BoardProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const myId = session?.user?.id;
  const [deals, setDeals] = useState<DealCard[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [view, setView] = useState<"board" | "list">("board");
  const [mine, setMine] = useState(false);
  const [type, setType] = useState("all");
  const [interest, setInterest] = useState("all");
  const [status, setStatus] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [overPhase, setOverPhase] = useState<string | null>(null);
  const [editStages, setEditStages] = useState(false);
  const isAdmin = session?.user?.role === "admin";

  const load = useCallback(async () => {
    try {
      const d = await fetchJson<{ deals: DealCard[]; stages: Stage[] }>(`/api/deals?phase=${phase}`);
      setDeals(d.deals); setStages(d.stages); setState("ok");
    } catch {
      setState("error");
    }
  }, [phase]);
  useEffect(() => { load(); }, [load]);
  // A deal moved to another section (from here, the sidebar or a deal page): refresh.
  useEffect(() => {
    const onMoved = () => load();
    window.addEventListener(DEAL_MOVED, onMoved);
    return () => window.removeEventListener(DEAL_MOVED, onMoved);
  }, [load]);

  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);

  async function moveToPhase(dealId: string, target: Phase) {
    const deal = deals.find(d => d.id === dealId);
    if (!deal || target === phase) return;
    setDeals(ds => ds.filter(d => d.id !== dealId)); // optimistic: it leaves this board
    const r = await moveDealToPhase(dealId, target);
    if (!r.ok) { setToast({ text: r.error ?? "Couldn't move the deal" }); load(); return; }
    setToast({
      text: `${deal.codeName} moved to ${phaseInfo(target).label}`,
      undo: async () => { await moveDealToPhase(dealId, phase); load(); setToast(null); },
    });
  }

  function startDrag(e: React.DragEvent, id: string) {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DEAL_DRAG_TYPE, id);
    e.dataTransfer.setData("text/plain", id);
    window.dispatchEvent(new CustomEvent(DEAL_DRAG_START, { detail: { dealId: id, phase } }));
  }
  function endDrag() {
    setDragId(null);
    window.dispatchEvent(new Event(DEAL_DRAG_END));
  }

  // Changes read from the team's Google Sheet that are waiting for someone to approve them.
  const [sheet, setSheet] = useState<{ connected: boolean; pending: number } | null>(null);
  useEffect(() => {
    if (phase !== "sourcing") return;
    fetch("/api/sheet-sync").then(r => (r.ok ? r.json() : null)).then(j => {
      if (!j) return;
      const pending = (j.pending?.changes ?? []).filter((c: { kind: string }) => c.kind === "update" || c.kind === "create").length;
      setSheet({ connected: !!j.sync, pending });
    }).catch(() => {});
  }, [phase]);

  const visible = useMemo(() => deals.filter(d =>
    (!mine || d.members.some(m => m.userId === myId) || d.leadUserId === myId) && (type === "all" || d.type === type)
    && (interest === "all" || d.interest === interest) && (status === "all" || d.dealStatus === status),
  ), [deals, mine, type, myId, interest, status]);
  const alerts = deals.filter(isAlert);

  async function rate(dealId: string, patch: { interest?: string; dealStatus?: string }) {
    setDeals(ds => ds.map(d => (d.id === dealId ? { ...d, ...patch, onHold: patch.dealStatus ? patch.dealStatus === "on_hold" : d.onHold } : d)));
    const res = await fetch(`/api/deals/${dealId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!res.ok) load();
  }

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
      <Topbar title={title} subtitle={state === "ok" ? `${active.length} active · ${deals.length} total` : ""}
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
          <select value={interest} onChange={e => setInterest(e.target.value)} aria-label="Interest" className="text-[12px] bg-paper border border-chalk rounded-[8px] px-2.5 py-1.5 text-graphite">
            <option value="all">All interest</option>
            {INTERESTS.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
          </select>
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status" className="text-[12px] bg-paper border border-chalk rounded-[8px] px-2.5 py-1.5 text-graphite">
            <option value="all">All statuses</option>
            {DEAL_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {phase === "sourcing" ? <Link href="/deals/sync" className="ml-auto text-[12px] text-slate hover:text-carbon">
            {sheet?.connected ? "Google Sheet sync" : "Sync from Google Sheet"}
          </Link> : <span className="ml-auto" />}
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

        {/* High interest + pending: these need a next step. */}
        {alerts.length > 0 && (
          <div className="border border-red-200 bg-red-50 px-4 py-3" role="alert">
            <p className="text-[13px] text-red-800 font-medium">⚠ {alerts.length} high-interest deal{alerts.length === 1 ? " is" : "s are"} pending</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {alerts.map(d => (
                <Link key={d.id} href={`/deals/${d.id}`} className="text-[12px] bg-paper border border-red-200 px-2.5 py-1 text-carbon hover:border-red-500">
                  <b>{d.codeName}</b>{d.company?.name && d.company.name !== d.codeName ? ` · ${d.company.name}` : ""}{d.statusNote ? <span className="text-slate"> · {d.statusNote}</span> : null}
                </Link>
              ))}
            </div>
          </div>
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
            <p className="text-[14px] font-semibold text-carbon">{emptyTitle}</p>
            <p className="text-[12px] text-slate mt-1 mb-4 max-w-md mx-auto">{emptyText}</p>
            <Button variant="fill" size="sm" onClick={() => setShowNew(true)}>+ New deal</Button>
          </Card>
        ) : view === "board" ? (
          <>
          {/* While a card is dragged: drop it on another section to move the deal there. */}
          <div className={`grid gap-2 transition-all duration-300 ${dragId ? "grid-cols-2 opacity-100 max-h-24" : "grid-cols-2 opacity-0 max-h-0 overflow-hidden pointer-events-none"}`}>
            {PHASES.filter(p => p.key !== phase).map(p => (
              <div key={p.key}
                onDragOver={e => { e.preventDefault(); setOverPhase(p.key); }}
                onDragLeave={() => setOverPhase(o => (o === p.key ? null : o))}
                onDrop={e => { e.preventDefault(); const id = dragId; setOverPhase(null); endDrag(); if (id) moveToPhase(id, p.key); }}
                className={`flex items-center justify-center gap-2 border border-dashed py-4 font-display text-[11px] uppercase tracking-[.18em] transition-colors duration-200 ${overPhase === p.key ? "border-olive bg-pistacho text-olive" : "border-olive/40 bg-paper text-olive/70"}`}>
                Move to {p.label} <span aria-hidden>→</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3 overflow-x-auto pb-3">
            {stages.map(s => {
              const cards = visible.filter(d => d.stage === s.key);
              return (
                <div key={s.key}
                  onDragOver={e => { e.preventDefault(); setOverStage(s.key); }}
                  onDragLeave={() => setOverStage(o => (o === s.key ? null : o))}
                  onDrop={() => { if (dragId) moveTo(dragId, s.key); setOverStage(null); endDrag(); }}
                  className={`w-[250px] shrink-0 rounded-[10px] p-2 transition-colors duration-200 ${overStage === s.key && dragId ? "bg-pistacho/60" : s.kind === "open" ? "bg-fog" : "bg-fog/50"}`}>
                  <div className="flex items-center justify-between px-1 pb-2">
                    <p className="text-[12px] font-semibold text-carbon">{s.label}</p>
                    <span className="text-[11px] text-slate">{cards.length}</span>
                  </div>
                  <div className="space-y-2 min-h-[60px]">
                    {cards.map(d => (
                      <div key={d.id} draggable
                        onDragStart={e => startDrag(e, d.id)} onDragEnd={endDrag}
                        onClick={e => { if (!(e.target as HTMLElement).closest("select, a")) router.push(`/deals/${d.id}`); }}
                        className={`block bg-paper rounded-[8px] border p-3 transition-all duration-200 cursor-grab active:cursor-grabbing ${isAlert(d) ? "border-red-400 ring-1 ring-red-300 hover:border-red-600" : d.interest === "low" ? "border-chalk opacity-75 hover:opacity-100 hover:border-carbon" : "border-chalk hover:border-carbon"} ${dragId === d.id ? "opacity-40 scale-[0.98]" : ""}`}>
                        <Link href={`/deals/${d.id}`} draggable={false} className="text-[13px] font-semibold text-carbon leading-snug hover:underline">{d.codeName}</Link>
                        <p className="text-[11px] text-graphite">{d.company?.name}{d.company?.country ? ` · ${d.company.country}` : ""}</p>
                        <p className="text-[10px] text-slate mt-0.5">{DEAL_TYPE_LABEL[d.type] ?? d.type}{d.dealSize != null ? ` · ${fmtSize(d.dealSize, d.currency)}` : ""}</p>
                        {/* Change interest and status right here, without opening the deal */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {isAlert(d) && <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-red-600 text-white" title="High interest and pending">⚠ Alert</span>}
                          <PillSelect value={d.interest} options={INTERESTS.map(i => ({ key: i.key, label: i.label, short: i.short, cls: i.cls }))}
                            label={`Interest in ${d.codeName}`} onChange={v => rate(d.id, { interest: v })} />
                          <PillSelect value={d.dealStatus} options={DEAL_STATUSES.map(s => ({ key: s.key, label: s.label, short: s.label, cls: s.cls }))}
                            label={`Status of ${d.codeName}`} onChange={v => rate(d.id, { dealStatus: v })} />
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex -space-x-1.5">
                            {d.members.slice(0, 4).map(m => <Avatar key={m.userId} name={m.user.name} size={20} title={`${m.user.name} · ${m.allocation}%`} />)}
                          </div>
                          <div className="text-[10px] text-slate text-right">
                            {d.openTasks > 0 && <span className={d.overdueTasks ? "text-red-600 font-medium" : ""}>{d.openTasks} task{d.openTasks === 1 ? "" : "s"}{d.overdueTasks ? ` (${d.overdueTasks} late)` : ""}</span>}
                            {d.nextMilestone && <span className="block">{d.nextMilestone.label} · {fmtDay(d.nextMilestone.date)}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          </>
        ) : (
          <Card padding="none" className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-chalk text-slate text-[10px] uppercase tracking-wide">
                  {["Deal", "Company", "Stage", "Interest", "Status", "Type", "Size", "Team", "Open tasks", "Next milestone", "Section"].map(h => <th key={h} className="text-left font-semibold px-4 py-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map(d => (
                  <tr key={d.id} className={`border-b border-chalk last:border-0 ${isAlert(d) ? "bg-red-50 hover:bg-red-100/60" : "hover:bg-fog/50"}`}>
                    <td className="px-4 py-2.5 whitespace-nowrap">{isAlert(d) && <span className="text-red-600 mr-1" title="High interest and pending">⚠</span>}<Link href={`/deals/${d.id}`} className="font-semibold text-carbon hover:underline">{d.codeName}</Link></td>
                    <td className="px-4 py-2.5 text-graphite">{d.company?.name}</td>
                    <td className="px-4 py-2.5"><StagePill stage={stageByKey.get(d.stage)} /></td>
                    <td className="px-4 py-2.5">
                      <select value={d.interest} onChange={e => rate(d.id, { interest: e.target.value })} aria-label={`Interest in ${d.codeName}`} className="text-[11px] bg-paper border border-chalk px-1.5 py-1 text-graphite">
                        {INTERESTS.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <select value={d.dealStatus} onChange={e => rate(d.id, { dealStatus: e.target.value })} aria-label={`Status of ${d.codeName}`} className="text-[11px] bg-paper border border-chalk px-1.5 py-1 text-graphite">
                        {DEAL_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-graphite">{DEAL_TYPE_LABEL[d.type] ?? d.type}</td>
                    <td className="px-4 py-2.5 text-graphite">{fmtSize(d.dealSize, d.currency)}</td>
                    <td className="px-4 py-2.5"><div className="flex -space-x-1.5">{d.members.slice(0, 5).map(m => <Avatar key={m.userId} name={m.user.name} size={20} />)}</div></td>
                    <td className={`px-4 py-2.5 ${d.overdueTasks ? "text-red-600 font-medium" : "text-graphite"}`}>{d.openTasks || "—"}{d.overdueTasks ? ` (${d.overdueTasks} late)` : ""}</td>
                    <td className="px-4 py-2.5 text-graphite">{d.nextMilestone ? `${d.nextMilestone.label} · ${fmtDay(d.nextMilestone.date)}` : "—"}</td>
                    <td className="px-4 py-2.5">
                      <select value={phase} onChange={e => moveToPhase(d.id, e.target.value as Phase)} aria-label={`Section of ${d.codeName}`}
                        className="text-[11px] bg-paper border border-chalk px-1.5 py-1 text-graphite">
                        {PHASES.map(p => <option key={p.key} value={p.key}>{p.short}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {showNew && <NewDealModal phase={phase} onClose={() => setShowNew(false)} />}
      {editStages && <StagesEditor stages={stages} phase={phase} onClose={() => setEditStages(false)} onSaved={s => { setStages(s); setEditStages(false); }} />}

      {toast && (
        <div className="fixed bottom-[calc(20px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-olive text-paper px-5 py-3 shadow-float text-[13px]">
          <span>{toast.text}</span>
          {toast.undo && <button onClick={toast.undo} className="font-display text-[11px] uppercase tracking-[.16em] text-pistacho hover:underline">Undo</button>}
        </div>
      )}
    </div>
  );
}

// A pill that is also a dropdown: change it on the card without opening the deal.
function PillSelect({ value, options, label, onChange }: {
  value: string; label: string; onChange: (v: string) => void;
  options: { key: string; label: string; short: string; cls: string }[];
}) {
  const cur = options.find(o => o.key === value) ?? options[0];
  return (
    <span className={`relative inline-flex items-center text-[10px] font-medium rounded-full border pl-2 pr-4 py-0.5 hover:ring-1 hover:ring-olive/30 ${cur.cls}`}
      onClick={e => e.stopPropagation()}>
      {cur.short}
      <svg width="7" height="7" viewBox="0 0 10 10" className="absolute right-1.5 opacity-60" aria-hidden><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" /></svg>
      <select value={value} aria-label={label} title={label} onChange={e => onChange(e.target.value)}
        draggable={false} className="absolute inset-0 opacity-0 cursor-pointer w-full">
        {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </span>
  );
}
