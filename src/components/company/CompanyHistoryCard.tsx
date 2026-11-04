"use client";
// Full change history of a company's data points, with where each value came from.
import { useEffect, useMemo, useState } from "react";
import { Card, SectionHeader } from "@/components/ui/Card";
import { fetchJson } from "@/lib/fetchJson";
import { SOURCE_COLOR, SOURCE_LABEL, fieldLabel, fmtValue, fmtWhen, type FieldChangeRow } from "./provenanceUi";

const PAGE = 12;

export function CompanyHistoryCard({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<FieldChangeRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [source, setSource] = useState("all");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    fetchJson<{ changes: FieldChangeRow[] }>(`/api/companies/${companyId}/history`)
      .then(d => setRows(d.changes))
      .catch(() => setFailed(true));
  }, [companyId]);

  const visible = useMemo(() => (rows ?? []).filter(r =>
    (source === "all" || r.sourceType === source)
    && (!q || `${fieldLabel(r.field)} ${r.sourceLabel ?? ""} ${r.newValue ?? ""}`.toLowerCase().includes(q.toLowerCase())),
  ), [rows, source, q]);
  const sources = useMemo(() => [...new Set((rows ?? []).map(r => r.sourceType))], [rows]);

  const ctl = "text-[11px] bg-fog border border-chalk rounded-[6px] px-2 py-1 text-graphite focus:outline-none focus:border-carbon";
  return (
    <Card>
      <SectionHeader title="Data history" subtitle="Every change to this company's data: old and new value, where it came from, who and when" className="mb-3"
        action={rows && rows.length > 0 ? (
          <div className="flex gap-1.5">
            <input value={q} onChange={e => { setQ(e.target.value); setShown(PAGE); }} placeholder="Filter…" className={`${ctl} w-[120px]`} />
            <select value={source} onChange={e => { setSource(e.target.value); setShown(PAGE); }} className={ctl}>
              <option value="all">All sources</option>
              {sources.map(s => <option key={s} value={s}>{SOURCE_LABEL[s] ?? s}</option>)}
            </select>
          </div>
        ) : undefined} />
      {failed ? <p className="text-[12px] text-slate">Couldn&apos;t load the history.</p>
        : rows === null ? <p className="text-[12px] text-slate">Loading…</p>
        : rows.length === 0 ? <p className="text-[12px] text-slate">No changes recorded yet. From now on, manual edits, applied documents, AI research and radar updates are tracked here.</p>
        : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-chalk text-slate text-[10px] uppercase tracking-wide">
                    {["Field", "Change", "Source", "By", "When"].map(h => <th key={h} className="text-left font-semibold py-1.5 pr-3">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, shown).map(r => (
                    <tr key={r.id} className="border-b border-chalk last:border-0 align-top">
                      <td className="py-2 pr-3 font-medium text-carbon whitespace-nowrap">{fieldLabel(r.field)}</td>
                      <td className="py-2 pr-3 text-graphite max-w-[320px]">
                        {r.oldValue !== null && <span className="text-slate line-through mr-1.5">{fmtValue(r.field, r.oldValue)}</span>}
                        <span className="text-carbon">{fmtValue(r.field, r.newValue)}</span>
                      </td>
                      <td className="py-2 pr-3 max-w-[260px]">
                        <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-[4px] mr-1.5 ${SOURCE_COLOR[r.sourceType] ?? "bg-fog text-graphite"}`}>{SOURCE_LABEL[r.sourceType] ?? r.sourceType}</span>
                        {r.sourceLabel && r.sourceLabel !== (SOURCE_LABEL[r.sourceType] ?? r.sourceType) && <span className="text-[11px] text-graphite">{r.sourceLabel}</span>}
                        {r.note && <p className="text-[10px] text-slate italic mt-0.5 line-clamp-2">&ldquo;{r.note}&rdquo;</p>}
                      </td>
                      <td className="py-2 pr-3 text-graphite whitespace-nowrap">{r.userName ?? "System"}</td>
                      <td className="py-2 text-slate whitespace-nowrap">{fmtWhen(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] text-slate">
              <span>{visible.length} change{visible.length === 1 ? "" : "s"}</span>
              {visible.length > shown && <button onClick={() => setShown(s => s + 50)} className="font-medium text-forest hover:underline">Show more</button>}
            </div>
          </>
        )}
    </Card>
  );
}
