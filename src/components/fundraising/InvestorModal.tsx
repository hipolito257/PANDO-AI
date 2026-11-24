"use client";
// Add / edit an investor (LP), and the shared data hook for the Fundraising pages.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { INVESTOR_STAGES, INVESTOR_TYPES, type Investor } from "@/lib/fundraising";

export type FundInfo = { target: number | null; currency: string; name: string | null };
export type TeamMember = { id: string; name: string };

export function useInvestors() {
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [fund, setFund] = useState<FundInfo>({ target: null, currency: "USD", name: null });
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/investors");
      if (!r.ok) throw new Error();
      const j = await r.json();
      setInvestors(j.investors); setTeam(j.team); setFund(j.fund); setState("ok");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  /** Optimistic update (used when dragging a card to another stage). */
  const patch = useCallback(async (id: string, fields: Partial<Investor>) => {
    setInvestors(list => list.map(i => (i.id === id ? { ...i, ...fields } : i)));
    const r = await fetch("/api/investors", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...fields }) }).catch(() => null);
    if (!r?.ok) load();
  }, [load]);

  return { investors, team, fund, state, load, patch, setFund };
}

const input = "w-full text-[13px] bg-paper border border-chalk px-3 py-2 text-carbon focus:outline-none focus:border-olive";
const lbl = "block eyebrow !text-[9.5px] !tracking-[.2em] mb-1.5";

export function InvestorModal({ investor, team, defaultStage, defaultType, onClose, onSaved }: {
  investor?: Investor | null; team: TeamMember[]; defaultStage?: string; defaultType?: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState(() => ({
    name: investor?.name ?? "", type: investor?.type ?? defaultType ?? "family_office", stage: investor?.stage ?? defaultStage ?? "identified",
    country: investor?.country ?? "México", city: investor?.city ?? "", website: investor?.website ?? "",
    contactName: investor?.contactName ?? "", contactRole: investor?.contactRole ?? "",
    targetAmount: investor?.targetAmount != null ? String(investor.targetAmount) : "",
    committedAmount: investor?.committedAmount != null ? String(investor.committedAmount) : "",
    currency: investor?.currency ?? "USD", ownerId: investor?.ownerId ?? "",
    nextStep: investor?.nextStep ?? "", nextStepDate: investor?.nextStepDate ?? "", notes: investor?.notes ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) { setError("Give the investor a name"); return; }
    setBusy(true); setError(null);
    const body = { ...f, id: investor?.id, ownerId: f.ownerId || null };
    const r = await fetch("/api/investors", { method: investor ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setError("Couldn't save. Try again."); return; }
    onSaved();
  }

  async function remove() {
    if (!investor || !confirm(`Delete ${investor.name}?`)) return;
    await fetch(`/api/investors?id=${investor.id}`, { method: "DELETE" });
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end md:items-center justify-center md:p-4" onClick={onClose}>
      <form onSubmit={save} onClick={e => e.stopPropagation()}
        className="bg-paper w-full md:max-w-[640px] max-h-[92dvh] overflow-y-auto p-6 space-y-4 shadow-float pb-[calc(24px+env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Fundraising</p>
            <h2 className="mt-1 font-display text-[22px] font-light text-carbon">{investor ? investor.name : "New investor"}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-slate hover:text-carbon text-[20px] leading-none px-1" aria-label="Close">×</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="sm:col-span-2"><span className={lbl}>Name *</span><input autoFocus value={f.name} onChange={e => set("name", e.target.value)} className={input} placeholder="e.g. Family office, AFORE…" /></label>
          <label><span className={lbl}>Type</span>
            <select value={f.type} onChange={e => set("type", e.target.value)} className={input}>{INVESTOR_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
          <label><span className={lbl}>Stage</span>
            <select value={f.stage} onChange={e => set("stage", e.target.value)} className={input}>{INVESTOR_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
          <label><span className={lbl}>Country</span><input value={f.country} onChange={e => set("country", e.target.value)} className={input} /></label>
          <label><span className={lbl}>City</span><input value={f.city} onChange={e => set("city", e.target.value)} className={input} /></label>
          <label><span className={lbl}>Main contact</span><input value={f.contactName} onChange={e => set("contactName", e.target.value)} className={input} /></label>
          <label><span className={lbl}>Contact role</span><input value={f.contactRole} onChange={e => set("contactRole", e.target.value)} className={input} placeholder="e.g. CIO" /></label>
          <label><span className={lbl}>Target ticket</span><input inputMode="decimal" value={f.targetAmount} onChange={e => set("targetAmount", e.target.value)} className={input} placeholder="e.g. 10000000" /></label>
          <label><span className={lbl}>Committed</span><input inputMode="decimal" value={f.committedAmount} onChange={e => set("committedAmount", e.target.value)} className={input} placeholder="once they commit" /></label>
          <label><span className={lbl}>Currency</span>
            <select value={f.currency} onChange={e => set("currency", e.target.value)} className={input}>{["USD", "MXN", "EUR"].map(c => <option key={c}>{c}</option>)}</select></label>
          <label><span className={lbl}>Owner at Pando</span>
            <select value={f.ownerId} onChange={e => set("ownerId", e.target.value)} className={input}><option value="">—</option>{team.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="sm:col-span-2"><span className={lbl}>Website</span><input value={f.website} onChange={e => set("website", e.target.value)} className={input} placeholder="https://" /></label>
          <label><span className={lbl}>Next step</span><input value={f.nextStep} onChange={e => set("nextStep", e.target.value)} className={input} placeholder="e.g. Send PPM" /></label>
          <label><span className={lbl}>Next step date</span><input type="date" value={f.nextStepDate} onChange={e => set("nextStepDate", e.target.value)} className={input} /></label>
          <label className="sm:col-span-2"><span className={lbl}>Notes</span><textarea value={f.notes} onChange={e => set("notes", e.target.value)} rows={3} className={input} /></label>
        </div>
        {error && <p className="text-[12px] text-red-600">{error}</p>}
        <div className="flex items-center justify-between gap-2 pt-2">
          {investor ? <button type="button" onClick={remove} className="text-[12px] text-slate hover:text-red-600">Delete</button> : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="fill" size="sm" loading={busy}>{investor ? "Save" : "Add investor"}</Button>
          </div>
        </div>
      </form>
    </div>
  );
}
