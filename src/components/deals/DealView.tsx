"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetchJson";
import { levelInfo } from "@/lib/availability";
import { ExecutiveSummary } from "@/components/deals/ExecutiveSummary";
import { ValuationSummary, type ValComp, type LboModelRef } from "@/components/comparables/ValuationPanel";
import { DEAL_STATUSES, INTERESTS, isAlert } from "@/lib/dealRating";
import { phaseInfo } from "@/lib/phases";
import { Avatar, CURRENCIES, DEAL_ROLE_LABEL, DEAL_TYPE_LABEL, StagePill, fmtDay, fmtSize, type Stage } from "@/components/deals/dealUi";

type Person = { id: string; name: string };
type Member = {
  id: string; userId: string; role: string; allocation: number;
  user: { id: string; name: string; email: string; role: string };
  availability: { level: string; createdAt: string | null } | null;
};
type Task = { id: string; title: string; status: string; dueDate: string | null; assigneeId: string | null; assignee: Person | null; completedAt: string | null };
type Milestone = { id: string; label: string; date: string | null; done: boolean };
type DealData = {
  deal: {
    id: string; codeName: string; type: string; stage: string; stageChangedAt: string | null; onHold: boolean; statusNote: string | null;
    interest: string; dealStatus: string;
    phase: string;
    leadUserId: string | null; dealSize: number | null; currency: string; description: string | null; createdAt: string;
    company: { id: string; name: string; slug: string; sector: string | null; country: string; description: string | null };
    members: Member[]; tasks: Task[]; milestones: Milestone[];
  };
  stages: Stage[];
  users: Person[];
  files: { id: string; filename: string; ext: string; sizeBytes: number; extractionStatus: string; uploadedByName: string | null; createdAt: string | null }[];
  valuation: { compSetId: string | null; config: string | null; comps: ValComp[]; lbos?: LboModelRef[] };
  decks: { id: string; title: string; filename: string; slideCount: number | null; createdAt: string; by: string }[];
  activity: { id: string; userName: string; action: string; entityName: string | null; detail: string | null; createdAt: string | null }[];
};

const ACTION_LABEL: Record<string, string> = {
  created_deal: "created the deal for", deal_stage_changed: "", deal_on_hold: "put the deal on hold",
  deal_resumed: "resumed the deal", deal_member_added: "added to the team:", deal_member_removed: "removed from the team:",
  deal_task_done: "completed a task:", deal_milestone_done: "reached a milestone:",
  uploaded_company_file: "uploaded a document:", applied_file_extraction: "applied document data:",
  edited_company: "edited the company", deal_rated: "", deal_status_changed: "", edited_deal: "", updated_availability: "updated availability",
};

function ago(iso: string | null) {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d < 1 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export type DealTab = "deal" | "company" | "financials" | "documents" | "intel";
export type CompanySlots = { actions: ReactNode; overview: ReactNode; financials: ReactNode; documents: ReactNode; intel: ReactNode; counts: { files: number; signals: number; news: number } } | null;

// The deal page: everything about the deal and its company in one place, in tabs.
export function DealView({ id, company }: { id: string; company: CompanySlots }) {
  const [tab, setTab] = useState<DealTab>("deal");
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1) as DealTab;
      setTab(["company", "financials", "documents", "intel"].includes(h) ? h : "deal");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [id]);
  function openTab(t: DealTab) {
    setTab(t);
    history.replaceState(null, "", t === "deal" ? window.location.pathname : `#${t}`);
  }
  const router = useRouter();
  const [data, setData] = useState<DealData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await fetchJson<DealData>(`/api/deals/${id}`)); setState("ok"); }
    catch { setState("error"); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // Tell the menu which section this deal is in, so it opens there.
  const dealPhase = data?.deal.phase;
  useEffect(() => {
    if (!dealPhase) return;
    (window as unknown as { __pandoSection?: { path: string; phase: string } }).__pandoSection = { path: window.location.pathname, phase: dealPhase };
    window.dispatchEvent(new CustomEvent("pando:active-section", { detail: { phase: dealPhase } }));
  }, [dealPhase]);
  async function call(path: string, method: string, body: unknown) {
    setErr(null);
    const res = await fetch(`/api/deals/${id}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error ?? "Couldn't save the change");
    await load();
    return res.ok;
  }
  const patchDeal = (body: Record<string, unknown>) => call("", "PATCH", body);

  if (state === "loading") return <div><Topbar title="Deal" /><div className="p-6"><Card><p className="text-[13px] text-slate">Loading…</p></Card></div></div>;
  if (state === "error" || !data) return (
    <div><Topbar title="Deal" /><div className="p-6"><Card>
      <p className="text-[13px] text-carbon mb-2">Couldn&apos;t load this deal</p>
      <Button variant="outline" size="sm" onClick={() => { setState("loading"); load(); }}>Try again</Button>
    </Card></div></div>
  );

  const { deal, stages, users, valuation, decks, activity } = data;
  const stage = stages.find(s => s.key === deal.stage);
  const today = new Date().toISOString().slice(0, 10);
  const openTasks = deal.tasks.filter(t => t.status !== "done").sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const doneTasks = deal.tasks.filter(t => t.status === "done");
  const milestones = [...deal.milestones].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  const decksCard = (
              <Card>
                <SectionHeader title="Presentations" subtitle="Generated for this company"
                  action={<Link href={`/documentos?company=${deal.company.id}&type=pptx`} className="text-[11px] font-medium text-forest hover:underline">+ New</Link>} />
                {decks.length === 0 ? <p className="text-[12px] text-slate">None yet.</p> : (
                  <div className="divide-y divide-chalk">
                    {decks.map(d => (
                      <div key={d.id} className="py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium text-carbon truncate">{d.filename}</p>
                          <p className="text-[10px] text-slate">{d.slideCount ? `${d.slideCount} slides · ` : ""}{d.by} · {ago(d.createdAt)}</p>
                        </div>
                        <a href={`/api/jobs/${d.id}/download`} className="text-[11px] font-medium text-forest hover:underline shrink-0">Download</a>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
  );
  const valuationCard = (
            <Card>
              <SectionHeader title="Valuation" subtitle="Football field: comps, LBO and our valuation"
                action={<Link href={`/valuation/${deal.company.id}`} className="text-[11px] font-medium text-forest hover:underline">Open valuation workspace</Link>} />
              {valuation.config ? <ValuationSummary config={valuation.config} comps={valuation.comps} lbos={valuation.lbos ?? []} /> : null}
              {!valuation.config && <p className="text-[12px] text-slate">No valuation yet. Set it up in the valuation workspace for {deal.company.name}.</p>}
            </Card>
  );
  const input = "px-2 py-1 text-[12px] bg-fog border border-chalk rounded-[6px] text-carbon focus:outline-none focus:border-carbon";

  return (
    <div>
      <Topbar title={deal.codeName} subtitle={`${deal.company.name} · ${DEAL_TYPE_LABEL[deal.type] ?? deal.type}`}
        actions={company?.actions ?? <Link href={phaseInfo(deal.phase).href}><Button variant="outline" size="sm">{phaseInfo(deal.phase).short} board</Button></Link>} />

      <div className="p-6 space-y-4">
        {err && <Card><p className="text-[12px] text-red-600">{err}</p></Card>}
        {isAlert(deal) && (
          <div className="border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800" role="alert">
            <b>⚠ High interest, pending.</b> {deal.statusNote ? <>Pending on: {deal.statusNote}</> : "Add what it is pending on and the next step."}
          </div>
        )}

        {/* ── Back to the deals of its section, and which section it is in ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={phaseInfo(deal.phase).href} className="inline-flex items-center gap-2 text-[12px] text-graphite hover:text-carbon group">
            <span aria-hidden className="transition-transform duration-300 group-hover:-translate-x-0.5">←</span>
            Back to {phaseInfo(deal.phase).short === "Sourcing" ? "the pipeline" : `${phaseInfo(deal.phase).short} deals`}
          </Link>
          <span className="flex items-center gap-2">
            <span className="eyebrow">Section</span>
            <span className="font-display text-[10.5px] uppercase tracking-[.16em] px-3.5 pt-[7px] pb-[5px] bg-olive text-white">{phaseInfo(deal.phase).label}</span>
          </span>
        </div>

        {/* ── Header ── */}
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <input defaultValue={deal.codeName} onBlur={e => e.target.value.trim() && e.target.value !== deal.codeName && patchDeal({ codeName: e.target.value })}
                  className="text-[20px] font-semibold text-carbon font-poly bg-transparent border-b border-transparent hover:border-chalk focus:border-carbon focus:outline-none" />
                <StagePill stage={stage} onHold={deal.onHold} />
              </div>
              <p className="text-[12px] text-graphite">
                <button onClick={() => openTab("company")} className="font-medium hover:underline">{deal.company.name}</button>
                {deal.company.sector && ` · ${deal.company.sector}`} · {deal.company.country}
                {deal.stageChangedAt && <span className="text-slate"> · in {stage?.label ?? deal.stage} since {fmtDay(deal.stageChangedAt)}</span>}
              </p>
              {deal.onHold && deal.statusNote && <p className="text-[11px] text-amber-700">On hold: {deal.statusNote}</p>}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[10px] text-slate">Stage
                <select value={deal.stage} onChange={e => patchDeal({ stage: e.target.value })} className={`${input} block`}>
                  {stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-slate">Type
                <select value={deal.type} onChange={e => patchDeal({ type: e.target.value })} className={`${input} block`}>
                  {Object.entries(DEAL_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-slate">Lead
                <select value={deal.leadUserId ?? ""} onChange={e => patchDeal({ leadUserId: e.target.value || null })} className={`${input} block`}>
                  <option value="">—</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-slate">Size (EV)
                <span className="flex gap-1">
                  <select value={deal.currency} onChange={e => patchDeal({ currency: e.target.value })} className={input}>
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <input defaultValue={deal.dealSize ?? ""} placeholder="—" onBlur={e => {
                    const v = e.target.value.replace(/[,\s]/g, "");
                    patchDeal({ dealSize: v ? Number(v) : null });
                  }} className={`${input} w-[120px] text-right`} title={fmtSize(deal.dealSize, deal.currency)} />
                </span>
              </label>
              <label className="text-[10px] text-slate">Interest
                <select value={deal.interest} onChange={e => patchDeal({ interest: e.target.value })} className={`${input} block`}>
                  {INTERESTS.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-slate">Status
                <select value={deal.dealStatus} onChange={e => {
                  const v = e.target.value;
                  if (v === "active") { patchDeal({ dealStatus: v, statusNote: null }); return; }
                  const why = prompt(v === "on_hold" ? "Why is this deal on hold?" : "What is it pending on?", deal.statusNote ?? "");
                  if (why === null) { e.target.value = deal.dealStatus; return; }
                  patchDeal({ dealStatus: v, statusNote: why });
                }} className={`${input} block`}>
                  {DEAL_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              <Button variant="ghost" size="sm" onClick={async () => {
                if (!confirm(`Delete ${deal.codeName}? Its team, tasks and milestones are deleted too. The company and its documents stay.`)) return;
                if (await call("", "DELETE", {})) router.push("/deals");
              }}>Delete</Button>
            </div>
          </div>
          <textarea defaultValue={deal.description ?? ""} placeholder="Description: thesis, process, counterparties…" rows={2}
            onBlur={e => e.target.value !== (deal.description ?? "") && patchDeal({ description: e.target.value })}
            className="mt-3 w-full text-[13px] text-graphite bg-fog border border-chalk rounded-[8px] px-3 py-2 resize-y focus:outline-none focus:border-carbon" />
        </Card>

        {/* ── Tabs: the deal, and everything about its company ── */}
        <div className="border-b border-chalk">
          <div role="tablist" aria-label="Deal sections" className="flex gap-1 overflow-x-auto no-scrollbar -mb-px">
            {([
              ["deal", "Deal", null],
              ["company", "Company", null],
              ["financials", "Financials & valuation", null],
              ["documents", "Documents", company?.counts.files || decks.length || null],
              ["intel", "News, signals & notes", (company?.counts.signals ?? 0) + (company?.counts.news ?? 0) || null],
            ] as [DealTab, string, number | null][]).map(([k, label, n]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => openTab(k)}
                className={`shrink-0 px-3 py-2.5 text-[12px] font-medium border-b-2 transition-colors duration-300 whitespace-nowrap ${tab === k ? "border-olive text-carbon" : "border-transparent text-slate hover:text-carbon"}`}>
                {label}{n ? <span className="ml-1.5 text-[10px] text-slate">{n}</span> : null}
              </button>
            ))}
          </div>
        </div>

        {tab !== "deal" && !company && <Card><p className="text-[13px] text-slate">Couldn&apos;t load the company.</p></Card>}
        {tab === "company" && company && (
          <div className="space-y-3">{company.overview}</div>
        )}
        {tab === "financials" && company && (
          <div className="space-y-4">
            {company.financials}
            {valuationCard}
          </div>
        )}
        {tab === "documents" && (
          <div className="space-y-4">
            {decksCard}
            {company?.documents}
          </div>
        )}
        {tab === "intel" && company?.intel}

        {tab === "deal" && <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 space-y-4">
            {/* ── Tasks ── */}
            <Card>
              <SectionHeader title="Tasks" subtitle={`${openTasks.length} open · ${doneTasks.length} done`} />
              <form className="flex flex-wrap gap-2 mb-3" onSubmit={async e => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (await call("/tasks", "POST", { title: f.get("title"), assigneeId: f.get("assigneeId") || null, dueDate: f.get("dueDate") || null })) (e.target as HTMLFormElement).reset();
              }}>
                <input name="title" required placeholder="New task (e.g. Send IRL to management)" className={`${input} flex-1 min-w-[220px]`} />
                <select name="assigneeId" className={input}>
                  <option value="">Unassigned</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <input name="dueDate" type="date" className={input} />
                <Button type="submit" variant="fill" size="sm">Add</Button>
              </form>
              <div className="divide-y divide-chalk">
                {openTasks.length === 0 && <p className="text-[12px] text-slate py-2">No open tasks.</p>}
                {[...openTasks, ...doneTasks].map(t => {
                  const late = t.status !== "done" && t.dueDate && t.dueDate < today;
                  return (
                    <div key={t.id} className="flex flex-wrap items-center gap-2 py-2">
                      <input type="checkbox" checked={t.status === "done"} onChange={() => call("/tasks", "PATCH", { taskId: t.id, status: t.status === "done" ? "todo" : "done" })} />
                      <span className={`flex-1 min-w-[60%] md:min-w-0 text-[13px] ${t.status === "done" ? "line-through text-slate" : "text-carbon"}`}>{t.title}</span>
                      {t.status !== "done" && (
                        <select value={t.status} onChange={e => call("/tasks", "PATCH", { taskId: t.id, status: e.target.value })} className={`${input} text-[11px]`}>
                          <option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option>
                        </select>
                      )}
                      <select value={t.assigneeId ?? ""} onChange={e => call("/tasks", "PATCH", { taskId: t.id, assigneeId: e.target.value || null })} className={`${input} text-[11px] max-w-[130px]`}>
                        <option value="">Unassigned</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                      <input type="date" defaultValue={t.dueDate ?? ""} onBlur={e => e.target.value !== (t.dueDate ?? "") && call("/tasks", "PATCH", { taskId: t.id, dueDate: e.target.value || null })}
                        className={`${input} text-[11px] ${late ? "border-red-300 text-red-600" : ""}`} />
                      <button onClick={() => call("/tasks", "DELETE", { taskId: t.id })} className="text-slate hover:text-red-600 px-1" title="Delete">×</button>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* ── Milestones ── */}
            <Card>
              <SectionHeader title="Milestones & key dates" subtitle="LOI, IC dates, signing, closing…" />
              <form className="flex flex-wrap gap-2 mb-3" onSubmit={async e => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (await call("/milestones", "POST", { label: f.get("label"), date: f.get("date") || null })) (e.target as HTMLFormElement).reset();
              }}>
                <input name="label" required placeholder="e.g. Final IC" className={`${input} flex-1 min-w-[200px]`} />
                <input name="date" type="date" className={input} />
                <Button type="submit" variant="fill" size="sm">Add</Button>
              </form>
              {milestones.length === 0 ? <p className="text-[12px] text-slate">No milestones yet.</p> : (
                <ol className="relative border-l border-chalk ml-2 space-y-3">
                  {milestones.map(m => (
                    <li key={m.id} className="ml-4 flex flex-wrap items-center gap-2">
                      <span className={`absolute -left-[5px] w-2.5 h-2.5 rounded-full ${m.done ? "bg-forest" : m.date && m.date < today ? "bg-red-400" : "bg-chalk"}`} />
                      <input type="checkbox" checked={m.done} onChange={() => call("/milestones", "PATCH", { milestoneId: m.id, done: !m.done })} />
                      <span className={`flex-1 min-w-[50%] md:min-w-0 text-[13px] ${m.done ? "text-slate line-through" : "text-carbon"}`}>{m.label}</span>
                      <input type="date" defaultValue={m.date ?? ""} onBlur={e => e.target.value !== (m.date ?? "") && call("/milestones", "PATCH", { milestoneId: m.id, date: e.target.value || null })} className={`${input} text-[11px]`} />
                      <button onClick={() => call("/milestones", "DELETE", { milestoneId: m.id })} className="text-slate hover:text-red-600 px-1" title="Delete">×</button>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            {/* ── Executive summary ── */}
            <ExecutiveSummary dealId={deal.id} />

          </div>

          <div className="space-y-4">
            {/* ── Team ── */}
            <Card>
              <SectionHeader title="Team" subtitle={`${deal.members.length} people · ${deal.members.reduce((n, m) => n + m.allocation, 0)}% total allocation`} />
              <div className="space-y-2.5">
                {deal.members.map(m => {
                  const lvl = levelInfo(m.availability?.level);
                  return (
                    <div key={m.id} className="flex items-center gap-2">
                      <Avatar name={m.user.name} size={28} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-carbon truncate">{m.user.name}</p>
                        <div className="flex items-center gap-1.5">
                          <select value={m.role} onChange={e => call("/members", "PATCH", { memberId: m.id, role: e.target.value })} className="text-[10px] text-slate bg-transparent focus:outline-none">
                            {Object.entries(DEAL_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                          {lvl && <span title={`Availability: ${lvl.label}`} className="inline-flex items-center gap-1 text-[10px]" style={{ color: lvl.text }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: lvl.dot }} />{lvl.label}
                          </span>}
                        </div>
                      </div>
                      <input type="number" min={0} max={100} step={5} defaultValue={m.allocation} title="% of their time on this deal"
                        onBlur={e => Number(e.target.value) !== m.allocation && call("/members", "PATCH", { memberId: m.id, allocation: Number(e.target.value) })}
                        className={`${input} w-[56px] text-right`} />
                      <span className="text-[10px] text-slate">%</span>
                      <button onClick={() => call("/members", "DELETE", { memberId: m.id })} className="text-slate hover:text-red-600 px-1" title="Remove">×</button>
                    </div>
                  );
                })}
              </div>
              <form className="flex gap-1.5 mt-3" onSubmit={async e => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (await call("/members", "POST", { userId: f.get("userId"), role: f.get("role"), allocation: Number(f.get("allocation") || 25) })) (e.target as HTMLFormElement).reset();
              }}>
                <select name="userId" required className={`${input} flex-1 min-w-0`}>
                  <option value="">Add person…</option>
                  {users.filter(u => !deal.members.some(m => m.userId === u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <select name="role" defaultValue="analyst" className={input}>{Object.entries(DEAL_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input name="allocation" type="number" min={0} max={100} defaultValue={25} className={`${input} w-[52px]`} title="% allocation" />
                <Button type="submit" variant="outline" size="sm">Add</Button>
              </form>
              <p className="text-[10px] text-slate mt-2">Availability comes from each person&apos;s status in <Link href="/equipo" className="underline">Team</Link>.</p>
            </Card>

            {/* ── Activity ── */}
            <Card>
              <SectionHeader title="Activity" />
              {activity.length === 0 ? <p className="text-[12px] text-slate">Nothing yet.</p> : (
                <div className="space-y-2">
                  {activity.map(a => (
                    <p key={a.id} className="text-[11px] text-graphite leading-snug">
                      <strong className="text-carbon">{a.userName}</strong> {ACTION_LABEL[a.action] ?? a.action.replace(/_/g, " ")}
                      {a.detail ? <> <span className="text-carbon">{a.detail}</span></> : null}
                      <span className="text-slate"> · {ago(a.createdAt)}</span>
                    </p>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>}
      </div>
    </div>
  );
}
