"use client";
// Cap table of a company: who owns what. Edited by the team, or drafted by
// Claude from the company's documents and reviewed before saving.
import { useState } from "react";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Donut } from "@/components/charts/Donut";
import { CAP_COLORS, HOLDER_KINDS, type CapHolder, type CapTable } from "@/lib/capTable";

const input = "w-full px-2 py-1 text-[12px] bg-fog border border-chalk text-carbon focus:outline-none focus:border-carbon";
const blank = (): CapHolder => ({ name: "", kind: "Founders", pct: null, note: "" });

export function CapTableCard({ companyId, initial }: { companyId: string; initial: CapTable }) {
  const [cap, setCap] = useState<CapTable>(initial);
  const [draft, setDraft] = useState<CapTable | null>(null);
  const [busy, setBusy] = useState<"save" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromDocs, setFromDocs] = useState<string[] | null>(null);

  const total = (c: CapTable) => c.holders.reduce((n, h) => n + (h.pct ?? 0), 0);

  async function save() {
    if (!draft) return;
    setBusy("save"); setError(null);
    const res = await fetch(`/api/companies/${companyId}/cap-table`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capTable: { ...draft, holders: draft.holders.filter(h => h.name.trim() || h.pct != null) } }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(j.error ?? "Couldn't save"); return; }
    setCap(j.capTable); setDraft(null); setFromDocs(null);
  }

  async function fill() {
    if ((cap.holders.length || draft?.holders.length) && !confirm("Replace the cap table with what the documents say? You'll review it before saving.")) return;
    setBusy("ai"); setError(null);
    const res = await fetch(`/api/companies/${companyId}/cap-table`, { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(j.error ?? "Couldn't read the documents"); return; }
    setDraft(j.capTable); setFromDocs(j.files ?? []);
  }

  const setRow = (i: number, patch: Partial<CapHolder>) =>
    draft && setDraft({ ...draft, holders: draft.holders.map((h, j) => (j === i ? { ...h, ...patch } : h)) });

  const shown = cap.holders.filter(h => h.pct != null && h.pct > 0);
  const rest = 100 - total(cap);
  const segments = [
    ...shown.map((h, i) => ({ label: h.name, value: h.pct!, color: CAP_COLORS[i % CAP_COLORS.length] })),
    ...(shown.length && rest > 0.5 ? [{ label: "Not identified", value: rest, color: "#EFEFEA" }] : []),
  ];

  return (
    <Card>
      <SectionHeader title="Cap table"
        subtitle={draft ? (fromDocs ? `Drafted from ${fromDocs.length} document(s). Review and save.` : "Editing") : [cap.asOf, cap.source && `Source: ${cap.source}`].filter(Boolean).join(" · ") || undefined}
        className="mb-3"
        action={!draft && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" loading={busy === "ai"} disabled={!!busy} onClick={fill}>Fill from documents</Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setDraft(structuredClone(cap.holders.length ? cap : { ...cap, holders: [blank()] }))}>Edit</Button>
          </div>
        )} />
      {error && <p className="text-[12px] text-red-600 mb-2">{error}</p>}
      {busy === "ai" && <p className="text-[12px] text-graphite mb-2">Reading the company&apos;s documents… (up to a minute)</p>}

      {draft ? (
        <div className="space-y-2">
          {draft.holders.map((h, i) => (
            <div key={i} className="grid grid-cols-[1fr_72px_24px] gap-1.5 items-start border-b border-chalk pb-2">
              <div className="space-y-1.5 min-w-0">
                <input value={h.name} onChange={e => setRow(i, { name: e.target.value })} placeholder="Holder (e.g. Founding family)" className={input} />
                <div className="grid grid-cols-2 gap-1.5">
                  <select value={HOLDER_KINDS.includes(h.kind) ? h.kind : "Other"} onChange={e => setRow(i, { kind: e.target.value })} className={input}>
                    {HOLDER_KINDS.map(k => <option key={k}>{k}</option>)}
                  </select>
                  <input value={h.note} onChange={e => setRow(i, { note: e.target.value })} placeholder="Note (class, vehicle…)" className={input} />
                </div>
              </div>
              <div className="relative">
                <input type="number" min={0} max={100} step="0.1" value={h.pct ?? ""} placeholder="%"
                  onChange={e => setRow(i, { pct: e.target.value === "" ? null : Number(e.target.value) })} className={`${input} text-right pr-5`} />
                <span className="absolute right-1.5 top-1 text-[11px] text-slate">%</span>
              </div>
              <button onClick={() => setDraft({ ...draft, holders: draft.holders.filter((_, j) => j !== i) })} className="text-slate hover:text-red-600 text-[14px] pt-0.5" title="Remove">×</button>
            </div>
          ))}
          <button onClick={() => setDraft({ ...draft, holders: [...draft.holders, blank()] })} className="text-[12px] font-medium text-forest hover:underline">+ Add holder</button>
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <input value={draft.asOf} onChange={e => setDraft({ ...draft, asOf: e.target.value })} placeholder="As of (e.g. Dec 2025)" className={input} />
            <input value={draft.source} onChange={e => setDraft({ ...draft, source: e.target.value })} placeholder="Source (e.g. CIM p. 14)" className={input} />
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className={`text-[11px] ${total(draft) > 100.5 ? "text-red-600 font-medium" : "text-slate"}`}>Total {total(draft).toFixed(1)}%</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setDraft(null); setFromDocs(null); setError(null); }}>Cancel</Button>
              <Button size="sm" variant="fill" loading={busy === "save"} disabled={!!busy} onClick={save}>Save</Button>
            </div>
          </div>
        </div>
      ) : cap.holders.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-[13px] text-carbon">No cap table yet</p>
          <p className="text-[12px] text-slate mt-1">Add the holders by hand, or let Claude read them from the company&apos;s documents.</p>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          {segments.length > 0 && <Donut segments={segments} size={90} thickness={16} centerLabel={`${Math.round(total(cap))}%`} centerSub="identified" />}
          <div className="space-y-1.5 text-[11px] flex-1 min-w-0">
            {cap.holders.map((h, i) => (
              <div key={i} className="flex items-start gap-2" title={h.note || undefined}>
                <span className="w-2 h-2 rounded-full flex-none mt-1" style={{ background: h.pct ? CAP_COLORS[shown.indexOf(h) % CAP_COLORS.length] : "#EFEFEA" }} />
                <span className="flex-1 min-w-0">
                  <span className="text-carbon">{h.name}</span>
                  <span className="block text-[10px] text-slate truncate">{[h.kind, h.note].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="font-semibold text-carbon">{h.pct != null ? `${h.pct}%` : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
