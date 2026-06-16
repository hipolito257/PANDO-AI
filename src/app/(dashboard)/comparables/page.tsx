"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Topbar } from "@/components/layout/Topbar";
import {
  ResponsiveContainer,
  ComposedChart, ScatterChart, Scatter, Line,
  BarChart, Bar, Cell, LabelList,
  LineChart,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ReferenceLine, Legend,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────
type Company = {
  id: string; name: string; slug: string; sector: string | null;
  country: string; stage: string | null; fundingStage: string | null;
  description: string | null; revenueUsd: number | null;
  ebitdaUsd: number | null; revenueGrowth: number | null;
  ebitdaMargin: number | null; score: number; status: string;
};
type PublicComp = {
  id: string; ticker: string; name: string; sector: string | null;
  exchange: string | null; description: string | null;
  marketCapUsd: number | null; evUsd: number | null;
  revenueUsd: number | null; ebitdaUsd: number | null;
  revenueGrowth: number | null; grossMargin: number | null;
  operatingMargin: number | null; ebitdaMargin: number | null;
  netMargin: number | null; fcfUsd: number | null;
  evRevenue: number | null; evEbitda: number | null;
  peRatio: number | null; psRatio: number | null; pbRatio: number | null;
  roe: number | null; debtToEquity: number | null; beta: number | null;
  lastRefreshed: string | null;
};
type CompSet = {
  id: string; name: string; tickers: string; notes: string | null;
  company: Company | null; comps: PublicComp[];
};
type AISuggestion = { ticker: string; name: string; exchange: string; reason: string };

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtB = (n: number | null | undefined) => {
  const v = toNum(n);
  if (v == null) return "—";
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (Math.abs(v) >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
  return `$${(v / 1e3).toFixed(0)}K`;
};
const toNum = (n: number | null | undefined): number | null => {
  if (n == null) return null;
  const v = typeof n === "number" ? n : Number(n);
  return isNaN(v) ? null : v;
};
const fmtX   = (n: number | null | undefined) => { const v = toNum(n); return v == null ? "—" : `${v.toFixed(1)}x`; };
const fmtPct = (n: number | null | undefined) => { const v = toNum(n); return v == null ? "—" : `${(v * 100).toFixed(1)}%`; };
const fmtGrowth = (n: number | null | undefined) => {
  const v = toNum(n);
  if (v == null) return "—";
  const p = Math.abs(v) < 2 ? v * 100 : v;
  return `${p > 0 ? "+" : ""}${p.toFixed(0)}%`;
};
const toGrowthPct = (n: number | null | undefined) => {
  const v = toNum(n);
  return v == null ? null : (Math.abs(v) < 2 ? v * 100 : v);
};
const r40 = (growth: number | null | undefined, margin: number | null | undefined) => {
  const g = toGrowthPct(toNum(growth));
  const m = toGrowthPct(toNum(margin));
  if (g == null || m == null) return null;
  return g + m;
};

// Stats
function pct(arr: number[], p: number) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = (p / 100) * (s.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const median = (arr: number[]) => pct(arr, 50);

function regression(pts: { x: number; y: number }[]) {
  const n = pts.length;
  if (n < 3) return null;
  const sx = pts.reduce((a, p) => a + p.x, 0);
  const sy = pts.reduce((a, p) => a + p.y, 0);
  const sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
  const sx2 = pts.reduce((a, p) => a + p.x * p.x, 0);
  const denom = n * sx2 - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

const COLORS = ["#202020","#ea5c2b","#6366f1","#0ea5e9","#10b981","#f59e0b","#ec4899","#8b5cf6","#14b8a6","#f97316"];

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════
function ComparablesPage() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  const [companies,   setCompanies]   = useState<Company[]>([]);
  const [compSet,     setCompSet]     = useState<CompSet | null>(null);
  const [loadingSet,  setLoadingSet]  = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [refreshLog,  setRefreshLog]  = useState("");
  const [activeTab,   setActiveTab]   = useState<"datos"|"graficas"|"valuacion">("datos");
  const [showSearch,  setShowSearch]  = useState(false);
  const [showAI,      setShowAI]      = useState(false);
  const [mounted,     setMounted]     = useState(false);
  const [historyData, setHistoryData] = useState<Record<string, { date: string; indexed: number }[]>>({});
  const [loadingHist, setLoadingHist] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    fetch("/api/companies?limit=100")
      .then(r => r.json())
      .then(d => Array.isArray(d) ? setCompanies(d) : setCompanies([]));
  }, []);

  const loadCompSet = useCallback(async (cid: string) => {
    setLoadingSet(true);
    setCompSet(null);
    setHistoryData({});
    const res = await fetch(`/api/comparables?companyId=${cid}`);
    const sets: CompSet[] = await res.json();
    setCompSet(sets[0] ?? null);
    setLoadingSet(false);
  }, []);

  useEffect(() => {
    if (selectedCompanyId) loadCompSet(selectedCompanyId);
    else { setCompSet(null); setLoadingSet(false); }
  }, [selectedCompanyId, loadCompSet]);

  const selectCompany = (id: string) => {
    setSelectedCompanyId(id);
    setActiveTab("datos");
  };

  const selectedCompany = companies.find(c => c.id === selectedCompanyId) ?? null;
  const tickers: string[] = compSet ? JSON.parse(compSet.tickers) : [];
  const comps = compSet?.comps ?? [];
  const hasData = comps.some(c => c.lastRefreshed);

  async function refresh() {
    if (!tickers.length) return;
    setRefreshing(true);
    setRefreshLog("Consultando Yahoo Finance...");
    const res = await fetch("/api/comparables/refresh", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers }),
    });
    const data = await res.json();
    const ok   = data.report?.filter((r: any) => r.ok).length ?? 0;
    const fail = data.report?.filter((r: any) => !r.ok) ?? [];
    setRefreshLog(`✓ ${ok} actualizados${fail.length ? ` · ${fail.length} sin datos (${fail.map((f: any) => f.ticker).join(", ")})` : ""}`);
    setRefreshing(false);
    if (selectedCompanyId) loadCompSet(selectedCompanyId);
  }

  const histTickerKey = tickers.join(",");
  async function loadHistory() {
    if (!tickers.length || Object.keys(historyData).length) return;
    setLoadingHist(true);
    const res = await fetch(`/api/comparables/history?tickers=${histTickerKey}`);
    const data = await res.json();
    setHistoryData(data);
    setLoadingHist(false);
  }

  useEffect(() => {
    if (activeTab === "graficas") loadHistory();
  }, [activeTab, histTickerKey]);

  async function addTicker(ticker: string, name: string, exchange?: string) {
    if (tickers.includes(ticker)) return;
    await fetch("/api/comparables/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, name, exchange }),
    });
    if (compSet) {
      await fetch("/api/comparables", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: compSet.id, tickers: [...tickers, ticker] }),
      });
    } else if (selectedCompanyId && selectedCompany) {
      await fetch("/api/comparables", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${selectedCompany.name} — Comparables`, companyId: selectedCompanyId, tickers: [ticker] }),
      });
    }
    if (selectedCompanyId) loadCompSet(selectedCompanyId);
    setRefreshLog("");
  }

  async function removeTicker(ticker: string) {
    if (!compSet) return;
    await fetch("/api/comparables", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: compSet.id, tickers: tickers.filter(t => t !== ticker) }),
    });
    if (selectedCompanyId) loadCompSet(selectedCompanyId);
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Topbar
        title="Comparables"
        subtitle="Múltiplos públicos aplicados a tus empresas privadas"
        actions={
          <div className="flex items-center gap-2">
            {tickers.length > 0 && (
              <>
                {refreshLog && <span className="text-[11px] text-slate hidden lg:block max-w-[240px] truncate">{refreshLog}</span>}
                <button onClick={refresh} disabled={refreshing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-fog border border-chalk rounded-[8px] hover:border-carbon transition-colors disabled:opacity-50">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                    className={refreshing ? "animate-spin" : ""}>
                    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                  {refreshing ? "Actualizando..." : "Actualizar datos"}
                </button>
              </>
            )}
          </div>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Company sidebar */}
        <aside className="w-[220px] shrink-0 border-r border-chalk bg-paper overflow-y-auto flex flex-col">
          <div className="p-3 border-b border-chalk">
            <p className="text-[10px] text-slate uppercase tracking-wider font-semibold">Radar de empresas</p>
            <p className="text-[10px] text-slate mt-0.5">{companies.length} monitoreadas</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {companies.map(c => (
              <button key={c.id} onClick={() => selectCompany(c.id)}
                className={`w-full text-left px-2.5 py-2 rounded-[8px] transition-all
                  ${selectedCompanyId === c.id ? "bg-carbon text-white" : "hover:bg-fog text-carbon"}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-[5px] flex items-center justify-center text-[9px] font-bold shrink-0
                    ${selectedCompanyId === c.id ? "bg-white/20 text-white" : "bg-orange/10 text-orange"}`}>
                    {c.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-[12px] font-medium truncate ${selectedCompanyId === c.id ? "text-white" : "text-carbon"}`}>{c.name}</p>
                    <p className={`text-[10px] truncate ${selectedCompanyId === c.id ? "text-white/50" : "text-slate"}`}>{c.sector ?? c.country}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Main area */}
        <main className="flex-1 overflow-y-auto bg-fog/20">
          {!selectedCompany ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-[40px] mb-3">📊</p>
                <p className="text-[15px] font-semibold text-carbon">Selecciona una empresa del radar</p>
                <p className="text-[12px] text-slate mt-1">Elige una empresa para ver su análisis de comparables públicos</p>
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-4 max-w-[1200px]">
              {/* Company header */}
              <div className="bg-paper rounded-[10px] border border-chalk p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="w-10 h-10 rounded-[8px] bg-orange flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                    {selectedCompany.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-[180px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-[16px] font-semibold text-carbon font-poly">{selectedCompany.name}</h2>
                      <span className="text-[10px] bg-orange/10 text-orange border border-orange/20 px-2 py-0.5 rounded-full font-medium">PRIVADA</span>
                      {selectedCompany.sector && <span className="text-[10px] bg-fog border border-chalk text-slate px-2 py-0.5 rounded-full">{selectedCompany.sector}</span>}
                    </div>
                    {selectedCompany.description && <p className="text-[11px] text-slate mt-0.5 line-clamp-1">{selectedCompany.description}</p>}
                  </div>
                  <div className="flex gap-4 shrink-0">
                    {[
                      { l: "Revenue",    v: fmtB(selectedCompany.revenueUsd) },
                      { l: "EBITDA",     v: fmtB(selectedCompany.ebitdaUsd) },
                      { l: "Crec.",      v: fmtGrowth(selectedCompany.revenueGrowth) },
                      { l: "Mg.EBITDA",  v: fmtPct(selectedCompany.ebitdaMargin) },
                    ].map(({ l, v }) => (
                      <div key={l} className="text-center">
                        <p className="text-[15px] font-bold text-carbon font-poly">{v}</p>
                        <p className="text-[9px] text-slate">{l}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Peer bar */}
              <div className="bg-paper rounded-[10px] border border-chalk p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-slate uppercase tracking-wide font-semibold shrink-0">Peers públicos:</span>
                  {tickers.length === 0 && <span className="text-[11px] text-slate italic">Sin peers configurados — agrégalos con los botones</span>}
                  {tickers.map(t => (
                    <span key={t} className="inline-flex items-center gap-1 bg-fog border border-chalk px-2 py-0.5 rounded-full text-[11px] font-mono font-bold text-carbon">
                      {t}
                      <button onClick={() => removeTicker(t)} className="hover:text-red-500 transition-colors ml-0.5 leading-none">×</button>
                    </span>
                  ))}
                  <div className="flex gap-1.5 ml-auto">
                    <button onClick={() => setShowAI(true)}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-carbon/5 border border-chalk rounded-[6px] hover:border-carbon transition-colors">
                      ✨ IA Sugerir
                    </button>
                    <button onClick={() => setShowSearch(true)}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-carbon text-white rounded-[6px] hover:opacity-85 transition-opacity">
                      + Buscar ticker
                    </button>
                  </div>
                </div>
                {!hasData && tickers.length > 0 && (
                  <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-[6px] px-2.5 py-1 inline-block">
                    ⚠️ Sin datos de mercado — presiona "Actualizar datos" para jalar Yahoo Finance
                  </p>
                )}
              </div>

              {/* Empty peers state */}
              {tickers.length === 0 && !loadingSet && (
                <div className="bg-paper rounded-[12px] border border-chalk p-10 text-center">
                  <p className="text-[32px] mb-3">🔍</p>
                  <p className="text-[14px] font-semibold text-carbon">Sin peers configurados</p>
                  <p className="text-[12px] text-slate mt-1 mb-4">
                    Agrega empresas públicas comparables para generar el análisis de valuación
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button onClick={() => setShowAI(true)}
                      className="px-4 py-2 text-[12px] font-medium bg-carbon text-white rounded-btn hover:opacity-85">
                      ✨ Sugerir con IA
                    </button>
                    <button onClick={() => setShowSearch(true)}
                      className="px-4 py-2 text-[12px] font-medium bg-fog border border-chalk text-graphite rounded-btn hover:border-carbon">
                      Buscar manualmente
                    </button>
                  </div>
                </div>
              )}

              {/* Tabs + content */}
              {tickers.length > 0 && (
                <>
                  <div className="flex gap-1 bg-paper border border-chalk rounded-[10px] p-1 w-fit">
                    {(["datos","graficas","valuacion"] as const).map(tab => (
                      <button key={tab} onClick={() => setActiveTab(tab)}
                        className={`px-4 py-1.5 text-[12px] font-medium rounded-[7px] transition-all
                          ${activeTab === tab ? "bg-carbon text-white shadow-sm" : "text-slate hover:text-carbon"}`}>
                        {tab === "datos" ? "📊 Datos" : tab === "graficas" ? "📈 Gráficas" : "💰 Valuación"}
                      </button>
                    ))}
                  </div>

                  {activeTab === "datos" && (
                    <MetricsTable comps={comps} company={selectedCompany} />
                  )}
                  {activeTab === "graficas" && mounted && (
                    <ChartsPanel comps={comps} company={selectedCompany}
                      historyData={historyData} loadingHist={loadingHist} />
                  )}
                  {activeTab === "valuacion" && mounted && (
                    <ValuationPanel comps={comps} company={selectedCompany} />
                  )}
                </>
              )}
            </div>
          )}
        </main>
      </div>

      {showSearch && (
        <PeerSearchDrawer onClose={() => setShowSearch(false)} onAdd={addTicker} existingTickers={tickers} />
      )}
      {showAI && selectedCompanyId && (
        <AISuggestPanel companyId={selectedCompanyId} existingTickers={tickers}
          onClose={() => setShowAI(false)} onAdd={addTicker} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// COLUMN DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════════
type ColKey = "marketCap"|"ev"|"revenue"|"growth"|"ebitda"|"grossMargin"|"operatingMargin"|"ebitdaMargin"|"netMargin"|"fcf"|"evRev"|"evEbitda"|"pe"|"ps"|"pb"|"roe"|"de"|"beta"|"r40";

const ALL_COLS: { key: ColKey; label: string; group: string }[] = [
  { key: "marketCap",       label: "Mkt Cap",       group: "Tamaño" },
  { key: "ev",              label: "EV",             group: "Tamaño" },
  { key: "revenue",         label: "Revenue",        group: "Tamaño" },
  { key: "fcf",             label: "FCF",            group: "Tamaño" },
  { key: "growth",          label: "Crec. Rev.",     group: "Crecimiento" },
  { key: "ebitda",          label: "EBITDA",         group: "Rentabilidad" },
  { key: "grossMargin",     label: "Mg. Bruto",      group: "Márgenes" },
  { key: "operatingMargin", label: "Mg. Operativo",  group: "Márgenes" },
  { key: "ebitdaMargin",    label: "Mg. EBITDA",     group: "Márgenes" },
  { key: "netMargin",       label: "Mg. Neto",       group: "Márgenes" },
  { key: "roe",             label: "ROE",            group: "Rentabilidad" },
  { key: "evRev",           label: "EV/Rev",         group: "Múltiplos" },
  { key: "evEbitda",        label: "EV/EBITDA",      group: "Múltiplos" },
  { key: "pe",              label: "P/E",            group: "Múltiplos" },
  { key: "ps",              label: "P/S",            group: "Múltiplos" },
  { key: "pb",              label: "P/B",            group: "Múltiplos" },
  { key: "de",              label: "Deuda/Capital",  group: "Balance" },
  { key: "beta",            label: "Beta",           group: "Mercado" },
  { key: "r40",             label: "R40",            group: "Salud" },
];

const DEFAULT_COLS: ColKey[] = ["marketCap","ev","revenue","growth","ebitda","grossMargin","ebitdaMargin","evRev","evEbitda","pe","r40"];

// ══════════════════════════════════════════════════════════════════════════════
// METRICS TABLE
// ══════════════════════════════════════════════════════════════════════════════
function MetricsTable({ comps, company }: { comps: PublicComp[]; company: Company }) {
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(new Set(DEFAULT_COLS));
  const [showColPicker, setShowColPicker] = useState(false);
  const hasData = comps.some(c => c.lastRefreshed);
  const cols = ALL_COLS.filter(c => visibleCols.has(c.key));

  function toggleCol(k: ColKey) {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  // Helper: get value for a column key from a comp row (or null for private)
  function compVal(c: PublicComp, key: ColKey): React.ReactNode {
    switch (key) {
      case "marketCap": return <span className="text-[11px] text-graphite">{fmtB(c.marketCapUsd)}</span>;
      case "ev":        return <span className="text-[11px] text-graphite">{fmtB(c.evUsd)}</span>;
      case "revenue":   return <span className="text-[12px] font-medium text-carbon">{fmtB(c.revenueUsd)}</span>;
      case "fcf":       return <span className="text-[11px] text-graphite">{fmtB(c.fcfUsd)}</span>;
      case "growth":    return c.revenueGrowth != null
        ? <span className={toGrowthPct(c.revenueGrowth)! >= 0 ? "text-[12px] text-emerald-600 font-medium" : "text-[12px] text-red-500 font-medium"}>{fmtGrowth(c.revenueGrowth)}</span>
        : <span className="text-[11px] text-slate">—</span>;
      case "ebitda":          return <span className="text-[11px] text-graphite">{fmtB(c.ebitdaUsd)}</span>;
      case "grossMargin":     return <span className="text-[11px] text-graphite">{fmtPct(c.grossMargin)}</span>;
      case "operatingMargin": return <span className="text-[11px] text-graphite">{fmtPct(c.operatingMargin)}</span>;
      case "ebitdaMargin":    return <span className="text-[11px] text-graphite">{fmtPct(c.ebitdaMargin)}</span>;
      case "netMargin":       return <span className="text-[11px] text-graphite">{fmtPct(c.netMargin)}</span>;
      case "roe":             return <span className="text-[11px] text-graphite">{fmtPct(c.roe)}</span>;
      case "evRev":    return <MultipleChip value={c.evRevenue} />;
      case "evEbitda": return <MultipleChip value={c.evEbitda} />;
      case "pe":       return <span className="text-[11px] text-graphite">{fmtX(c.peRatio)}</span>;
      case "ps":       return <span className="text-[11px] text-graphite">{fmtX(c.psRatio)}</span>;
      case "pb":       return <span className="text-[11px] text-graphite">{fmtX(c.pbRatio)}</span>;
      case "de":       return <span className="text-[11px] text-graphite">{c.debtToEquity != null ? c.debtToEquity.toFixed(2) : "—"}</span>;
      case "beta":     return <span className="text-[11px] text-graphite">{c.beta != null ? c.beta.toFixed(2) : "—"}</span>;
      case "r40": {
        const v = r40(c.revenueGrowth, c.ebitdaMargin);
        return v != null ? <R40Chip val={v} /> : <span className="text-[11px] text-slate">—</span>;
      }
    }
  }

  // Helper: get value for private company row
  function privateVal(key: ColKey): React.ReactNode {
    switch (key) {
      case "revenue": return <span className="text-[12px] font-semibold text-carbon">{fmtB(company.revenueUsd)}</span>;
      case "growth":  return company.revenueGrowth != null
        ? <span className="text-[12px] text-emerald-600 font-semibold">{fmtGrowth(company.revenueGrowth)}</span>
        : <span className="text-[11px] text-slate">—</span>;
      case "ebitda":      return <span className="text-[12px] font-semibold text-carbon">{fmtB(company.ebitdaUsd)}</span>;
      case "ebitdaMargin": return <span className="text-[12px] text-graphite">{fmtPct(company.ebitdaMargin)}</span>;
      case "r40": {
        const v = r40(company.revenueGrowth, company.ebitdaMargin);
        return v != null ? <R40Chip val={v} /> : <span className="text-[11px] text-slate">—</span>;
      }
      default: return <span className="text-[11px] text-slate">—</span>;
    }
  }

  // Helper: median cell for footer
  function medianVal(key: ColKey): React.ReactNode {
    const nums = (arr: (number|null)[]) => arr.filter((x): x is number => x != null);
    switch (key) {
      case "marketCap":       return fmtB(median(nums(comps.map(c=>c.marketCapUsd))));
      case "ev":              return fmtB(median(nums(comps.map(c=>c.evUsd))));
      case "revenue":         return fmtB(median(nums(comps.map(c=>c.revenueUsd))));
      case "fcf":             return fmtB(median(nums(comps.map(c=>c.fcfUsd))));
      case "growth":          return fmtGrowth(median(nums(comps.map(c=>toGrowthPct(c.revenueGrowth)))));
      case "ebitda":          return fmtB(median(nums(comps.map(c=>c.ebitdaUsd))));
      case "grossMargin":     return fmtPct(median(nums(comps.map(c=>c.grossMargin))));
      case "operatingMargin": return fmtPct(median(nums(comps.map(c=>c.operatingMargin))));
      case "ebitdaMargin":    return fmtPct(median(nums(comps.map(c=>c.ebitdaMargin))));
      case "netMargin":       return fmtPct(median(nums(comps.map(c=>c.netMargin))));
      case "roe":             return fmtPct(median(nums(comps.map(c=>c.roe))));
      case "evRev": {
        const a = nums(comps.map(c=>c.evRevenue)).filter(x=>x>0&&x<200);
        return a.length ? `${median(a)!.toFixed(1)}x` : "—";
      }
      case "evEbitda": {
        const a = nums(comps.map(c=>c.evEbitda)).filter(x=>x>0&&x<500);
        return a.length ? `${median(a)!.toFixed(1)}x` : "—";
      }
      case "pe":   { const a=nums(comps.map(c=>c.peRatio)).filter(x=>x>0&&x<200); return a.length?`${median(a)!.toFixed(1)}x`:"—"; }
      case "ps":   { const a=nums(comps.map(c=>c.psRatio)).filter(x=>x>0&&x<200); return a.length?`${median(a)!.toFixed(1)}x`:"—"; }
      case "pb":   { const a=nums(comps.map(c=>c.pbRatio)).filter(x=>x>0&&x<200); return a.length?`${median(a)!.toFixed(1)}x`:"—"; }
      case "de":   { const a=nums(comps.map(c=>c.debtToEquity)); return a.length?median(a)!.toFixed(2):"—"; }
      case "beta": { const a=nums(comps.map(c=>c.beta)); return a.length?median(a)!.toFixed(2):"—"; }
      case "r40":  { const a=nums(comps.map(c=>r40(c.revenueGrowth,c.ebitdaMargin))); return a.length?`${median(a)!.toFixed(0)}`:"—"; }
    }
  }

  const isMultiple = (k: ColKey) => ["evRev","evEbitda"].includes(k);
  const isR40      = (k: ColKey) => k === "r40";

  // Group cols for picker
  const groups = [...new Set(ALL_COLS.map(c => c.group))];

  return (
    <div className="bg-paper rounded-[10px] border border-chalk overflow-hidden">
      <div className="px-4 py-3 border-b border-chalk flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-carbon">Tabla de múltiplos</p>
          <p className="text-[11px] text-slate">{comps.length} peers públicos · datos de Yahoo Finance</p>
        </div>
        <div className="flex items-center gap-2">
          {!hasData && <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-[6px]">Sin datos — actualizar</span>}
          <div className="relative">
            <button onClick={() => setShowColPicker(v => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium border border-chalk rounded-[7px] hover:border-carbon bg-white transition-colors">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="1" y="1" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="7" y="1" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="1" y="7" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="7" y="7" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3"/>
              </svg>
              Columnas ({visibleCols.size})
            </button>
            {showColPicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowColPicker(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-chalk rounded-[10px] shadow-xl p-3 w-[280px]">
                  <p className="text-[10px] font-semibold text-slate uppercase tracking-wide mb-2">Selecciona columnas</p>
                  {groups.map(group => (
                    <div key={group} className="mb-2.5">
                      <p className="text-[9px] font-bold text-slate/60 uppercase tracking-wider mb-1">{group}</p>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                        {ALL_COLS.filter(c => c.group === group).map(col => (
                          <label key={col.key} className="flex items-center gap-1.5 cursor-pointer py-0.5 group">
                            <input type="checkbox" checked={visibleCols.has(col.key)} onChange={() => toggleCol(col.key)}
                              className="w-3 h-3 accent-carbon" />
                            <span className="text-[11px] text-carbon group-hover:text-graphite">{col.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button onClick={() => setVisibleCols(new Set(DEFAULT_COLS))}
                    className="mt-1 text-[10px] text-slate hover:text-carbon underline">
                    Restaurar por defecto
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[9px] text-slate uppercase tracking-wide border-b border-chalk bg-fog/40">
              <th className="px-3 py-2.5 text-left font-semibold sticky left-0 bg-fog/40">Empresa</th>
              {cols.map(c => (
                <th key={c.key} className={`px-3 py-2.5 text-right font-semibold whitespace-nowrap ${isMultiple(c.key) ? "bg-carbon/5" : isR40(c.key) ? "bg-blue-50/60" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-chalk">
            {/* Private company row */}
            <tr className="bg-orange/5 border-b-2 border-orange/20">
              <td className="px-3 py-2.5 sticky left-0 bg-orange/5">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-orange flex items-center justify-center text-[9px] font-bold text-white shrink-0">
                    {company.name.slice(0,2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[12px] font-semibold text-carbon">{company.name}</p>
                    <p className="text-[9px] text-orange font-medium">TARGET PRIVADA</p>
                  </div>
                </div>
              </td>
              {cols.map(c => (
                <td key={c.key} className={`px-3 py-2.5 text-right ${isMultiple(c.key) ? "bg-carbon/3" : isR40(c.key) ? "bg-blue-50/60" : ""}`}>
                  {privateVal(c.key)}
                </td>
              ))}
            </tr>
            {comps.map(comp => (
              <tr key={comp.ticker} className="hover:bg-fog/40 transition-colors">
                <td className="px-3 py-2.5 sticky left-0 bg-paper">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-fog border border-chalk flex items-center justify-center text-[9px] font-bold text-slate shrink-0">
                      {comp.ticker.slice(0,2)}
                    </div>
                    <div>
                      <p className="text-[12px] font-medium text-carbon">{comp.name}</p>
                      <a href={`https://finance.yahoo.com/quote/${comp.ticker}`} target="_blank" rel="noopener noreferrer"
                        className="text-[9px] font-mono text-slate hover:text-orange">{comp.ticker} · {comp.exchange ?? ""}</a>
                    </div>
                  </div>
                </td>
                {cols.map(c => (
                  <td key={c.key} className={`px-3 py-2.5 text-right ${isMultiple(c.key) ? "bg-carbon/3" : isR40(c.key) ? "bg-blue-50/60" : ""}`}>
                    {compVal(comp, c.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {hasData && (
            <tfoot>
              <tr className="border-t-2 border-carbon/20 bg-fog/60 text-[11px] font-semibold">
                <td className="px-3 py-2.5 text-carbon sticky left-0 bg-fog/60">Mediana del set</td>
                {cols.map(c => (
                  <td key={c.key} className={`px-3 py-2.5 text-right ${isMultiple(c.key) ? "bg-carbon/3 text-carbon" : isR40(c.key) ? "bg-blue-50/60 text-blue-700" : "text-carbon"}`}>
                    {medianVal(c.key)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="px-4 py-2 border-t border-chalk bg-fog/20">
        <p className="text-[9px] text-slate">R40 = Rule of 40 (Revenue Growth % + EBITDA Margin %). Buena salud operacional si &gt;40. Datos: Yahoo Finance.</p>
      </div>
    </div>
  );
}

function MultipleChip({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[11px] text-slate">—</span>;
  const color = value > 20 ? "#059669" : value > 8 ? "#d97706" : "#202020";
  return <span className="text-[12px] font-bold" style={{ color }}>{value.toFixed(1)}x</span>;
}

function R40Chip({ val }: { val: number }) {
  const cls = val >= 40 ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : val >= 20 ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-red-50 text-red-600 border-red-200";
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border ${cls}`}>{val.toFixed(0)}</span>;
}

// ══════════════════════════════════════════════════════════════════════════════
// CHARTS PANEL
// ══════════════════════════════════════════════════════════════════════════════
function ChartsPanel({
  comps, company, historyData, loadingHist
}: {
  comps: PublicComp[]; company: Company;
  historyData: Record<string, { date: string; indexed: number }[]>;
  loadingHist: boolean;
}) {
  const hasData = comps.some(c => c.lastRefreshed);

  if (!hasData) {
    return (
      <div className="bg-paper rounded-[10px] border border-chalk p-10 text-center">
        <p className="text-[28px] mb-2">📈</p>
        <p className="text-[13px] font-medium text-carbon">Sin datos de mercado</p>
        <p className="text-[12px] text-slate mt-1">Presiona "Actualizar datos" para jalar los múltiplos de Yahoo Finance</p>
      </div>
    );
  }

  // Scatter data — Growth vs EV/Revenue
  const scatterData = comps
    .filter(c => c.evRevenue != null && c.revenueGrowth != null)
    .map(c => ({
      x: toGrowthPct(c.revenueGrowth)!,
      y: c.evRevenue!,
      ticker: c.ticker,
      name: c.name,
    }));

  const reg = regression(scatterData);
  const regLineData = reg && scatterData.length >= 3
    ? (() => {
        const xs = scatterData.map(d => d.x);
        const xMin = Math.min(...xs) - 5;
        const xMax = Math.max(...xs) + 5;
        return [
          { x: xMin, y: Math.max(0, reg.slope * xMin + reg.intercept) },
          { x: xMax, y: Math.max(0, reg.slope * xMax + reg.intercept) },
        ];
      })()
    : null;

  const privateGrowthPct = toGrowthPct(company.revenueGrowth);
  const impliedMultiple  = reg && privateGrowthPct != null
    ? Math.max(0, reg.slope * privateGrowthPct + reg.intercept)
    : null;

  // Bar chart — Revenue
  const barData = [
    { name: company.name.split(" ")[0], fullName: company.name, value: company.revenueUsd ?? 0, isPrivate: true },
    ...comps
      .filter(c => c.revenueUsd)
      .sort((a, b) => (b.revenueUsd ?? 0) - (a.revenueUsd ?? 0))
      .map(c => ({ name: c.ticker, fullName: c.name, value: c.revenueUsd!, isPrivate: false })),
  ];

  // Historical line chart
  const allDates = [...new Set(Object.values(historyData).flatMap(d => d.map(p => p.date)))].sort();
  const histChartData = allDates.map(date => {
    const row: Record<string, number | string> = { date };
    Object.entries(historyData).forEach(([ticker, pts]) => {
      const pt = pts.find(p => p.date === date);
      if (pt) row[ticker] = pt.indexed;
    });
    return row;
  });

  const ScatterTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div className="bg-white border border-chalk rounded-[8px] p-2.5 shadow-lg text-[11px]">
        <p className="font-bold text-carbon">{d.name}</p>
        <p className="text-slate font-mono text-[10px]">{d.ticker}</p>
        <p className="text-slate mt-1">Revenue Growth: <span className="text-carbon font-medium">{d.x.toFixed(0)}%</span></p>
        <p className="text-slate">EV/Revenue: <span className="text-carbon font-medium">{d.y.toFixed(1)}x</span></p>
      </div>
    );
  };

  const BarTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div className="bg-white border border-chalk rounded-[8px] p-2 shadow-lg text-[11px]">
        <p className="font-semibold text-carbon">{d?.fullName ?? label}</p>
        <p className="text-slate">Revenue: <span className="font-bold text-carbon">{fmtB(payload[0].value)}</span></p>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Scatter: Growth vs EV/Revenue */}
      {scatterData.length >= 2 && (
        <div className="bg-paper rounded-[10px] border border-chalk p-5">
          <div className="mb-3">
            <p className="text-[13px] font-semibold text-carbon">Crecimiento vs. EV/Revenue</p>
            <p className="text-[11px] text-slate">
              La línea de tendencia muestra el múltiplo que el mercado "paga" por cada nivel de crecimiento.
              {impliedMultiple != null && privateGrowthPct != null && (
                <span className="ml-1 text-orange font-semibold">
                  Con {privateGrowthPct.toFixed(0)}% de crecimiento, la regresión implica ~{impliedMultiple.toFixed(1)}x EV/Rev para {company.name}.
                </span>
              )}
            </p>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart margin={{ top: 15, right: 40, bottom: 30, left: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
              <XAxis dataKey="x" type="number" domain={["auto","auto"]}
                tickFormatter={(v: unknown) => `${(v as number).toFixed(0)}%`} tick={{ fontSize: 10 }}
                label={{ value: "Revenue Growth (%)", position: "insideBottom", offset: -10, style: { fontSize: 10, fill: "#8a8480" } }} />
              <YAxis dataKey="y" type="number" domain={[0,"auto"]}
                tickFormatter={(v: unknown) => `${(v as number).toFixed(0)}x`} tick={{ fontSize: 10 }}
                label={{ value: "EV / Revenue", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 10, fill: "#8a8480" } }} />
              <RTooltip content={<ScatterTooltip />} />
              {regLineData && (
                <Line data={regLineData} dataKey="y" dot={false} activeDot={false}
                  stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 4" legendType="none" />
              )}
              {privateGrowthPct != null && (
                <ReferenceLine x={privateGrowthPct} stroke="#ea5c2b" strokeWidth={2} strokeDasharray="5 3"
                  label={{ value: company.name.split(" ")[0], position: "insideTopLeft", fill: "#ea5c2b", fontSize: 10, fontWeight: "bold" }} />
              )}
              <Scatter data={scatterData} fill="#202020" shape={(props: any) => {
                const { cx, cy, payload } = props;
                return (
                  <g>
                    <circle cx={cx} cy={cy} r={6} fill="#202020" fillOpacity={0.8} />
                    <text x={cx + 9} y={cy + 4} fontSize={9} fill="#8a8480" fontFamily="monospace">{payload.ticker}</text>
                  </g>
                );
              }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Bar: Revenue comparison */}
      <div className="bg-paper rounded-[10px] border border-chalk p-5">
        <div className="mb-3">
          <p className="text-[13px] font-semibold text-carbon">Comparación de Revenue</p>
          <p className="text-[11px] text-slate">Tamaño relativo de {company.name} vs. los comparables públicos</p>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={barData} margin={{ top: 15, right: 20, bottom: 10, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={(v: unknown) => fmtB(v as number)} tick={{ fontSize: 10 }} />
            <RTooltip content={<BarTooltip />} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {barData.map((d, i) => (
                <Cell key={i} fill={d.isPrivate ? "#ea5c2b" : COLORS[(i) % COLORS.length]} opacity={d.isPrivate ? 1 : 0.7} />
              ))}
              <LabelList dataKey="value" position="top" formatter={(v: unknown) => fmtB(v as number)} style={{ fontSize: 9, fill: "#8a8480" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Line: Stock performance */}
      <div className="bg-paper rounded-[10px] border border-chalk p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[13px] font-semibold text-carbon">Performance bursátil — 12 meses</p>
            <p className="text-[11px] text-slate">Precios indexados a 100 (inicio del período). Muestra el sentimiento del mercado en este sector.</p>
          </div>
          {loadingHist && <span className="text-[10px] text-slate animate-pulse bg-fog border border-chalk px-2 py-1 rounded-[6px]">Cargando...</span>}
        </div>
        {Object.keys(historyData).length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={histChartData} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} />
              <YAxis domain={["auto","auto"]} tickFormatter={(v: unknown) => `${(v as number).toFixed(0)}`} tick={{ fontSize: 10 }} />
              <RTooltip formatter={(v: unknown) => [`${(v as number).toFixed(1)}`, ""]} contentStyle={{ fontSize: 11 }} />
              <ReferenceLine y={100} stroke="#cbd5e1" strokeDasharray="4 4" />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {Object.keys(historyData).map((ticker, i) => (
                <Line key={ticker} type="monotone" dataKey={ticker}
                  stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[140px] flex items-center justify-center bg-fog/30 rounded-[8px]">
            {loadingHist
              ? <p className="text-[12px] text-slate animate-pulse">Cargando datos de Yahoo Finance...</p>
              : <p className="text-[12px] text-slate">Sin datos históricos disponibles</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// VALUATION PANEL
// ══════════════════════════════════════════════════════════════════════════════
function ValuationPanel({ comps, company }: { comps: PublicComp[]; company: Company }) {
  const evRevArr = comps.map(c => c.evRevenue).filter((x): x is number => x != null && x > 0 && x < 200);
  const evEbArr  = comps.map(c => c.evEbitda).filter((x): x is number => x != null && x > 0 && x < 500);
  const rev    = company.revenueUsd;
  const ebitda = company.ebitdaUsd;

  type Method = { label: string; low: number; mid: number; high: number; basis: string; color: string };
  const methods: Method[] = [];

  if (evRevArr.length >= 2 && rev) {
    methods.push({
      label: "EV / Revenue", color: "#202020",
      low:  pct(evRevArr, 25)! * rev,
      mid:  median(evRevArr)!  * rev,
      high: pct(evRevArr, 75)! * rev,
      basis: `$${rev}M rev × ${pct(evRevArr,25)!.toFixed(1)}x–${pct(evRevArr,75)!.toFixed(1)}x`,
    });
  }
  if (evEbArr.length >= 2 && ebitda && ebitda > 0) {
    methods.push({
      label: "EV / EBITDA", color: "#ea5c2b",
      low:  pct(evEbArr, 25)! * ebitda,
      mid:  median(evEbArr)!  * ebitda,
      high: pct(evEbArr, 75)! * ebitda,
      basis: `$${ebitda}M EBITDA × ${pct(evEbArr,25)!.toFixed(1)}x–${pct(evEbArr,75)!.toFixed(1)}x`,
    });
  }

  if (!methods.length) {
    return (
      <div className="bg-paper rounded-[10px] border border-chalk p-8 text-center">
        <p className="text-[28px] mb-2">💰</p>
        <p className="text-[13px] font-medium text-carbon">Sin datos suficientes para valuación</p>
        <p className="text-[12px] text-slate mt-1">
          Actualiza los datos de mercado y asegúrate de que {company.name} tiene Revenue / EBITDA configurados
        </p>
      </div>
    );
  }

  const allVals = methods.flatMap(m => [m.low, m.mid, m.high]);
  const maxVal  = Math.max(...allVals) * 1.15;
  const discLow  = Math.min(...methods.map(m => m.low))  * 0.725;
  const discHigh = Math.max(...methods.map(m => m.high)) * 0.775;

  return (
    <div className="space-y-4">
      {/* Football field */}
      <div className="bg-paper rounded-[10px] border border-chalk p-5">
        <div className="mb-5">
          <p className="text-[15px] font-semibold text-carbon font-poly">Football field — {company.name}</p>
          <p className="text-[11px] text-slate mt-0.5">Enterprise Value estimado aplicando múltiplos del set de comparables</p>
        </div>
        <div className="space-y-7">
          {methods.map(m => {
            const pLo = (m.low  / maxVal) * 100;
            const pHi = (m.high / maxVal) * 100;
            const pMd = (m.mid  / maxVal) * 100;
            return (
              <div key={m.label}>
                <div className="flex items-baseline justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: m.color }} />
                    <span className="text-[13px] font-semibold text-carbon">{m.label}</span>
                    <span className="text-[10px] text-slate">{m.basis}</span>
                  </div>
                  <span className="text-[18px] font-bold text-carbon font-poly">{fmtB(m.mid)}</span>
                </div>
                <div className="relative h-9 bg-fog rounded-full overflow-hidden border border-chalk">
                  <div className="absolute top-0 h-9 rounded-full"
                    style={{ left: `${pLo}%`, width: `${pHi - pLo}%`, backgroundColor: m.color, opacity: 0.18 }} />
                  <div className="absolute top-0 h-9 rounded-full border"
                    style={{ left: `${pLo}%`, width: `${pHi - pLo}%`, borderColor: `${m.color}55` }} />
                  <div className="absolute top-2 w-2 h-5 rounded-full"
                    style={{ left: `${pMd - 0.5}%`, background: m.color }} />
                </div>
                <div className="flex justify-between text-[10px] mt-1.5">
                  <span className="text-slate">P25: <span className="font-semibold text-carbon">{fmtB(m.low)}</span></span>
                  <span className="font-semibold text-carbon">Mediana: {fmtB(m.mid)}</span>
                  <span className="text-slate">P75: <span className="font-semibold text-carbon">{fmtB(m.high)}</span></span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary cards */}
      <div className={`grid gap-3 ${methods.length === 2 ? "grid-cols-4" : "grid-cols-3"}`}>
        {methods.map(m => (
          <div key={m.label} className="bg-paper rounded-[10px] border border-chalk p-4 text-center">
            <p className="text-[10px] text-slate mb-1">{m.label}</p>
            <p className="text-[22px] font-bold text-carbon font-poly">{fmtB(m.mid)}</p>
            <p className="text-[10px] text-slate mt-1">{fmtB(m.low)} – {fmtB(m.high)}</p>
          </div>
        ))}
        <div className="bg-carbon rounded-[10px] p-4 text-center">
          <p className="text-[10px] text-white/60 mb-1">Rango consolidado</p>
          <p className="text-[22px] font-bold text-white font-poly">
            {fmtB(Math.min(...methods.map(m => m.low)))} – {fmtB(Math.max(...methods.map(m => m.high)))}
          </p>
          <p className="text-[10px] text-white/50 mt-1">{comps.filter(c=>c.lastRefreshed).length} peers con datos</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-[10px] p-4 text-center">
          <p className="text-[10px] text-amber-700 mb-1">Con descuento liquidez (~25%)</p>
          <p className="text-[22px] font-bold text-amber-800 font-poly">
            {fmtB(discLow)} – {fmtB(discHigh)}
          </p>
          <p className="text-[10px] text-amber-600 mt-1">Ajuste típico privadas</p>
        </div>
      </div>

      <div className="bg-fog rounded-[10px] border border-chalk p-3">
        <p className="text-[10px] text-slate leading-relaxed">
          ⚠️ <strong>Estimación de referencia.</strong> Basada en múltiplos de mercado de comparables públicos.
          No constituye una valuación formal. Las empresas privadas típicamente tienen un descuento de liquidez del 20–35%
          vs. públicas. Una valuación formal requiere DCF, transacciones precedentes y due diligence financiero.
        </p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PEER SEARCH DRAWER
// ══════════════════════════════════════════════════════════════════════════════
function PeerSearchDrawer({
  onClose, onAdd, existingTickers
}: {
  onClose: () => void;
  onAdd: (ticker: string, name: string, exchange?: string) => Promise<void>;
  existingTickers: string[];
}) {
  const [q,        setQ]        = useState("");
  const [results,  setResults]  = useState<{ ticker: string; name: string; exchange: string }[]>([]);
  const [searching,setSearching]= useState(false);
  const [added,    setAdded]    = useState<Set<string>>(new Set(existingTickers));
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      const res = await fetch(`/api/comparables/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
      setSearching(false);
    }, 400);
  }, [q]);

  async function handleAdd(r: { ticker: string; name: string; exchange: string }) {
    if (added.has(r.ticker)) return;
    await onAdd(r.ticker, r.name, r.exchange);
    setAdded(prev => new Set([...prev, r.ticker]));
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-carbon/40" onClick={onClose} />
      <div className="relative ml-auto w-[460px] h-full bg-paper shadow-2xl flex flex-col">
        <div className="p-4 border-b border-chalk flex items-center justify-between">
          <div>
            <h3 className="text-[14px] font-semibold text-carbon">Buscar empresa pública</h3>
            <p className="text-[11px] text-slate">Busca por nombre o ticker (ej. "Twilio" o "TWLO")</p>
          </div>
          <button onClick={onClose} className="text-slate hover:text-carbon text-[20px] leading-none w-7 h-7 flex items-center justify-center">×</button>
        </div>
        <div className="p-4 border-b border-chalk">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)}
            placeholder="Ej: Twilio, Block, Nubank, StoneCo..."
            className="w-full px-3 py-2.5 text-[13px] bg-fog border border-chalk rounded-[8px] focus:outline-none focus:border-carbon" />
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {searching && (
            <p className="text-[12px] text-slate text-center py-6 animate-pulse">Buscando en Yahoo Finance...</p>
          )}
          {!searching && results.map(r => (
            <div key={r.ticker} className="flex items-center gap-3 p-3 bg-fog rounded-[8px] border border-chalk hover:border-carbon/30 transition-colors">
              <div className="w-9 h-9 rounded-[6px] bg-paper border border-chalk flex items-center justify-center text-[10px] font-bold font-mono text-carbon shrink-0">
                {r.ticker.slice(0, 3)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-carbon truncate">{r.name}</p>
                <p className="text-[10px] font-mono text-slate">{r.ticker} · {r.exchange}</p>
              </div>
              <button onClick={() => handleAdd(r)} disabled={added.has(r.ticker)}
                className={`px-3 py-1.5 text-[11px] font-medium rounded-[6px] transition-colors shrink-0
                  ${added.has(r.ticker)
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default"
                    : "bg-carbon text-white hover:opacity-85"}`}>
                {added.has(r.ticker) ? "Agregado ✓" : "+ Agregar"}
              </button>
            </div>
          ))}
          {!searching && q.trim() && results.length === 0 && (
            <p className="text-[12px] text-slate text-center py-6">Sin resultados para "{q}"</p>
          )}
          {!q.trim() && (
            <div className="text-center py-8">
              <p className="text-[11px] text-slate">Sugerencias de búsqueda:</p>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {["Twilio","Nubank","Block","StoneCo","Bill.com","Monday"].map(s => (
                  <button key={s} onClick={() => setQ(s)}
                    className="px-2.5 py-1 text-[11px] bg-fog border border-chalk rounded-full hover:border-carbon text-carbon transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="p-3 border-t border-chalk bg-fog/30">
          <p className="text-[9px] text-slate">Búsqueda en tiempo real vía Yahoo Finance · Solo acciones (equities)</p>
        </div>
      </div>
    </div>
  );
}

export default ComparablesPage;

// ══════════════════════════════════════════════════════════════════════════════
// AI SUGGEST PANEL
// ══════════════════════════════════════════════════════════════════════════════
function AISuggestPanel({
  companyId, existingTickers, onClose, onAdd
}: {
  companyId: string; existingTickers: string[];
  onClose: () => void;
  onAdd: (ticker: string, name: string, exchange?: string) => Promise<void>;
}) {
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [noKeyMsg,    setNoKeyMsg]    = useState("");
  const [suggestions, setSuggestions] = useState<AISuggestion[]>([]);
  const [added,       setAdded]       = useState<Set<string>>(new Set(existingTickers));
  const [userPrompt,  setUserPrompt]  = useState("");
  const [fetched,     setFetched]     = useState(false);

  async function doFetch() {
    setLoading(true); setError(""); setNoKeyMsg(""); setSuggestions([]);
    const params = new URLSearchParams({ companyId });
    if (userPrompt.trim()) params.set("userPrompt", userPrompt.trim());
    const d = await fetch(`/api/comparables/suggest?${params}`).then(r => r.json()).catch(e => ({ error: e.message }));
    if (d.error === "no_key") setNoKeyMsg(d.message);
    else if (d.error) setError(d.error);
    else setSuggestions(d.suggestions ?? []);
    setLoading(false);
    setFetched(true);
  }

  async function handleAdd(s: AISuggestion) {
    if (added.has(s.ticker)) return;
    await onAdd(s.ticker, s.name, s.exchange);
    setAdded(prev => new Set([...prev, s.ticker]));
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-carbon/40" onClick={onClose} />
      <div className="relative ml-auto w-[480px] h-full bg-paper shadow-2xl flex flex-col">
        <div className="p-4 border-b border-chalk flex items-center justify-between">
          <div>
            <h3 className="text-[14px] font-semibold text-carbon">✨ Sugerencias de IA</h3>
            <p className="text-[11px] text-slate">Claude analiza tu empresa y sugiere peers públicos comparables</p>
          </div>
          <button onClick={onClose} className="text-slate hover:text-carbon text-[20px] leading-none w-7 h-7 flex items-center justify-center">×</button>
        </div>

        {/* Prompt input */}
        <div className="p-4 border-b border-chalk bg-fog/30 space-y-2">
          <label className="block text-[11px] font-medium text-graphite">Instrucciones para la IA <span className="font-normal text-slate">(Opcional)</span></label>
          <textarea
            value={userPrompt}
            onChange={e => setUserPrompt(e.target.value)}
            rows={3}
            placeholder={"Ej: Busca solo empresas de SaaS B2B con revenue entre $100M-$500M que coticen en NYSE o NASDAQ.\n\nO: Prioriza empresas latinoamericanas o de mercados emergentes similares."}
            className="w-full border border-chalk rounded-[8px] px-3 py-2 text-[11px] text-carbon placeholder:text-slate/40 focus:outline-none focus:border-carbon resize-none bg-white leading-relaxed"
          />
          <button onClick={doFetch} disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2 bg-carbon text-white text-[12px] font-medium rounded-[8px] hover:opacity-85 disabled:opacity-50 transition-opacity">
            {loading
              ? <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10"/></svg>Analizando con IA...</>
              : <><span>✨</span>{fetched ? "Sugerir de nuevo" : "Sugerir comparables"}</>}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {!fetched && !loading && (
            <div className="text-center py-10">
              <p className="text-[32px] mb-2">🔍</p>
              <p className="text-[13px] font-medium text-carbon">Listo para analizar</p>
              <p className="text-[11px] text-slate mt-1">Opcionalmente escribe instrucciones arriba<br />y presiona "Sugerir comparables"</p>
            </div>
          )}

          {loading && (
            <>
              <p className="text-[12px] text-slate text-center py-3 animate-pulse">Analizando con IA...</p>
              {[1,2,3,4,5,6,7].map(i => (
                <div key={i} className="h-16 bg-fog rounded-[8px] border border-chalk animate-pulse" />
              ))}
            </>
          )}

          {noKeyMsg && (
            <div className="bg-amber-50 border border-amber-200 rounded-[10px] p-4 mt-2">
              <p className="text-[13px] font-semibold text-amber-800">⚙️ API key no configurada</p>
              <p className="text-[11px] text-amber-700 mt-1">{noKeyMsg}</p>
              <a href="/settings" className="mt-2 inline-block text-[11px] font-semibold text-amber-700 underline">Ir a Configuración →</a>
            </div>
          )}

          {error && !noKeyMsg && (
            <div className="bg-red-50 border border-red-200 rounded-[8px] p-3">
              <p className="text-[12px] text-red-700 font-medium">Error al generar sugerencias</p>
              <p className="text-[11px] text-red-600 mt-0.5">{error}</p>
            </div>
          )}

          {!loading && suggestions.map(s => (
            <div key={s.ticker} className="flex items-start gap-3 p-3 bg-fog rounded-[8px] border border-chalk hover:border-carbon/30 transition-colors">
              <div className="w-10 h-10 rounded-[6px] bg-paper border border-chalk flex items-center justify-center text-[11px] font-bold font-mono text-carbon shrink-0">
                {s.ticker.slice(0,3)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[12px] font-semibold text-carbon">{s.name}</p>
                  <span className="text-[9px] font-mono text-slate bg-paper border border-chalk px-1.5 py-0.5 rounded">{s.ticker}</span>
                  <span className="text-[9px] text-slate">{s.exchange}</span>
                </div>
                <p className="text-[11px] text-slate mt-0.5 leading-snug">{s.reason}</p>
              </div>
              <button onClick={() => handleAdd(s)} disabled={added.has(s.ticker)}
                className={`px-2.5 py-1.5 text-[11px] font-medium rounded-[6px] transition-colors shrink-0 mt-0.5
                  ${added.has(s.ticker)
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default"
                    : "bg-carbon text-white hover:opacity-85"}`}>
                {added.has(s.ticker) ? "✓" : "+ Add"}
              </button>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-chalk bg-fog/30">
          <p className="text-[9px] text-slate">Sugerencias generadas por Claude (Anthropic). Verifica cada empresa antes de incluirla.</p>
        </div>
      </div>
    </div>
  );
}
