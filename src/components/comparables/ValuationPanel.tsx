"use client";
// Football-field valuation for a private company from its public comparables:
// editable company metrics (any currency / units), net-debt bridge, valuation
// methods (comp multiples over all or a subset of comps, or a manual multiple
// range such as precedent transactions) and the firm's own valuation drawn as
// a dashed line, in the format of PANDO's Excel football fields.
import { useEffect, useMemo, useRef, useState } from "react";

import {
  computeValuation, defaultValuation, MULTIPLES, UNITS, uid, DEFAULT_LBO_IRRS,
  type ValComp, type ValCompany, type ValuationConfig, type Method, type Multiple, type LboModelRef,
} from "@/lib/valuation";
export { computeValuation, defaultValuation };
export type { ValComp, ValCompany, ValuationConfig, LboModelRef };

const CURRENCIES = ["USD", "MXN", "EUR", "COP", "BRL", "CLP", "PEN", "ARS", "GBP"];

// PANDO football-field palette (from the Excel template)
const C_LOW = "#42533E", C_MID = "#806E4B", C_HIGH = "#AFC1AB", C_LINE = "#404040", C_TEXT = "#0A231F", C_MUTED = "#6B7B6B";

function fmtVal(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v < 0 ? "-" : ""}$${s}`;
}
const fmtX = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(1)}x`);
const fmtPct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`);
const num = (s: string): number | null => {
  const v = Number(s.replace(/[$,\s]/g, ""));
  return s.trim() === "" || !Number.isFinite(v) ? null : v;
};

/** Read-only football field (e.g. on a deal page); edited in Comparables › Valuation. */
export function ValuationSummary({ config, comps, lbos = [] }: { config: string | null; comps: ValComp[]; lbos?: LboModelRef[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  let cfg: ValuationConfig | null = null;
  try { cfg = config ? JSON.parse(config) as ValuationConfig : null; } catch { cfg = null; }
  if (!cfg) return null;
  const v = computeValuation(cfg, comps, lbos);
  if (!v.chartRows.length) return null;
  return (
    <div>
      <p className="text-[11px] text-slate mb-2">{v.valueLabel}, {v.unitLabel}{v.ours != null && <> · {cfg.ours.label}: <strong className="text-carbon">{fmtVal(v.ours)}</strong></>}</p>
      <FootballField svgRef={svgRef} rows={v.chartRows.map(r => ({
        label: r.m.label, sub: `${r.metric?.label ?? ""}${r.m.kind === "comps" ? ` · ${r.n} comps` : ""}`,
        low: r.low!, mid: r.mid!, high: r.high!, q1: r.q1, med: r.med, q3: r.q3,
      }))} ours={v.ours} oursLabel={cfg.ours.label} />
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────
export function ValuationPanel({ comps, company, compSetId, saved, lboModels = [], onChange }: {
  comps: ValComp[]; company: ValCompany; compSetId: string | null; saved: string | null;
  lboModels?: LboModelRef[]; onChange?: (cfg: ValuationConfig) => void;
}) {
  const [cfg, setCfg] = useState<ValuationConfig>(() => {
    try { if (saved) return JSON.parse(saved) as ValuationConfig; } catch { /* default */ }
    return defaultValuation(company);
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const first = useRef(true);
  const svgRef = useRef<SVGSVGElement>(null);

  // Autosave (debounced) to the company's comp set
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!compSetId) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/comparables", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: compSetId, valuation: cfg }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
        setSaveState("saved"); setSaveErr(null);
      } catch (e) {
        setSaveState("error"); setSaveErr(e instanceof Error ? e.message : "Save failed");
      }
    }, 800);
    return () => clearTimeout(t);
  }, [cfg, compSetId]);

  useEffect(() => { onChange?.(cfg); }, [cfg, onChange]);
  const update = (patch: Partial<ValuationConfig>) => setCfg(c => ({ ...c, ...patch }));
  const withData = comps.filter(c => c.lastRefreshed);
  const { rows, oursEv, ours, chartRows, unitLabel, valueLabel } = useMemo(() => computeValuation(cfg, comps, lboModels), [cfg, comps, lboModels]);

  // ── Editing helpers ──
  const setMethod = (id: string, patch: Partial<Method>) => update({ methods: cfg.methods.map(m => (m.id === id ? { ...m, ...patch } : m)) });
  const addMethod = (kind: Method["kind"]) => update({
    methods: [...cfg.methods, {
      id: uid(), enabled: true, kind, multiple: "evEbitda", tickers: null, metricId: cfg.metrics[0]?.id ?? "",
      label: kind === "manual" ? "Precedent transactions (EV/EBITDA)" : kind === "lbo" ? "LBO (target IRR)" : "Trading comps (EV/EBITDA)",
      manual: { low: null, mid: null, high: null },
      ...(kind === "lbo" ? { lbo: { modelId: lboModels[0]?.id ?? "", ...DEFAULT_LBO_IRRS } } : {}),
    }],
  });
  const moveMethod = (id: string, dir: -1 | 1) => {
    const i = cfg.methods.findIndex(m => m.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cfg.methods.length) return;
    const next = [...cfg.methods];
    [next[i], next[j]] = [next[j], next[i]];
    update({ methods: next });
  };

  function downloadPng() {
    const svg = svgRef.current;
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    const vb = svg.viewBox.baseVal;
    img.onload = () => {
      const scale = 3;
      const canvas = document.createElement("canvas");
      canvas.width = vb.width * scale; canvas.height = vb.height * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const a = document.createElement("a");
      a.download = `Football field - ${company.name}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  }

  const input = "w-full px-2 py-1 text-[12px] bg-paper border border-chalk rounded-[6px] text-carbon focus:outline-none focus:border-carbon";
  const numInput = `${input} text-right tabular-nums`;

  return (
    <div className="space-y-4">
      {/* ── Football field ── */}
      <div className="bg-paper rounded-[10px] border border-chalk p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <p className="text-[15px] font-semibold text-carbon font-poly">Valuation summary (football field) — {company.name}</p>
            <p className="text-[11px] text-slate mt-0.5">
              {valueLabel}, {unitLabel}. Each bar runs from the first to the third quartile of the multiple applied to the company&apos;s metric; the color change is the median.
              {ours != null && " The dashed line is our valuation."}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[10px] ${saveState === "error" ? "text-red-600" : "text-slate"}`}>
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? saveErr : ""}
            </span>
            <button onClick={downloadPng} disabled={!chartRows.length}
              className="text-[11px] font-medium border border-chalk rounded-[7px] px-2.5 py-1 hover:border-carbon disabled:opacity-40">
              Download PNG
            </button>
          </div>
        </div>
        {chartRows.length ? (
          <FootballField svgRef={svgRef} rows={chartRows.map(r => ({
            label: r.m.label, sub: `${r.metric?.label ?? ""}${r.m.kind === "comps" ? ` · ${r.n} comps` : ""}`,
            low: r.low!, mid: r.mid!, high: r.high!, q1: r.q1, med: r.med, q3: r.q3,
          }))} ours={ours} oursLabel={cfg.ours.label} />
        ) : (
          <p className="text-[12px] text-slate py-10 text-center">
            Add a metric value and at least one method with data below. Comp multiples load with &quot;Refresh data&quot;.
          </p>
        )}
      </div>

      {/* ── Summary table (like the Excel) ── */}
      {rows.length > 0 && (
        <div className="bg-paper rounded-[10px] border border-chalk overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-chalk text-slate">
                {["Method", "Company metric", `Metric (${unitLabel})`, "Q1", "Median", "Q3", "Low", "Mid", "High",
                  ...(ours != null ? ["Ours / metric", "Ours vs median"] : [])].map(h => (
                  <th key={h} className={`px-3 py-2 font-semibold uppercase tracking-wide text-[9px] ${h === "Method" || h === "Company metric" ? "text-left" : "text-right"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.m.id} className={`border-b border-chalk last:border-0 ${r.m.enabled ? "" : "opacity-40"}`}>
                  <td className="px-3 py-2 text-carbon font-medium">{r.m.label}{r.m.kind === "comps" && <span className="text-slate font-normal"> ({r.n})</span>}</td>
                  <td className="px-3 py-2 text-graphite">{r.metric?.label ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtVal(r.metric?.value, 1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtX(r.q1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtX(r.med)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtX(r.q3)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtVal(r.low)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtVal(r.mid)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtVal(r.high)}</td>
                  {ours != null && <>
                    <td className="px-3 py-2 text-right tabular-nums">{oursEv != null && r.metric?.value ? fmtX(oursEv / r.metric.value) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.mid ? fmtPct(ours / r.mid - 1) : "—"}</td>
                  </>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* ── Company metrics + bridge ── */}
        <div className="bg-paper rounded-[10px] border border-chalk p-4 space-y-3">
          <p className="text-[13px] font-semibold text-carbon">Company metrics</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-slate">Currency
              <select value={cfg.currency} onChange={e => update({ currency: e.target.value })} className={input}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-[10px] text-slate">Units
              <select value={cfg.unit} onChange={e => update({ unit: e.target.value as ValuationConfig["unit"] })} className={input}>
                {Object.entries(UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <div className="space-y-1.5">
            {cfg.metrics.map(m => (
              <div key={m.id} className="flex items-center gap-1.5">
                <input value={m.label} onChange={e => update({ metrics: cfg.metrics.map(x => x.id === m.id ? { ...x, label: e.target.value } : x) })} className={input} />
                <input defaultValue={m.value ?? ""} onBlur={e => update({ metrics: cfg.metrics.map(x => x.id === m.id ? { ...x, value: num(e.target.value) } : x) })}
                  placeholder="value" className={`${numInput} max-w-[100px]`} />
                <button title="Remove metric" disabled={cfg.metrics.length <= 1}
                  onClick={() => update({ metrics: cfg.metrics.filter(x => x.id !== m.id) })}
                  className="text-slate hover:text-red-600 px-1 disabled:opacity-30">×</button>
              </div>
            ))}
            <button onClick={() => update({ metrics: [...cfg.metrics, { id: uid(), label: "New metric (e.g. EBITDA 2026E)", value: null }] })}
              className="text-[11px] text-slate hover:text-carbon">+ Add metric</button>
          </div>
          <p className="text-[10px] text-slate">Enter metrics in {unitLabel}. Comp multiples are currency-neutral, so the valuation comes out in this currency.</p>

          <div className="border-t border-chalk pt-3 space-y-2">
            <p className="text-[12px] font-semibold text-carbon">Show values as</p>
            <div className="flex gap-1">
              {(["ev", "equity"] as const).map(b => (
                <button key={b} onClick={() => update({ basis: b })}
                  className={`flex-1 text-[11px] py-1 rounded-[6px] border ${cfg.basis === b ? "bg-carbon text-white border-carbon" : "border-chalk text-graphite hover:border-carbon"}`}>
                  {b === "ev" ? "Enterprise value" : "Equity value"}
                </button>
              ))}
            </div>
            {cfg.basis === "equity" && (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] text-slate">Less: debt
                  <input defaultValue={cfg.debt ?? ""} onBlur={e => update({ debt: num(e.target.value) })} className={numInput} />
                </label>
                <label className="text-[10px] text-slate">Plus: cash
                  <input defaultValue={cfg.cash ?? ""} onBlur={e => update({ cash: num(e.target.value) })} className={numInput} />
                </label>
              </div>
            )}
          </div>
        </div>

        {/* ── Methods ── */}
        <div className="bg-paper rounded-[10px] border border-chalk p-4 space-y-3 xl:col-span-2">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold text-carbon">Valuation methods</p>
            <div className="flex gap-2">
              <button onClick={() => addMethod("comps")} className="text-[11px] font-medium border border-chalk rounded-[7px] px-2.5 py-1 hover:border-carbon">+ Comps multiple</button>
              <button onClick={() => addMethod("manual")} className="text-[11px] font-medium border border-chalk rounded-[7px] px-2.5 py-1 hover:border-carbon">+ Manual range</button>
              {lboModels.length > 0 && <button onClick={() => addMethod("lbo")} className="text-[11px] font-medium border border-chalk rounded-[7px] px-2.5 py-1 hover:border-carbon">+ LBO</button>}
            </div>
          </div>
          {cfg.methods.map((m, i) => {
            const r = rows[i];
            return (
              <div key={m.id} className="border border-chalk rounded-[8px] p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={m.enabled} onChange={() => setMethod(m.id, { enabled: !m.enabled })} title="Show in football field" />
                  <input value={m.label} onChange={e => setMethod(m.id, { label: e.target.value })} className={`${input} font-medium`} />
                  <button onClick={() => moveMethod(m.id, -1)} className="text-slate hover:text-carbon px-1" title="Move up">↑</button>
                  <button onClick={() => moveMethod(m.id, 1)} className="text-slate hover:text-carbon px-1" title="Move down">↓</button>
                  <button onClick={() => update({ methods: cfg.methods.filter(x => x.id !== m.id) })} className="text-slate hover:text-red-600 px-1" title="Remove">×</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
                  <label className="text-[10px] text-slate">Type
                    <select value={m.kind} onChange={e => {
                      const kind = e.target.value as Method["kind"];
                      setMethod(m.id, { kind, ...(kind === "lbo" && !m.lbo ? { lbo: { modelId: lboModels[0]?.id ?? "", ...DEFAULT_LBO_IRRS } } : {}) });
                    }} className={input}>
                      <option value="comps">Comps multiple</option>
                      <option value="manual">Manual range</option>
                      {(lboModels.length > 0 || m.kind === "lbo") && <option value="lbo">LBO (target IRR)</option>}
                    </select>
                  </label>
                  {m.kind === "lbo" ? (
                    <>
                      <label className="text-[10px] text-slate col-span-1">LBO model
                        <select value={m.lbo?.modelId ?? ""} onChange={e => setMethod(m.id, { lbo: { ...DEFAULT_LBO_IRRS, ...m.lbo, modelId: e.target.value } })} className={input}>
                          {!lboModels.some(x => x.id === m.lbo?.modelId) && <option value="">Select…</option>}
                          {lboModels.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      </label>
                      <div className="grid grid-cols-3 gap-1 col-span-2">
                        {(["irrLow", "irrMid", "irrHigh"] as const).map(k => (
                          <label key={k} className="text-[10px] text-slate">{k === "irrLow" ? "Low: IRR %" : k === "irrMid" ? "Mid: IRR %" : "High: IRR %"}
                            <input defaultValue={Math.round(((m.lbo ?? DEFAULT_LBO_IRRS)[k]) * 100)}
                              onBlur={e => { const v = num(e.target.value); if (v != null) setMethod(m.id, { lbo: { modelId: m.lbo?.modelId ?? "", ...DEFAULT_LBO_IRRS, ...m.lbo, [k]: v / 100 } }); }}
                              className={numInput} />
                          </label>
                        ))}
                      </div>
                      <p className="text-[10px] text-slate col-span-2 md:col-span-4">
                        The most we could pay and still earn each IRR, from the model&apos;s projections and debt.{r?.note ? ` ${r.note}.` : ""} Implied EV/EBITDA {fmtX(r?.q1)} · <strong>{fmtX(r?.med)}</strong> · {fmtX(r?.q3)}
                      </p>
                    </>
                  ) : <>
                  <label className="text-[10px] text-slate">Multiple
                    <select value={m.multiple} onChange={e => setMethod(m.id, { multiple: e.target.value as Multiple })} className={input}>
                      {Object.entries(MULTIPLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </label>
                  <label className="text-[10px] text-slate">Applied to
                    <select value={m.metricId} onChange={e => setMethod(m.id, { metricId: e.target.value })} className={input}>
                      {cfg.metrics.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>
                  </label>
                  {m.kind === "manual" ? (
                    <div className="grid grid-cols-3 gap-1 col-span-2 md:col-span-1">
                      {(["low", "mid", "high"] as const).map(k => (
                        <label key={k} className="text-[10px] text-slate">{k === "low" ? "Q1 / low" : k === "mid" ? "Median" : "Q3 / high"}
                          <input defaultValue={m.manual[k] ?? ""} onBlur={e => setMethod(m.id, { manual: { ...m.manual, [k]: num(e.target.value) } })}
                            placeholder="x" className={numInput} />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-graphite pb-1">
                      Q1 {fmtX(r?.q1)} · <strong>Med {fmtX(r?.med)}</strong> · Q3 {fmtX(r?.q3)}
                    </p>
                  )}
                  </>}
                </div>
                {m.kind === "comps" && (
                  <div>
                    <p className="text-[10px] text-slate mb-1">
                      Comps used ({r?.n ?? 0}){m.tickers ? "" : ": all with data"} — click to include / exclude
                      {m.tickers && <button onClick={() => setMethod(m.id, { tickers: null })} className="ml-2 underline hover:text-carbon">use all</button>}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {withData.map(c => {
                        const v = c[m.multiple];
                        const valid = v != null && v > 0 && v <= MULTIPLES[m.multiple].max;
                        const on = valid && (!m.tickers || m.tickers.includes(c.ticker));
                        return (
                          <button key={c.ticker} disabled={!valid}
                            title={valid ? `${c.name}: ${fmtX(v)}` : `${c.name}: not meaningful (${v == null ? "no data" : fmtX(v)})`}
                            onClick={() => {
                              const current = m.tickers ?? withData.filter(x => { const xv = x[m.multiple]; return xv != null && xv > 0 && xv <= MULTIPLES[m.multiple].max; }).map(x => x.ticker);
                              setMethod(m.id, { tickers: on ? current.filter(t => t !== c.ticker) : [...current, c.ticker] });
                            }}
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${!valid ? "border-chalk text-slate/50 line-through" : on ? "bg-forest text-white border-forest" : "border-chalk text-slate hover:border-carbon"}`}>
                            {c.ticker} {valid ? fmtX(v) : "NM"}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Our valuation ── */}
      <div className="bg-paper rounded-[10px] border border-chalk p-4">
        <div className="flex items-center gap-2 mb-3">
          <input type="checkbox" checked={cfg.ours.enabled} onChange={() => update({ ours: { ...cfg.ours, enabled: !cfg.ours.enabled } })} />
          <p className="text-[13px] font-semibold text-carbon">Our valuation (dashed line)</p>
          {ours != null && <span className="text-[12px] text-graphite ml-auto">{valueLabel}: <strong>{fmtVal(ours)}</strong>{oursEv != null && cfg.basis === "equity" && ` (EV ${fmtVal(oursEv)})`}</span>}
        </div>
        {cfg.ours.enabled && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
            <label className="text-[10px] text-slate">Label
              <input value={cfg.ours.label} onChange={e => update({ ours: { ...cfg.ours, label: e.target.value } })} className={input} />
            </label>
            <label className="text-[10px] text-slate">Defined as
              <select value={cfg.ours.mode} onChange={e => update({ ours: { ...cfg.ours, mode: e.target.value as "value" | "multiple" } })} className={input}>
                <option value="multiple">Multiple × metric</option>
                <option value="value">Enterprise value</option>
              </select>
            </label>
            {cfg.ours.mode === "multiple" ? (
              <>
                <label className="text-[10px] text-slate">Multiple (x)
                  <input defaultValue={cfg.ours.multiple ?? ""} onBlur={e => update({ ours: { ...cfg.ours, multiple: num(e.target.value) } })} className={numInput} />
                </label>
                <label className="text-[10px] text-slate">Applied to
                  <select value={cfg.ours.metricId} onChange={e => update({ ours: { ...cfg.ours, metricId: e.target.value } })} className={input}>
                    {cfg.metrics.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <label className="text-[10px] text-slate">Enterprise value ({unitLabel})
                <input defaultValue={cfg.ours.value ?? ""} onBlur={e => update({ ours: { ...cfg.ours, value: num(e.target.value) } })} className={numInput} />
              </label>
            )}
          </div>
        )}
      </div>

      <p className="text-[10px] text-slate leading-relaxed">
        Comp multiples are trailing (Yahoo Finance, refreshed with &quot;Refresh data&quot;); negative and extreme values (EV/EBITDA above {MULTIPLES.evEbitda.max}x, EV/Revenue above {MULTIPLES.evRevenue.max}x) are excluded as not meaningful.
        Quartiles use Excel&apos;s QUARTILE.INC method. Manual ranges (e.g. precedent transactions) include whatever premium their source reflects.
      </p>
    </div>
  );
}

// ── Football field chart (SVG, PANDO Excel format) ───────────────────────────
type FFRow = { label: string; sub: string; low: number; mid: number; high: number; q1: number | null; med: number | null; q3: number | null };

function niceStep(range: number, target = 6): number {
  const raw = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function FootballField({ rows, ours, oursLabel, svgRef }: {
  rows: FFRow[]; ours: number | null; oursLabel: string; svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  const W = 1000, LABEL_W = 250, PAD_R = 70, TOP = ours != null ? 34 : 14, ROW_H = 54, BAR_H = 24, AXIS_H = 28;
  const H = TOP + rows.length * ROW_H + AXIS_H;
  const maxV = Math.max(...rows.map(r => r.high), ours ?? 0);
  const minV = Math.min(0, ...rows.map(r => r.low), ours ?? 0);
  const step = niceStep(maxV - minV);
  const axisMax = Math.ceil((maxV * 1.04) / step) * step;
  const axisMin = Math.floor(minV / step) * step;
  const plotW = W - LABEL_W - PAD_R;
  const x = (v: number) => LABEL_W + ((v - axisMin) / (axisMax - axisMin)) * plotW;
  const ticks: number[] = [];
  for (let t = axisMin; t <= axisMax + 1e-9; t += step) ticks.push(t);
  const font = "Work Sans, Inter, system-ui, sans-serif";

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" xmlns="http://www.w3.org/2000/svg" fontFamily={font}>
      <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
      {/* gridlines + axis */}
      {ticks.map(t => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={TOP - 4} y2={H - AXIS_H} stroke="#EEF1EC" strokeWidth="1" />
          <text x={x(t)} y={H - AXIS_H + 16} textAnchor="middle" fontSize="10" fill={C_MUTED}>{fmtVal(t)}</text>
        </g>
      ))}
      <line x1={LABEL_W} x2={LABEL_W} y1={TOP - 4} y2={H - AXIS_H} stroke="#D9DBD4" strokeWidth="1" />

      {ours != null && (
        <g>
          <line x1={x(ours)} x2={x(ours)} y1={TOP - 6} y2={H - AXIS_H} stroke={C_LINE} strokeWidth="1.5" strokeDasharray="7 5" />
          <text x={x(ours)} y={TOP - 12} textAnchor="middle" fontSize="11" fontWeight="600" fill={C_TEXT}>{`${oursLabel}: ${fmtVal(ours)}`}</text>
        </g>
      )}
      {rows.map((r, i) => {
        const cy = TOP + i * ROW_H + ROW_H / 2;
        const y = cy - BAR_H / 2;
        const xl = x(r.low), xm = x(r.mid), xh = x(r.high);
        return (
          <g key={i}>
            <text x={LABEL_W - 12} y={cy - 2} textAnchor="end" fontSize="12" fontWeight="600" fill={C_TEXT}>{r.label}</text>
            <text x={LABEL_W - 12} y={cy + 13} textAnchor="end" fontSize="10" fill={C_MUTED}>{r.sub}</text>
            <rect x={xl} y={y} width={Math.max(0, xm - xl)} height={BAR_H} fill={C_LOW}>
              <title>{`Q1 ${fmtX(r.q1)} → ${fmtVal(r.low)}`}</title>
            </rect>
            <rect x={xm} y={y} width={Math.max(0, xh - xm)} height={BAR_H} fill={C_HIGH}>
              <title>{`Q3 ${fmtX(r.q3)} → ${fmtVal(r.high)}`}</title>
            </rect>
            <rect x={xm - 2} y={y} width="4" height={BAR_H} fill={C_MID}>
              <title>{`Median ${fmtX(r.med)} → ${fmtVal(r.mid)}`}</title>
            </rect>
            {/* white halo keeps the labels readable where the dashed line crosses them */}
            <text x={xl - 6} y={cy + 4} textAnchor="end" fontSize="11" fill={C_TEXT} stroke="#ffffff" strokeWidth="4" paintOrder="stroke">{fmtVal(r.low)}</text>
            <text x={xh + 6} y={cy + 4} textAnchor="start" fontSize="11" fill={C_TEXT} stroke="#ffffff" strokeWidth="4" paintOrder="stroke">{fmtVal(r.high)}</text>
          </g>
        );
      })}

    </svg>
  );
}
