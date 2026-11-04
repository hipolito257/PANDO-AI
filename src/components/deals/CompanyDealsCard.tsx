"use client";
// Deals on a company, shown on its page.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, SectionHeader } from "@/components/ui/Card";
import { NewDealModal } from "./NewDealModal";
import { Avatar, DEAL_TYPE_LABEL, StagePill, fmtDay, type Stage } from "./dealUi";

type Row = {
  id: string; codeName: string; type: string; stage: string; onHold: boolean;
  members: { userId: string; user: { name: string } }[];
  openTasks: number; nextMilestone: { label: string; date: string } | null;
};

export function CompanyDealsCard({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    fetch(`/api/deals?companyId=${companyId}`).then(r => (r.ok ? r.json() : null)).then(d => {
      if (d) { setRows(d.deals); setStages(d.stages); } else setRows([]);
    }).catch(() => setRows([]));
  }, [companyId]);

  return (
    <Card>
      <SectionHeader title="Deals" subtitle="Projects on this company: team, stage, tasks and milestones"
        action={<button onClick={() => setShowNew(true)} className="text-[11px] font-medium text-forest hover:underline">+ New deal</button>} />
      {rows === null ? <p className="text-[12px] text-slate">Loading…</p>
        : rows.length === 0 ? <p className="text-[12px] text-slate">No deals on {companyName} yet.</p>
        : (
          <div className="divide-y divide-chalk">
            {rows.map(d => (
              <Link key={d.id} href={`/deals/${d.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-fog/50 -mx-2 px-2 rounded-[6px]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-carbon">{d.codeName}</span>
                    <StagePill stage={stages.find(s => s.key === d.stage)} onHold={d.onHold} />
                  </div>
                  <p className="text-[10px] text-slate">
                    {DEAL_TYPE_LABEL[d.type] ?? d.type}{d.openTasks ? ` · ${d.openTasks} open task(s)` : ""}{d.nextMilestone ? ` · ${d.nextMilestone.label} ${fmtDay(d.nextMilestone.date)}` : ""}
                  </p>
                </div>
                <div className="flex -space-x-1.5 shrink-0">{d.members.slice(0, 4).map(m => <Avatar key={m.userId} name={m.user.name} size={22} />)}</div>
              </Link>
            ))}
          </div>
        )}
      {showNew && <NewDealModal onClose={() => setShowNew(false)} companyId={companyId} companyName={companyName} />}
    </Card>
  );
}
