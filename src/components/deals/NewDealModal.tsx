"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { CURRENCIES, DEAL_TYPE_LABEL, type Stage } from "./dealUi";

type Option = { id: string; name: string };

export function NewDealModal({ onClose, companyId, companyName }: {
  onClose: () => void; companyId?: string; companyName?: string;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [companies, setCompanies] = useState<Option[]>(companyId ? [{ id: companyId, name: companyName ?? "" }] : []);
  const [people, setPeople] = useState<Option[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [form, setForm] = useState({
    companyId: companyId ?? "", codeName: "", type: "buy_side", stage: "", leadUserId: "",
    dealSize: "", currency: "USD", description: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      fetch("/api/companies?limit=500").then(r => (r.ok ? r.json() : [])).then((d: Option[]) =>
        setCompanies(Array.isArray(d) ? [...d].sort((a, b) => a.name.localeCompare(b.name)) : [])).catch(() => {});
    }
    fetch("/api/users").then(r => (r.ok ? r.json() : { users: [] })).then((d: { users: Option[] }) => setPeople(d.users ?? [])).catch(() => {});
    fetch("/api/deal-stages").then(r => (r.ok ? r.json() : [])).then((d: Stage[]) => {
      setStages(d);
      setForm(f => ({ ...f, stage: f.stage || d[0]?.key || "" }));
    }).catch(() => {});
  }, [companyId]);

  useEffect(() => {
    if (session?.user?.id) setForm(f => ({ ...f, leadUserId: f.leadUserId || session.user!.id! }));
  }, [session?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const size = Number(form.dealSize.replace(/[,\s]/g, ""));
      const res = await fetch("/api/deals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, dealSize: form.dealSize.trim() && Number.isFinite(size) ? size : null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not create the deal");
      router.push(`/deals/${data.id}`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not create the deal");
      setSaving(false);
    }
  }

  const input = "w-full px-3 py-2 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon focus:outline-none focus:border-carbon";
  const label = "block text-[11px] text-slate mb-1 font-medium";

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center overflow-y-auto p-6" onClick={onClose}>
      <form onSubmit={create} onClick={e => e.stopPropagation()} className="bg-paper rounded-[12px] shadow-xl w-full max-w-[560px] p-6 space-y-4">
        <div>
          <h3 className="text-[16px] font-semibold text-carbon">New deal</h3>
          <p className="text-[11px] text-slate">A project on one company: its team, stage, tasks and milestones. Documents, valuation and decks come from the company.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={label}>Company *</label>
            <select required value={form.companyId} disabled={!!companyId} onChange={e => setForm({ ...form, companyId: e.target.value })} className={input}>
              <option value="">Choose a company…</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Code name *</label>
            <input required value={form.codeName} onChange={e => setForm({ ...form, codeName: e.target.value })} placeholder="e.g. Project Element" className={input} />
          </div>
          <div>
            <label className={label}>Type</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className={input}>
              {Object.entries(DEAL_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Stage</label>
            <select value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })} className={input}>
              {stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Deal lead</label>
            <select value={form.leadUserId} onChange={e => setForm({ ...form, leadUserId: e.target.value })} className={input}>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Estimated size (EV)</label>
            <input value={form.dealSize} onChange={e => setForm({ ...form, dealSize: e.target.value })} placeholder="e.g. 150000000" className={input} />
          </div>
          <div>
            <label className={label}>Currency</label>
            <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} className={input}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className={label}>Description</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3}
              placeholder="Thesis, process, counterparties…" className={`${input} resize-y`} />
          </div>
        </div>
        {err && <p className="text-[12px] text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="fill" size="sm" loading={saving}>Create deal</Button>
        </div>
      </form>
    </div>
  );
}
