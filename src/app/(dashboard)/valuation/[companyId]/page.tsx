"use client";
// Valuation workspace for one company: trading comps, football field and LBO
// cases in one place. The football field can include an LBO bar (the price
// that earns each target IRR), and every LBO shows its returns at our valuation.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fetchJson } from "@/lib/fetchJson";
import { ValuationPanel } from "@/components/comparables/ValuationPanel";
import { computeValuation, defaultValuation, quantile, parseValuation, UNIT_SCALE, type LboModelRef, type ValComp, type ValuationConfig } from "@/lib/valuation";
import { lboAtPrice, lboSensitivity, normalizeLbo, runLbo, type LboInputs } from "@/lib/lboCalc";

type Company = { id: string; name: string; revenueUsd: number | null; ebitdaUsd: number | null; revenueGrowth: number | null; ebitdaMargin: number | null; sector: string | null; country: string };
type Data = {
  company: Company; compSetId: string | null; valuation: string | null; comps: ValComp[];
  lbos: (LboModelRef & { updatedAt: string | null })[]; deals: { id: string; codeName: string; stage: string }[];
};

const fmtX = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(1)}x`);
const fmtP = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`);
const fmtN = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));

export default function ValuationWorkspace() {
  const { companyId } = useParams<{ companyId: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [cfg, setCfg] = useState<ValuationConfig | null>(null);
  const [lbos, setLbos] = useState<(LboModelRef & { dirty?: boolean })[]>([]);

  const load = useCallback(async () => {
    try {
      const d = await fetchJson<Data>(`/api/valuation/${companyId}`);
      setData(d);
      setLbos(d.lbos.map(l => ({ ...l, assumptions: normalizeLbo(l.assumptions) })));
      setCfg(parseValuation(d.valuation) ?? defaultValuation(d.company));
    } catch {
      setFailed(true);
    }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const onCfg = useCallback((c: ValuationConfig) => setCfg(c), []);
  const v = useMemo(() => (cfg && data ? computeValuation(cfg, data.comps, lbos) : null), [cfg, data, lbos]);
  const scale = cfg ? UNIT_SCALE[cfg.unit] ?? 1 : 1e6;
  const oursEvRaw = v?.oursEv != null ? v.oursEv * scale : null; // in currency units, like the LBO

  if (failed) return <div><Topbar title="Valuation" /><div className="p-6"><Card><p className="text-[13px] text-carbon mb-2">Couldn&apos;t load the valuation.</p><Button variant="outline" size="sm" onClick={() => { setFailed(false); load(); }}>Try again</Button></Card></div></div>;
  if (!data || !cfg || !v) return <div><Topbar title="Valuation" /><div className="p-6"><Card><p className="text-[13px] text-slate">Loading…</p></Card></div></div>;

  const { company } = data;
  const lows = v.chartRows.map(r => r.low!), highs = v.chartRows.map(r => r.high!);
  const ebitdaMetric = cfg.metrics.find(m => /ebitda/i.test(m.label))?.value ?? null;
  const revenueMetric = cfg.metrics.find(m => /revenue|ventas|ingres/i.test(m.label))?.value ?? null;
  const firstLbo = lbos[0];
  const atOurs = firstLbo && oursEvRaw != null ? lboAtPrice(firstLbo.assumptions, oursEvRaw) : null;
  const withData = data.comps.filter(c => c.lastRefreshed);
  const evE = withData.map(c => c.evEbitda).filter((x): x is number => x != null && x > 0 && x <= 60);
  const evR = withData.map(c => c.evRevenue).filter((x): x is number => x != null && x > 0 && x <= 30);

  async function newCase() {
    const e0 = company.ebitdaUsd ?? (ebitdaMetric != null ? ebitdaMetric * scale : null);
    const r0 = company.revenueUsd ?? (revenueMetric != null ? revenueMetric * scale : null);
    if (!e0 || !r0 || e0 <= 0) { alert("Set the company's revenue and EBITDA first (company profile or the metrics below)."); return; }
    const entry = oursEvRaw && e0 ? +(oursEvRaw / e0).toFixed(1) : +(quantile(evE, 0.5) ?? 8).toFixed(1);
    const growth = company.revenueGrowth != null ? Math.min(0.4, Math.max(0, company.revenueGrowth / 100)) : 0.08;
    const res = await fetch(`/api/valuation/${companyId}/lbo`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Base case · ${entry}x`, assumptions: { entryEbitda: e0, revenueYear0: r0, entryMultiple: entry, exitMultiple: entry, revenueGrowthPct: [growth], ebitdaMarginPct: [e0 / r0], holdingPeriodYears: 5, currency: cfg!.currency === "MXN" || cfg!.currency === "EUR" ? cfg!.currency : "USD" } }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { alert(j.error ?? "Couldn't create the case"); return; }
    setLbos(ls => [{ id: j.id, name: j.name, assumptions: normalizeLbo(j.assumptions) }, ...ls]);
  }

  return (
    <div>
      <Topbar title={`Valuation · ${company.name}`} subtitle="Comps, football field and LBO in one place. Decks, documents and the chat use what you set here."
        actions={<div className="flex gap-2">
          <Link href={`/comparables?company=${company.id}`} className="text-[12px] font-medium border border-chalk bg-paper rounded-[8px] px-3 py-1.5 hover:border-carbon">Comparables</Link>
          <Link href={`/empresa/${company.id}`} className="text-[12px] font-medium border border-chalk bg-paper rounded-[8px] px-3 py-1.5 hover:border-carbon">Company</Link>
        </div>} />
      <div className="p-6 space-y-4">
        {/* ── Headline numbers ── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Kpi label={cfg.ours.enabled ? cfg.ours.label : "Our valuation"} value={v.ours != null ? `${fmtN(v.ours)}` : "Not set"} sub={v.ours != null ? `${v.valueLabel}, ${v.unitLabel}` : "Set it under “Our valuation” below"} strong />
          <Kpi label="Implied multiples" value={v.oursEv != null && ebitdaMetric ? `${fmtX(v.oursEv / ebitdaMetric)} EBITDA` : "—"} sub={v.oursEv != null && revenueMetric ? `${fmtX(v.oursEv / revenueMetric)} revenue` : ""} />
          <Kpi label="Football-field range" value={lows.length ? `${fmtN(Math.min(...lows))} – ${fmtN(Math.max(...highs))}` : "—"} sub={`${v.chartRows.length} method(s), ${v.unitLabel}`} />
          <Kpi label="Trading comps" value={evE.length ? `${fmtX(quantile(evE, 0.5))} EV/EBITDA` : "No data"} sub={`${withData.length} comps · ${evR.length ? `${fmtX(quantile(evR, 0.5))} EV/Revenue` : ""}`} />
          <Kpi label="LBO at our valuation" value={atOurs?.irr != null ? `${fmtP(atOurs.irr)} IRR` : "—"} sub={atOurs ? `${fmtX(atOurs.moic)} MOIC · ${firstLbo.name}` : lbos.length ? "Set our valuation" : "No LBO case yet"} />
        </div>

        {/* ── Football field (editable) ── */}
        <ValuationPanel key={data.compSetId ?? company.id} comps={data.comps} company={company} compSetId={data.compSetId}
          saved={data.valuation} lboModels={lbos} onChange={onCfg} />

        {/* ── LBO cases ── */}
        <Card>
          <SectionHeader title="LBO cases" subtitle="Returns update as you edit. Add one to the football field with “+ LBO” in Valuation methods; it shows the price that earns each target IRR."
            action={<Button variant="outline" size="sm" onClick={newCase}>+ New LBO case</Button>} />
          {lbos.length === 0 ? (
            <p className="text-[12px] text-slate mt-2">No LBO cases yet. Create one from the company&apos;s numbers here, or build a full model in <Link href="/financial-models" className="text-forest hover:underline">Models</Link> (it&apos;s saved here automatically).</p>
          ) : (
            <div className="space-y-3 mt-3">
              {lbos.map(l => (
                <LboCase key={l.id} companyId={companyId} model={l} oursEv={oursEvRaw} unitScale={scale} unitLabel={v.unitLabel}
                  onChange={a => setLbos(ls => ls.map(x => (x.id === l.id ? { ...x, assumptions: a, dirty: true } : x)))}
                  onRename={name => setLbos(ls => ls.map(x => (x.id === l.id ? { ...x, name, dirty: true } : x)))}
                  onSaved={() => setLbos(ls => ls.map(x => (x.id === l.id ? { ...x, dirty: false } : x)))}
                  onDeleted={() => setLbos(ls => ls.filter(x => x.id !== l.id))} />
              ))}
            </div>
          )}
        </Card>

        {data.deals.length > 0 && (
          <p className="text-[11px] text-slate">Deals on {company.name}: {data.deals.map((d, i) => <span key={d.id}>{i ? ", " : ""}<Link href={`/deals/${d.id}`} className="text-forest hover:underline">{d.codeName}</Link></span>)}</p>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={`rounded-[10px] p-3.5 ${strong ? "bg-carbon text-white" : "bg-paper border border-chalk"}`}>
      <p className={`text-[10px] uppercase tracking-wide ${strong ? "text-white/60" : "text-slate"}`}>{label}</p>
      <p className={`text-[17px] font-semibold font-poly mt-0.5 ${strong ? "text-white" : "text-carbon"}`}>{value}</p>
      {sub && <p className={`text-[10px] mt-0.5 ${strong ? "text-white/60" : "text-slate"}`}>{sub}</p>}
    </div>
  );
}

// ── One LBO case: key inputs, returns, IRR at our valuation, sensitivity ─────
function LboCase({ companyId, model, oursEv, unitScale, unitLabel, onChange, onRename, onSaved, onDeleted }: {
  companyId: string; model: LboModelRef & { dirty?: boolean }; oursEv: number | null; unitScale: number; unitLabel: string;
  onChange: (a: LboInputs) => void; onRename: (n: string) => void; onSaved: () => void; onDeleted: () => void;
}) {
  const a = normalizeLbo(model.assumptions);
  const r = runLbo(a);
  const atOurs = oursEv != null ? lboAtPrice(a, oursEv) : null;
  const [busy, setBusy] = useState<"" | "save" | "excel">("");
  const [err, setErr] = useState<string | null>(null);
  const avg = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / Math.max(1, arr.length);
  const varies = (arr: number[]) => arr.some(x => Math.abs(x - arr[0]) > 1e-9);
  const set = (patch: Partial<LboInputs>) => onChange(normalizeLbo({ ...a, ...patch }));
  const allYears = (v: number) => Array.from({ length: a.holdingPeriodYears }, () => v);
  const m = (x: number) => x / unitScale; // display in the football field's units

  const entryGrid = [-1, -0.5, 0, 0.5, 1].map(d => Math.max(0.5, +(a.entryMultiple + d).toFixed(1)));
  const exitGrid = [-1, -0.5, 0, 0.5, 1].map(d => Math.max(0.5, +(a.exitMultiple + d).toFixed(1)));
  const grid = lboSensitivity(a, entryGrid, exitGrid);

  async function save() {
    setBusy("save"); setErr(null);
    const res = await fetch(`/api/valuation/${companyId}/lbo`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: model.id, name: model.name, assumptions: a }) });
    setBusy("");
    if (res.ok) onSaved(); else setErr((await res.json().catch(() => ({}))).error ?? "Couldn't save");
  }
  async function excel() {
    setBusy("excel"); setErr(null);
    try {
      const res = await fetch("/api/financial-models/lbo/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvedPlan: a, companyName: a.companyName }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.file) throw new Error(j.error ?? "Couldn't build the Excel");
      const bytes = Uint8Array.from(atob(j.file), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const link = document.createElement("a"); link.href = url; link.download = j.filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't build the Excel"); }
    setBusy("");
  }
  async function remove() {
    if (!confirm(`Delete "${model.name}"?`)) return;
    const res = await fetch(`/api/valuation/${companyId}/lbo?id=${model.id}`, { method: "DELETE" });
    if (res.ok) onDeleted();
  }

  const inp = "w-full px-2 py-1 text-[12px] bg-paper border border-chalk rounded-[6px] text-carbon text-right tabular-nums focus:outline-none focus:border-carbon";
  const Field = ({ label, value, onCommit, suffix }: { label: string; value: number; onCommit: (v: number) => void; suffix?: string }) => (
    <label className="text-[10px] text-slate">{label}{suffix ? ` (${suffix})` : ""}
      <input key={`${label}-${value}`} defaultValue={+value.toFixed(4)} onBlur={e => { const n = Number(e.target.value.replace(/[,\s]/g, "")); if (Number.isFinite(n) && n !== +value.toFixed(4)) onCommit(n); }} className={inp} />
    </label>
  );

  return (
    <div className="border border-chalk rounded-[10px] p-4">
      <div className="flex items-center gap-2 mb-3">
        <input value={model.name} onChange={e => onRename(e.target.value)} className="text-[13px] font-semibold text-carbon bg-transparent border-b border-transparent hover:border-chalk focus:border-carbon focus:outline-none flex-1 min-w-0" />
        {model.dirty && <span className="text-[10px] text-amber-700">Unsaved changes</span>}
        {err && <span className="text-[10px] text-red-600">{err}</span>}
        <Button variant={model.dirty ? "fill" : "outline"} size="sm" loading={busy === "save"} onClick={save} disabled={!model.dirty}>Save</Button>
        <Button variant="outline" size="sm" loading={busy === "excel"} onClick={excel}>Excel model</Button>
        <button onClick={remove} className="text-slate hover:text-red-600 px-1 text-[14px]" title="Delete">×</button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr_1fr] gap-4">
        <div className="grid grid-cols-3 gap-2 content-start">
          <Field label="Entry EBITDA" suffix={unitLabel} value={m(a.entryEbitda)} onCommit={v => set({ entryEbitda: v * unitScale })} />
          <Field label="Revenue year 0" suffix={unitLabel} value={m(a.revenueYear0)} onCommit={v => set({ revenueYear0: v * unitScale })} />
          <Field label="Entry multiple" suffix="x" value={a.entryMultiple} onCommit={v => set({ entryMultiple: v })} />
          <Field label="Debt / EBITDA" suffix="x" value={a.debtToEbitda} onCommit={v => set({ debtToEbitda: v })} />
          <Field label="Interest rate" suffix="%" value={a.interestRatePct * 100} onCommit={v => set({ interestRatePct: v / 100 })} />
          <Field label="Exit multiple" suffix="x" value={a.exitMultiple} onCommit={v => set({ exitMultiple: v })} />
          <Field label={`Revenue growth${varies(a.revenueGrowthPct) ? " (avg)" : ""}`} suffix="%/yr" value={avg(a.revenueGrowthPct) * 100} onCommit={v => set({ revenueGrowthPct: allYears(v / 100) })} />
          <Field label={`EBITDA margin${varies(a.ebitdaMarginPct) ? " (avg)" : ""}`} suffix="%" value={avg(a.ebitdaMarginPct) * 100} onCommit={v => set({ ebitdaMarginPct: allYears(v / 100) })} />
          <Field label="Holding period" suffix="yrs" value={a.holdingPeriodYears} onCommit={v => set({ holdingPeriodYears: Math.round(v) })} />
          <p className="col-span-3 text-[10px] text-slate">Capex {fmtP(avg(a.capexPctRevenue))}, NWC {fmtP(avg(a.nwcPctRevenue))} and D&amp;A {fmtP(avg(a.daPctRevenue))} of revenue · tax {fmtP(a.taxRatePct)} · cash sweep {fmtP(a.cashSweepPct)}. Editing an average sets every year to it; the Excel model has the full detail.</p>
        </div>

        <div className="text-[12px] space-y-1">
          <Row k="Entry EV" v={`${fmtN(m(r.entryEv))}`} />
          <Row k="Debt raised" v={fmtN(m(r.initialDebt))} />
          <Row k="Sponsor equity" v={fmtN(m(r.equity))} />
          <Row k={`Exit EV (year ${a.holdingPeriodYears})`} v={fmtN(m(r.exitEv))} />
          <Row k="Exit equity" v={fmtN(m(r.exitEquity))} />
          <div className="border-t border-chalk pt-1.5 mt-1.5 flex gap-4">
            <div><p className="text-[10px] text-slate">IRR</p><p className="text-[18px] font-semibold text-carbon font-poly">{fmtP(r.irr)}</p></div>
            <div><p className="text-[10px] text-slate">MOIC</p><p className="text-[18px] font-semibold text-carbon font-poly">{fmtX(r.moic)}</p></div>
          </div>
          {atOurs && (
            <p className="text-[11px] text-graphite bg-fog rounded-[6px] px-2 py-1.5">At our valuation ({fmtN(m(oursEv!))}, {fmtX(a.entryEbitda ? oursEv! / a.entryEbitda : null)}): <strong>{fmtP(atOurs.irr)} IRR</strong>, {fmtX(atOurs.moic)} MOIC</p>
          )}
          <p className="text-[10px] text-slate">Amounts in {unitLabel}.</p>
        </div>

        <div>
          <p className="text-[10px] text-slate mb-1">IRR by entry (rows) × exit multiple</p>
          <table className="w-full text-[10px] tabular-nums">
            <thead><tr><th />{exitGrid.map(x => <th key={x} className="text-right font-semibold text-slate px-1">{fmtX(x)}</th>)}</tr></thead>
            <tbody>
              {entryGrid.map((en, i) => (
                <tr key={en}>
                  <td className="font-semibold text-slate pr-1">{fmtX(en)}</td>
                  {grid[i].map((irr, j) => (
                    <td key={j} className={`text-right px-1 py-0.5 ${i === 2 && j === 2 ? "bg-carbon text-white rounded" : irr != null && irr >= 0.2 ? "text-emerald-700" : irr != null && irr < 0.1 ? "text-red-600" : "text-carbon"}`}>{fmtP(irr)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-slate">{k}</span><span className="text-carbon tabular-nums">{v}</span></div>;
}
