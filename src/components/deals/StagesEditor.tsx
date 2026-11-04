"use client";
// Admin editor for the deal pipeline stages (order, names, outcome).
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { Stage } from "./dealUi";

const KINDS = [
  { value: "open", label: "In progress" },
  { value: "won", label: "Closed / won" },
  { value: "lost", label: "Dropped / lost" },
];

export function StagesEditor({ stages, onClose, onSaved }: { stages: Stage[]; onClose: () => void; onSaved: (s: Stage[]) => void }) {
  const [rows, setRows] = useState(stages.map(s => ({ key: s.key, label: s.label, kind: s.kind })));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  };

  async function save() {
    setSaving(true); setErr(null);
    const res = await fetch("/api/deal-stages", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows) });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setErr(data.error ?? "Couldn't save the stages"); return; }
    onSaved(data as Stage[]);
  }

  const input = "px-2 py-1.5 text-[12px] bg-fog border border-chalk rounded-[6px] text-carbon focus:outline-none focus:border-carbon";
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center overflow-y-auto p-6" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-paper rounded-[12px] shadow-xl w-full max-w-[520px] p-6 space-y-3">
        <div>
          <h3 className="text-[16px] font-semibold text-carbon">Pipeline stages</h3>
          <p className="text-[11px] text-slate">Order, names and outcome. Renaming keeps deals in their stage; a stage with deals in it can&apos;t be removed.</p>
        </div>
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={`${r.key}-${i}`} className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate w-5 text-right">{i + 1}</span>
              <input value={r.label} onChange={e => setRows(rows.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} className={`${input} flex-1`} />
              <select value={r.kind} onChange={e => setRows(rows.map((x, k) => (k === i ? { ...x, kind: e.target.value } : x)))} className={input}>
                {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <button onClick={() => move(i, -1)} className="text-slate hover:text-carbon px-1" title="Move up">↑</button>
              <button onClick={() => move(i, 1)} className="text-slate hover:text-carbon px-1" title="Move down">↓</button>
              <button onClick={() => setRows(rows.filter((_, k) => k !== i))} className="text-slate hover:text-red-600 px-1" title="Remove">×</button>
            </div>
          ))}
          <button onClick={() => setRows([...rows, { key: "", label: "New stage", kind: "open" }])} className="text-[11px] text-slate hover:text-carbon">+ Add stage</button>
        </div>
        {err && <p className="text-[12px] text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="fill" size="sm" loading={saving} onClick={save}>Save stages</Button>
        </div>
      </div>
    </div>
  );
}
