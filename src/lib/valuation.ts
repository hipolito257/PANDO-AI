// Football-field valuation math, shared by the editor (ValuationPanel), the
// valuation workspace, and the server (decks, documents, chat context).
// Methods: trading-comp multiples (quartiles over all or some comps), manual
// multiple ranges (e.g. precedent transactions) and LBO (the enterprise value
// that yields each target IRR in one of the company's LBO models).
import { maxEntryEvForIrr, type LboInputs } from "@/lib/lboCalc";

export type ValComp = { ticker: string; name: string; evEbitda: number | null; evRevenue: number | null; lastRefreshed: string | null };
export type ValCompany = { name: string; revenueUsd: number | null; ebitdaUsd: number | null };
export type LboModelRef = { id: string; name: string; assumptions: Partial<LboInputs> };

export type Multiple = "evEbitda" | "evRevenue";
export type Metric = { id: string; label: string; value: number | null };
export type LboMethod = { modelId: string; irrLow: number; irrMid: number; irrHigh: number }; // IRRs as fractions
export type Method = {
  id: string; label: string; enabled: boolean;
  kind: "comps" | "manual" | "lbo";
  multiple: Multiple;
  tickers: string[] | null;               // null = every comp with data
  metricId: string;
  manual: { low: number | null; mid: number | null; high: number | null };
  lbo?: LboMethod;
};
export type ValuationConfig = {
  version: 1;
  currency: string; unit: "m" | "k" | "";
  metrics: Metric[];
  debt: number | null; cash: number | null;
  basis: "ev" | "equity";
  methods: Method[];
  ours: { enabled: boolean; label: string; mode: "value" | "multiple"; value: number | null; multiple: number | null; metricId: string };
};

export const MULTIPLES: Record<Multiple, { label: string; max: number }> = {
  // Values outside (0, max] are not meaningful (negative EBITDA, distressed or hyper-growth outliers)
  evEbitda:  { label: "EV / EBITDA", max: 60 },
  evRevenue: { label: "EV / Revenue", max: 30 },
};
export const UNITS: Record<ValuationConfig["unit"], string> = { m: "millions", k: "thousands", "": "units" };
export const UNIT_SCALE: Record<ValuationConfig["unit"], number> = { m: 1e6, k: 1e3, "": 1 };
export const DEFAULT_LBO_IRRS = { irrLow: 0.25, irrMid: 0.2, irrHigh: 0.15 };

export const uid = () => Math.random().toString(36).slice(2, 9);

// Excel QUARTILE.INC (linear interpolation between order statistics)
export function quantile(arr: number[], p: number): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = p * (s.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export function defaultValuation(company: ValCompany): ValuationConfig {
  const rev = company.revenueUsd != null ? +(company.revenueUsd / 1e6).toFixed(1) : null;
  const ebitda = company.ebitdaUsd != null ? +(company.ebitdaUsd / 1e6).toFixed(1) : null;
  return {
    version: 1, currency: "USD", unit: "m",
    metrics: [
      { id: "ebitda", label: "EBITDA LTM", value: ebitda },
      { id: "revenue", label: "Revenue LTM", value: rev },
    ],
    debt: null, cash: null, basis: "ev",
    methods: [
      { id: uid(), label: "Trading comps (EV/EBITDA)", enabled: true, kind: "comps", multiple: "evEbitda", tickers: null, metricId: "ebitda", manual: { low: null, mid: null, high: null } },
      { id: uid(), label: "Trading comps (EV/Revenue)", enabled: true, kind: "comps", multiple: "evRevenue", tickers: null, metricId: "revenue", manual: { low: null, mid: null, high: null } },
    ],
    ours: { enabled: false, label: "PANDO valuation", mode: "multiple", value: null, multiple: null, metricId: "ebitda" },
  };
}

export function parseValuation(json: string | null | undefined): ValuationConfig | null {
  if (!json) return null;
  try { return JSON.parse(json) as ValuationConfig; } catch { return null; }
}

export function computeValuation(cfg: ValuationConfig, comps: ValComp[], lbos: LboModelRef[] = []) {
  const metricById = (id: string) => cfg.metrics.find(m => m.id === id) ?? null;
  const bridge = (ev: number | null) => (ev == null ? null : cfg.basis === "equity" ? ev - (cfg.debt ?? 0) + (cfg.cash ?? 0) : ev);
  const withData = comps.filter(c => c.lastRefreshed);
  const scale = UNIT_SCALE[cfg.unit] ?? 1;

  const rows = cfg.methods.map(m => {
    let metric = metricById(m.metricId);
    let q1: number | null = null, med: number | null = null, q3: number | null = null, n = 0;
    let used: string[] = [];
    let lowEv: number | null = null, midEv: number | null = null, highEv: number | null = null;
    let note: string | null = null;
    if (m.kind === "lbo") {
      // The price (EV) that earns each target IRR; low bar end = highest IRR target.
      const model = lbos.find(x => x.id === m.lbo?.modelId);
      const t = { ...DEFAULT_LBO_IRRS, ...m.lbo };
      if (model) {
        const ev = (irr: number) => { const v = maxEntryEvForIrr(model.assumptions, irr); return v == null ? null : v / scale; };
        lowEv = ev(t.irrLow); midEv = ev(t.irrMid); highEv = ev(t.irrHigh);
        const e0 = model.assumptions.entryEbitda ? model.assumptions.entryEbitda / scale : null;
        const x = (v: number | null) => (v != null && e0 ? v / e0 : null);
        q1 = x(lowEv); med = x(midEv); q3 = x(highEv);
        metric = { id: "lbo", label: `${model.name} · IRR ${Math.round(t.irrLow * 100)}% / ${Math.round(t.irrMid * 100)}% / ${Math.round(t.irrHigh * 100)}%`, value: e0 };
        if (model.assumptions.currency && model.assumptions.currency !== cfg.currency) note = `LBO is in ${model.assumptions.currency}; football field in ${cfg.currency}`;
      } else {
        note = "Pick an LBO model";
      }
    } else {
      if (m.kind === "comps") {
        const pool = withData.filter(c => !m.tickers || m.tickers.includes(c.ticker));
        const vals = pool
          .map(c => ({ t: c.ticker, v: c[m.multiple] }))
          .filter((x): x is { t: string; v: number } => x.v != null && x.v > 0 && x.v <= MULTIPLES[m.multiple].max);
        used = vals.map(x => x.t);
        n = vals.length;
        const arr = vals.map(x => x.v);
        q1 = quantile(arr, 0.25); med = quantile(arr, 0.5); q3 = quantile(arr, 0.75);
      } else {
        q1 = m.manual.low; med = m.manual.mid; q3 = m.manual.high;
      }
      const mv = metric?.value ?? null;
      const ev = (x: number | null) => (x != null && mv != null ? x * mv : null);
      lowEv = ev(q1); midEv = ev(med); highEv = ev(q3);
    }
    return { m, metric, n, used, q1, med, q3, lowEv, midEv, highEv, low: bridge(lowEv), mid: bridge(midEv), high: bridge(highEv), note };
  });

  const oursMetric = metricById(cfg.ours.metricId)?.value ?? null;
  const oursEv = cfg.ours.enabled
    ? cfg.ours.mode === "value" ? cfg.ours.value
      : cfg.ours.multiple != null && oursMetric != null ? cfg.ours.multiple * oursMetric : null
    : null;
  return {
    rows,
    oursEv,
    ours: bridge(oursEv),
    chartRows: rows.filter(r => r.m.enabled && r.low != null && r.high != null && r.mid != null),
    unitLabel: `${cfg.currency} ${UNITS[cfg.unit]}`.trim(),
    valueLabel: cfg.basis === "equity" ? "Equity value" : "Enterprise value",
    scale,
  };
}

const f1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "n/a" : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));
const fx = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "n/a" : `${v.toFixed(1)}x`);

/** Plain-text summary for AI context (decks, documents, chat). */
export function valuationText(cfg: ValuationConfig, comps: ValComp[], lbos: LboModelRef[]): string {
  const v = computeValuation(cfg, comps, lbos);
  if (!v.chartRows.length && v.ours == null) return "";
  const lines = [`${v.valueLabel} in ${v.unitLabel}. Metrics: ${cfg.metrics.map(m => `${m.label} ${f1(m.value)}`).join(", ")}.`];
  for (const r of v.chartRows) {
    const how = r.m.kind === "comps" ? `${r.n} trading comps, ${MULTIPLES[r.m.multiple].label} quartiles ${fx(r.q1)} / ${fx(r.med)} / ${fx(r.q3)} on ${r.metric?.label}`
      : r.m.kind === "manual" ? `${MULTIPLES[r.m.multiple].label} ${fx(r.q1)} / ${fx(r.med)} / ${fx(r.q3)} on ${r.metric?.label}`
        : `LBO max price for target IRR (${r.metric?.label}); implied EV/EBITDA ${fx(r.q1)} / ${fx(r.med)} / ${fx(r.q3)}`;
    lines.push(`- ${r.m.label}: low ${f1(r.low)}, mid ${f1(r.mid)}, high ${f1(r.high)} (${how})`);
  }
  if (v.ours != null) lines.push(`- ${cfg.ours.label} (the firm's own view, dashed line): ${f1(v.ours)}`);
  if (cfg.basis === "equity") lines.push(`Equity bridge: less debt ${f1(cfg.debt)}, plus cash ${f1(cfg.cash)}.`);
  return lines.join("\n");
}

/** hbar_float element spec for a deck slide (football field). */
export function footballFieldSpec(cfg: ValuationConfig, comps: ValComp[], lbos: LboModelRef[]) {
  const v = computeValuation(cfg, comps, lbos);
  return {
    series: v.chartRows.map(r => ({ label: r.m.label, min: +r.low!.toFixed(1), max: +r.high!.toFixed(1) })),
    colors: ["42533E", "806E4B", "AFC1AB", "42533E", "806E4B", "AFC1AB"],
  };
}
