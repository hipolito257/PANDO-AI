"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { CompanyLogo } from "@/components/company/CompanyLogo";
import { WebsiteLink } from "@/components/ui/WebsiteLink";
import {
  IconBarChart, IconLineChart, IconDiamond,
  IconSparkle, IconSearch, IconAlertTriangle,
} from "@/components/ui/Icons";
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
  website: string | null;
  description: string | null; revenueUsd: number | null;
  ebitdaUsd: number | null; revenueGrowth: number | null;
  ebitdaMargin: number | null; score: number; status: string;
};
type PublicComp = {
  id: string; ticker: string; name: string; sector: string | null;
  exchange: string | null; website: string | null; description: string | null;
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
type AIDesc = { reason: string; businessModel: string; similarity: string };
type CompSet = {
  id: string; name: string; tickers: string; notes: string | null;
  aiDescriptions: string | null;
  company: Company | null; comps: PublicComp[];
};
type AISuggestion = { ticker: string; name: string; exchange: string; website?: string; reason: string; businessModel: string; similarity: string };

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
  const [companySearch, setCompanySearch] = useState("");

  const [companies,   setCompanies]   = useState<Company[]>([]);
  const [compSet,     setCompSet]     = useState<CompSet | null>(null);
  const [loadingSet,  setLoadingSet]  = useState(false);
  const [refreshing,  setRefreshing]  = useState(false);
  const [refreshLog,  setRefreshLog]  = useState("");
  const [refreshErrors, setRefreshErrors] = useState<Record<string, string>>({});
  const [activeTab,   setActiveTab]   = useState<"datos"|"graficas"|"valuacion">("datos");
  const [showSearch,  setShowSearch]  = useState(false);
  const [showAI,      setShowAI]      = useState(false);
  const [mounted,     setMounted]     = useState(false);
  const [historyData, setHistoryData] = useState<Record<string, { date: string; indexed: number }[]>>({});
  const [loadingHist, setLoadingHist] = useState(false);
  const [editedCells, setEditedCells] = useState<Record<string, Set<keyof PublicComp>>>({});
  const [editedPrivate, setEditedPrivate] = useState<Set<keyof Company>>(new Set());

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    fetch("/api/companies?limit=200")
      .then(r => r.json())
      // Exclude exits (public/acquired/closed) and inactive — keep monitoring + pipeline
      .then(d => Array.isArray(d)
        ? setCompanies(d.filter((c: Company) => !["public","acquired","closed","inactive"].includes(c.status)))
        : setCompanies([]));
  }, []);

  const loadCompSet = useCallback(async (cid: string) => {
    setLoadingSet(true);
    setCompSet(null);
    setHistoryData({});
    setEditedCells({});
    const res = await fetch(`/api/comparables?companyId=${cid}`);
    const sets: CompSet[] = await res.json();
    setCompSet(sets[0] ?? null);
    setLoadingSet(false);
  }, []);

  const handleEditComp = useCallback((ticker: string, field: keyof PublicComp, value: number | null) => {
    setCompSet(prev => prev ? {
      ...prev,
      comps: prev.comps.map(c => c.ticker === ticker ? { ...c, [field]: value } : c),
    } : prev);
    setEditedCells(prev => ({
      ...prev,
      [ticker]: new Set([...(prev[ticker] ?? []), field]),
    }));
  }, []);

  const handleEditCompany = useCallback((field: keyof Company, value: number | null) => {
    setCompanies(prev => prev.map(c => c.id === selectedCompanyId ? { ...c, [field]: value } : c));
    setEditedPrivate(prev => new Set([...prev, field]));
  }, [selectedCompanyId]);

  useEffect(() => {
    if (selectedCompanyId) loadCompSet(selectedCompanyId);
    else { setCompSet(null); setLoadingSet(false); }
  }, [selectedCompanyId, loadCompSet]);

  const selectCompany = (id: string) => {
    setSelectedCompanyId(id);
    setActiveTab("datos");
    setEditedPrivate(new Set());
    setEditedCells({});
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
    const fail: {ticker:string;error?:string}[] = data.report?.filter((r: any) => !r.ok) ?? [];
    // Build ticker → error map for inline display in table
    const errMap: Record<string, string> = {};
    fail.forEach(f => { errMap[f.ticker] = f.error ?? "no data"; });
    setRefreshErrors(errMap);
    const failMsg = fail.length
      ? ` · ${fail.length} failed: ${fail.map(f => `${f.ticker}${f.error ? ` (${f.error})` : ""}`).join(", ")}`
      : "";
    setRefreshLog(`✓ ${ok} updated${failMsg}`);
    setRefreshing(false);
    setEditedCells({});
    setEditedPrivate(new Set());
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

  async function addTicker(ticker: string, name: string, exchange?: string, aiDesc?: AIDesc, website?: string | null) {
    if (tickers.includes(ticker)) return;

    // Step 1: ensure publicComp record exists (pass website so logo is available immediately)
    await fetch("/api/comparables/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, name, exchange, website: website ?? null }),
    });

    // Step 2: save tickers ONLY (critical — no aiDescriptions, so no migration dependency)
    let savedCompSetId = compSet?.id;
    if (compSet) {
      const r = await fetch("/api/comparables", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: compSet.id, tickers: [...tickers, ticker] }),
      });
      if (!r.ok) { console.error("PATCH tickers failed", await r.text()); return; }
    } else if (selectedCompanyId && selectedCompany) {
      const r = await fetch("/api/comparables", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${selectedCompany.name} — Comparables`,
          companyId: selectedCompanyId, tickers: [ticker],
        }),
      });
      if (!r.ok) { console.error("POST compSet failed", await r.text()); return; }
      const created = await r.json();
      savedCompSetId = created?.id;
    }

    // Step 3: save AI description separately (optional — silently skips if column missing)
    if (aiDesc && savedCompSetId) {
      const existingDescs: Record<string, AIDesc> = compSet?.aiDescriptions
        ? JSON.parse(compSet.aiDescriptions) : {};
      existingDescs[ticker] = aiDesc;
      fetch("/api/comparables", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: savedCompSetId, aiDescriptions: existingDescs }),
      }).catch(() => { /* non-critical */ });
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
                  {refreshing ? "Refreshing..." : "Refresh data"}
                </button>
              </>
            )}
          </div>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Company sidebar */}
        <aside className="w-[220px] shrink-0 border-r border-chalk bg-paper overflow-y-auto flex flex-col">
          {/* Search box */}
          <div className="p-2 border-b border-chalk">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="text"
                placeholder="Buscar empresa..."
                value={companySearch}
                onChange={e => setCompanySearch(e.target.value)}
                className="w-full pl-7 pr-2 py-1.5 text-[11px] bg-fog border border-chalk rounded-[7px] text-carbon placeholder:text-slate focus:outline-none focus:border-carbon"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {(() => {
              const q = companySearch.toLowerCase();
              const filtered = companies.filter(c => c.name.toLowerCase().includes(q) || (c.sector ?? "").toLowerCase().includes(q));
              const radar    = filtered.filter(c => c.status === "monitoring");
              const pipeline = filtered.filter(c => c.status === "pipeline");

              const renderGroup = (label: string, dot: string, items: Company[]) => items.length === 0 ? null : (
                <div key={label}>
                  <div className="flex items-center gap-1.5 px-3 py-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                    <span className="text-[9px] font-semibold text-slate uppercase tracking-wider">{label} ({items.length})</span>
                  </div>
                  <div className="space-y-0.5 px-2 mb-1">
                    {items.map(c => (
                      <button key={c.id} onClick={() => selectCompany(c.id)}
                        className={`w-full text-left px-2.5 py-2 rounded-[8px] transition-all
                          ${selectedCompanyId === c.id ? "bg-carbon text-white" : "hover:bg-fog text-carbon"}`}>
                        <div className="flex items-center gap-2">
                          <CompanyLogo name={c.name} website={c.website} size="sm" />
                          <div className="min-w-0">
                            <p className={`text-[12px] font-medium truncate ${selectedCompanyId === c.id ? "text-white" : "text-carbon"}`}>{c.name}</p>
                            <p className={`text-[10px] truncate ${selectedCompanyId === c.id ? "text-white/50" : "text-slate"}`}>{c.sector ?? c.country}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );

              return (
                <>
                  {renderGroup("Radar", "bg-orange", radar)}
                  {renderGroup("Pipeline", "bg-blue-500", pipeline)}
                  {filtered.length === 0 && (
                    <p className="text-[11px] text-slate text-center py-6 px-3">Sin resultados para "{companySearch}"</p>
                  )}
                </>
              );
            })()}
          </div>
        </aside>

        {/* Main area */}
        <main className="flex-1 overflow-y-auto bg-fog/20">
          {!selectedCompany ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <IconBarChart size={44} className="text-chalk mx-auto mb-3" />
                <p className="text-[15px] font-semibold text-carbon">Selecciona una empresa del radar</p>
                <p className="text-[12px] text-slate mt-1">Elige una empresa para ver su análisis de comparables públicos</p>
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-4 max-w-[1200px]">
              {/* Company header */}
              <div className="bg-paper rounded-[10px] border border-chalk p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <CompanyLogo name={selectedCompany.name} website={selectedCompany.website} size="lg" />
                  <div className="flex-1 min-w-[180px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-[16px] font-semibold text-carbon font-poly">{selectedCompany.name}</h2>
                      <span className="text-[10px] bg-orange/10 text-orange border border-orange/20 px-2 py-0.5 rounded-full font-medium">PRIVADA</span>
                      {selectedCompany.sector && <span className="text-[10px] bg-fog border border-chalk text-slate px-2 py-0.5 rounded-full">{selectedCompany.sector}</span>}
                      <WebsiteLink url={selectedCompany.website} />
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
                      className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium bg-carbon/5 border border-chalk rounded-[6px] hover:border-carbon transition-colors">
                      <IconSparkle size={11} />
                      IA Sugerir
                    </button>
                    <button onClick={() => setShowSearch(true)}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-carbon text-white rounded-[6px] hover:opacity-85 transition-opacity">
                      + Buscar ticker
                    </button>
                  </div>
                </div>
                {!hasData && tickers.length > 0 && (
                  <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-[6px] px-2.5 py-1 inline-flex items-center gap-1.5">
                    <IconAlertTriangle size={11} className="shrink-0" />
                    Sin datos de mercado — presiona "Actualizar datos" para jalar Yahoo Finance
                  </p>
                )}
              </div>

              {/* Empty peers state */}
              {tickers.length === 0 && !loadingSet && (
                <div className="bg-paper rounded-[12px] border border-chalk p-10 text-center">
                  <IconSearch size={40} className="text-chalk mx-auto mb-3" />
                  <p className="text-[14px] font-semibold text-carbon">Sin peers configurados</p>
                  <p className="text-[12px] text-slate mt-1 mb-4">
                    Agrega empresas públicas comparables para generar el análisis de valuación
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button onClick={() => setShowAI(true)}
                      className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium bg-carbon text-white rounded-btn hover:opacity-85">
                      <IconSparkle size={12} />
                      Sugerir con IA
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
                    {([
                      { key: "datos"    as const, Icon: IconBarChart,   label: "Datos" },
                      { key: "graficas" as const, Icon: IconLineChart,  label: "Gráficas" },
                      { key: "valuacion"as const, Icon: IconDiamond,    label: "Valuación" },
                    ]).map(({ key, Icon, label }) => (
                      <button key={key} onClick={() => setActiveTab(key)}
                        className={`px-4 py-1.5 text-[12px] font-medium rounded-[7px] transition-all flex items-center gap-1.5
                          ${activeTab === key ? "bg-carbon text-white shadow-sm" : "text-slate hover:text-carbon"}`}>
                        <Icon size={12} />
                        {label}
                      </button>
                    ))}
                  </div>

                  {activeTab === "datos" && (
                    <>
                      <CompsOverview comps={comps} company={selectedCompany} compSet={compSet} />
                      <MetricsTable comps={comps} company={selectedCompany} refreshErrors={refreshErrors}
                        editedCells={editedCells} onEditComp={handleEditComp}
                        editedPrivate={editedPrivate} onEditCompany={handleEditCompany} />
                    </>
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
// COMPS OVERVIEW
// ══════════════════════════════════════════════════════════════════════════════
function CompsOverview({ comps, company, compSet }: { comps: PublicComp[]; company: Company; compSet: CompSet | null }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (ticker: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(ticker)) next.delete(ticker); else next.add(ticker);
    return next;
  });

  const aiDescs: Record<string, AIDesc> = compSet?.aiDescriptions
    ? JSON.parse(compSet.aiDescriptions) : {};
  const hasDescriptions = comps.some(c => aiDescs[c.ticker] || c.description);

  return (
    <div className="bg-paper rounded-[10px] border border-chalk overflow-hidden">
      <div className="px-4 py-3 border-b border-chalk">
        <p className="text-[13px] font-semibold text-carbon">Overview de comparables</p>
        <p className="text-[11px] text-slate">Modelo de negocio y perfil de cada empresa del set</p>
      </div>

      {/* Target private company */}
      <div className="px-4 py-3 border-b border-chalk bg-orange/5">
        <div className="flex items-start gap-3">
          <CompanyLogo name={company.name} website={company.website} size="md" className="mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[13px] font-semibold text-carbon">{company.name}</span>
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-orange/15 text-orange border border-orange/25">TARGET PRIVADA</span>
              {company.sector && <span className="text-[9px] text-slate bg-fog border border-chalk px-1.5 py-0.5 rounded-full">{company.sector}</span>}
              {company.country && <span className="text-[9px] text-slate">{company.country}</span>}
            </div>
            {company.description
              ? <p className="text-[11px] text-graphite leading-relaxed">{company.description}</p>
              : <p className="text-[11px] text-slate italic">Sin descripción — agrégala en el Radar</p>}
            <div className="flex gap-4 mt-2">
              {company.revenueUsd != null && <span className="text-[10px] text-slate">Revenue: <span className="font-semibold text-carbon">{fmtB(company.revenueUsd)}</span></span>}
              {company.stage && <span className="text-[10px] text-slate">Etapa: <span className="font-semibold text-carbon">{company.stage}</span></span>}
            </div>
          </div>
        </div>
      </div>

      {/* Public comps */}
      <div className="divide-y divide-chalk">
        {comps.map((c, i) => {
          const isExp = expanded.has(c.ticker);
          const ai = aiDescs[c.ticker];
          const TRUNCATE = 280;

          // Prefer AI-generated business model description; fall back to Yahoo Finance
          const mainDesc = ai?.businessModel || c.description || null;
          const isTruncatable = mainDesc && mainDesc.length > TRUNCATE;

          const simColor = ai?.similarity?.startsWith("Alta")
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : ai?.similarity?.startsWith("Media")
            ? "bg-amber-50 text-amber-700 border-amber-200"
            : "bg-fog text-slate border-chalk";

          return (
            <div key={c.ticker} className="px-4 py-3 hover:bg-fog/30 transition-colors">
              <div className="flex items-start gap-3">
                <CompanyLogo name={c.name} website={c.website} size="md" className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[13px] font-semibold text-carbon">{c.name}</span>
                    <a href={`https://finance.yahoo.com/quote/${c.ticker}`} target="_blank" rel="noopener noreferrer"
                      className="text-[9px] font-mono text-slate bg-fog border border-chalk px-1.5 py-0.5 rounded hover:text-orange transition-colors">
                      {c.ticker}
                    </a>
                    {c.exchange && <span className="text-[9px] text-slate">{c.exchange}</span>}
                    {c.sector && <span className="text-[9px] text-slate bg-fog border border-chalk px-1.5 py-0.5 rounded-full">{c.sector}</span>}
                    <WebsiteLink url={c.website} />
                  </div>

                  {/* Reason line (AI only) */}
                  {ai?.reason && (
                    <p className="text-[11px] font-medium text-carbon mb-1">{ai.reason}</p>
                  )}

                  {/* Main description */}
                  {mainDesc ? (
                    <div>
                      <p className="text-[11px] text-graphite leading-relaxed">
                        {isTruncatable && !isExp ? mainDesc.slice(0, TRUNCATE) + "…" : mainDesc}
                      </p>
                      {isTruncatable && (
                        <button onClick={() => toggle(c.ticker)}
                          className="mt-1 text-[10px] text-orange hover:text-orange/70 font-medium transition-colors">
                          {isExp ? "Ver menos ▲" : "Ver más ▼"}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate italic">
                      Sin descripción — agrega esta empresa desde "✨ IA Sugerir" para obtener una descripción contextual, o presiona "Actualizar datos"
                    </p>
                  )}

                  {/* Similarity badge (AI only) */}
                  {ai?.similarity && (
                    <span className={`mt-1.5 inline-block text-[9px] font-medium px-2 py-0.5 rounded-full border ${simColor}`}>
                      Similitud: {ai.similarity}
                    </span>
                  )}

                  {/* Key metrics */}
                  {c.lastRefreshed && (
                    <div className="flex gap-4 mt-2 flex-wrap">
                      {c.marketCapUsd != null && <span className="text-[10px] text-slate">Mkt Cap: <span className="font-semibold text-carbon">{fmtB(c.marketCapUsd)}</span></span>}
                      {c.revenueUsd   != null && <span className="text-[10px] text-slate">Revenue: <span className="font-semibold text-carbon">{fmtB(c.revenueUsd)}</span></span>}
                      {c.evRevenue    != null && <span className="text-[10px] text-slate">EV/Rev: <span className="font-semibold text-carbon">{c.evRevenue.toFixed(1)}x</span></span>}
                      {c.grossMargin  != null && <span className="text-[10px] text-slate">Mg. Bruto: <span className="font-semibold text-carbon">{fmtPct(c.grossMargin)}</span></span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!hasDescriptions && comps.length > 0 && (
        <div className="px-4 py-3 bg-amber-50 border-t border-amber-100">
          <p className="text-[10px] text-amber-700">
            ⚠️ Sin descripciones cargadas — presiona <strong>"Actualizar datos"</strong> en la barra superior para traer los perfiles de negocio desde Yahoo Finance.
          </p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// COLUMN DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════════
type ColKey = "marketCap"|"ev"|"revenue"|"growth"|"ebitda"|"grossMargin"|"operatingMargin"|"ebitdaMargin"|"netMargin"|"fcf"|"evRev"|"evEbitda"|"pe"|"ps"|"pb"|"roe"|"de"|"beta"|"r40";

const ALL_COLS: { key: ColKey; label: string; group: string }[] = [
  { key: "marketCap",       label: "Mkt Cap",        group: "Size" },
  { key: "ev",              label: "EV",              group: "Size" },
  { key: "revenue",         label: "Revenue",         group: "Size" },
  { key: "fcf",             label: "FCF",             group: "Size" },
  { key: "growth",          label: "Rev. Growth",     group: "Growth" },
  { key: "ebitda",          label: "EBITDA",          group: "Profitability" },
  { key: "grossMargin",     label: "Gross Margin",    group: "Margins" },
  { key: "operatingMargin", label: "Op. Margin",      group: "Margins" },
  { key: "ebitdaMargin",    label: "EBITDA Margin",   group: "Margins" },
  { key: "netMargin",       label: "Net Margin",      group: "Margins" },
  { key: "roe",             label: "ROE",             group: "Profitability" },
  { key: "evRev",           label: "EV/Rev",          group: "Multiples" },
  { key: "evEbitda",        label: "EV/EBITDA",       group: "Multiples" },
  { key: "pe",              label: "P/E",             group: "Multiples" },
  { key: "ps",              label: "P/S",             group: "Multiples" },
  { key: "pb",              label: "P/B",             group: "Multiples" },
  { key: "de",              label: "Debt/Equity",     group: "Balance" },
  { key: "beta",            label: "Beta",            group: "Market" },
  { key: "r40",             label: "Rule of 40",      group: "Health" },
];

const DEFAULT_COLS: ColKey[] = ["marketCap","ev","revenue","growth","ebitda","grossMargin","ebitdaMargin","evRev","evEbitda","pe","r40"];

// ══════════════════════════════════════════════════════════════════════════════
// METRICS TABLE
// ══════════════════════════════════════════════════════════════════════════════

// ColKey → Company (private) field mapping — only fields that exist in Company
const COL_TO_COMPANY: Partial<Record<ColKey, keyof Company>> = {
  revenue: "revenueUsd", growth: "revenueGrowth",
  ebitda: "ebitdaUsd",   ebitdaMargin: "ebitdaMargin",
};
const COMPANY_DECIMAL_FIELDS = new Set<keyof Company>(["revenueGrowth", "ebitdaMargin"]);

// ColKey → PublicComp field mapping (r40 is computed, excluded)
const COL_TO_FIELD: Partial<Record<ColKey, keyof PublicComp>> = {
  marketCap: "marketCapUsd",   ev: "evUsd",       revenue: "revenueUsd",
  fcf: "fcfUsd",               growth: "revenueGrowth",   ebitda: "ebitdaUsd",
  grossMargin: "grossMargin",  operatingMargin: "operatingMargin",
  ebitdaMargin: "ebitdaMargin", netMargin: "netMargin",   roe: "roe",
  evRev: "evRevenue",          evEbitda: "evEbitda",      pe: "peRatio",
  ps: "psRatio",               pb: "pbRatio",             de: "debtToEquity",
  beta: "beta",
};
// Fields stored as decimals (0.75 = 75%) — show as percentage in edit input
const DECIMAL_FIELDS = new Set<keyof PublicComp>(["revenueGrowth","grossMargin","operatingMargin","ebitdaMargin","netMargin","roe"]);

function editDisplayVal(comp: PublicComp, colKey: ColKey): string {
  const field = COL_TO_FIELD[colKey];
  if (!field) return "";
  const v = comp[field] as number | null;
  if (v == null) return "";
  return DECIMAL_FIELDS.has(field) ? (v * 100).toFixed(2) : v.toFixed(2);
}
function parseEditInput(colKey: ColKey, input: string): number | null {
  const field = COL_TO_FIELD[colKey];
  if (!field) return null;
  const n = parseFloat(input.replace(/[^0-9.\-]/g, ""));
  if (isNaN(n)) return null;
  return DECIMAL_FIELDS.has(field) ? n / 100 : n;
}

function MetricsTable({
  comps, company, refreshErrors = {},
  editedCells = {}, onEditComp,
  editedPrivate = new Set(), onEditCompany,
}: {
  comps: PublicComp[]; company: Company;
  refreshErrors?: Record<string, string>;
  editedCells?: Record<string, Set<keyof PublicComp>>;
  onEditComp?: (ticker: string, field: keyof PublicComp, value: number | null) => void;
  editedPrivate?: Set<keyof Company>;
  onEditCompany?: (field: keyof Company, value: number | null) => void;
}) {
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(new Set(DEFAULT_COLS));
  const [showColPicker, setShowColPicker] = useState(false);
  const [editCell, setEditCell] = useState<{ ticker: string; key: ColKey } | null>(null);
  const [editInputVal, setEditInputVal] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set(ALL_COLS.map(c => c.group)));
  const [selectedCharts, setSelectedCharts] = useState<Set<string>>(new Set());
  const hasData = comps.some(c => c.lastRefreshed);
  const cols = ALL_COLS.filter(c => visibleCols.has(c.key));

  function startEdit(comp: PublicComp, key: ColKey) {
    if (!COL_TO_FIELD[key] || !onEditComp) return;
    setEditCell({ ticker: comp.ticker, key });
    setEditInputVal(editDisplayVal(comp, key));
  }
  function startPrivateEdit(key: ColKey) {
    const field = COL_TO_COMPANY[key];
    if (!field || !onEditCompany) return;
    const v = company[field] as number | null;
    const display = v == null ? "" : COMPANY_DECIMAL_FIELDS.has(field) ? (v * 100).toFixed(2) : v.toFixed(2);
    setEditCell({ ticker: "__private__", key });
    setEditInputVal(display);
  }
  function commitEdit() {
    if (!editCell) return;
    if (editCell.ticker === "__private__") {
      const field = COL_TO_COMPANY[editCell.key];
      if (!field || !onEditCompany) { setEditCell(null); return; }
      const n = parseFloat(editInputVal.replace(/[^0-9.\-]/g, ""));
      const value = isNaN(n) ? null : COMPANY_DECIMAL_FIELDS.has(field) ? n / 100 : n;
      onEditCompany(field, value);
    } else {
      if (!onEditComp) { setEditCell(null); return; }
      const field = COL_TO_FIELD[editCell.key];
      if (!field) { setEditCell(null); return; }
      onEditComp(editCell.ticker, field, parseEditInput(editCell.key, editInputVal));
    }
    setEditCell(null);
  }

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

  // ── Raw string values for CSV export ──────────────────────────────────────
  function rawCompVal(c: PublicComp, key: ColKey): string {
    switch (key) {
      case "marketCap":       return fmtB(c.marketCapUsd);
      case "ev":              return fmtB(c.evUsd);
      case "revenue":         return fmtB(c.revenueUsd);
      case "fcf":             return fmtB(c.fcfUsd);
      case "growth":          return c.revenueGrowth != null ? fmtGrowth(c.revenueGrowth) : "—";
      case "ebitda":          return fmtB(c.ebitdaUsd);
      case "grossMargin":     return fmtPct(c.grossMargin);
      case "operatingMargin": return fmtPct(c.operatingMargin);
      case "ebitdaMargin":    return fmtPct(c.ebitdaMargin);
      case "netMargin":       return fmtPct(c.netMargin);
      case "roe":             return fmtPct(c.roe);
      case "evRev":    return c.evRevenue  != null ? `${c.evRevenue.toFixed(1)}x`  : "—";
      case "evEbitda": return c.evEbitda   != null ? `${c.evEbitda.toFixed(1)}x`   : "—";
      case "pe":       return c.peRatio    != null ? `${c.peRatio.toFixed(1)}x`    : "—";
      case "ps":       return c.psRatio    != null ? `${c.psRatio.toFixed(1)}x`    : "—";
      case "pb":       return c.pbRatio    != null ? `${c.pbRatio.toFixed(1)}x`    : "—";
      case "de":       return c.debtToEquity != null ? c.debtToEquity.toFixed(2)   : "—";
      case "beta":     return c.beta         != null ? c.beta.toFixed(2)           : "—";
      case "r40":      return r40(c.revenueGrowth, c.ebitdaMargin)?.toFixed(0) ?? "—";
    }
  }

  function rawPrivateVal(key: ColKey): string {
    switch (key) {
      case "revenue":      return fmtB(company.revenueUsd);
      case "growth":       return company.revenueGrowth != null ? fmtGrowth(company.revenueGrowth) : "—";
      case "ebitda":       return fmtB(company.ebitdaUsd);
      case "ebitdaMargin": return fmtPct(company.ebitdaMargin);
      case "r40":          return r40(company.revenueGrowth, company.ebitdaMargin)?.toFixed(0) ?? "—";
      default:             return "—";
    }
  }

  function rawMedianVal(key: ColKey): string {
    const ns = (arr: (number|null)[]) => arr.filter((x): x is number => x != null);
    switch (key) {
      case "marketCap":       return fmtB(median(ns(comps.map(c=>c.marketCapUsd))));
      case "ev":              return fmtB(median(ns(comps.map(c=>c.evUsd))));
      case "revenue":         return fmtB(median(ns(comps.map(c=>c.revenueUsd))));
      case "fcf":             return fmtB(median(ns(comps.map(c=>c.fcfUsd))));
      case "growth":          return fmtGrowth(median(ns(comps.map(c=>toGrowthPct(c.revenueGrowth)))));
      case "ebitda":          return fmtB(median(ns(comps.map(c=>c.ebitdaUsd))));
      case "grossMargin":     return fmtPct(median(ns(comps.map(c=>c.grossMargin))));
      case "operatingMargin": return fmtPct(median(ns(comps.map(c=>c.operatingMargin))));
      case "ebitdaMargin":    return fmtPct(median(ns(comps.map(c=>c.ebitdaMargin))));
      case "netMargin":       return fmtPct(median(ns(comps.map(c=>c.netMargin))));
      case "roe":             return fmtPct(median(ns(comps.map(c=>c.roe))));
      case "evRev":    { const a=ns(comps.map(c=>c.evRevenue)).filter(x=>x>0&&x<200); return a.length?`${median(a)!.toFixed(1)}x`:"—"; }
      case "evEbitda": { const a=ns(comps.map(c=>c.evEbitda)).filter(x=>x>0&&x<500); return a.length?`${median(a)!.toFixed(1)}x`:"—"; }
      case "pe":   { const a=ns(comps.map(c=>c.peRatio)).filter(x=>x>0&&x<200); return a.length?`${median(a)!.toFixed(1)}x`:"—"; }
      case "ps":   { const a=ns(comps.map(c=>c.psRatio)).filter(x=>x>0&&x<200); return a.length?`${median(a)!.toFixed(1)}x`:"—"; }
      case "pb":   { const a=ns(comps.map(c=>c.pbRatio)).filter(x=>x>0&&x<200); return a.length?`${median(a)!.toFixed(1)}x`:"—"; }
      case "de":   { const a=ns(comps.map(c=>c.debtToEquity)); return a.length?median(a)!.toFixed(2):"—"; }
      case "beta": { const a=ns(comps.map(c=>c.beta)); return a.length?median(a)!.toFixed(2):"—"; }
      case "r40":  { const a=ns(comps.map(c=>r40(c.revenueGrowth,c.ebitdaMargin))); return a.length?`${median(a)!.toFixed(0)}`:"—"; }
      default:     return "—";
    }
  }

  const [exporting, setExporting] = useState(false);

  async function doExport(exportCols: { key: ColKey; label: string }[], charts: string[]) {
    setExporting(true);
    try {
      const colLabels = exportCols.map(c => c.label);
      const headers = ["Company", "Ticker", "Tipo", ...colLabels];
      const rows = [
        { cells: [company.name, "—", "PRIVADA (Target)", ...exportCols.map(c => rawPrivateVal(c.key))], type: "private" as const },
        ...comps.map(comp => ({
          cells: [comp.name, comp.ticker, `Público (${comp.exchange ?? ""})`, ...exportCols.map(c => rawCompVal(comp, c.key))],
          type: "public" as const,
        })),
        ...(hasData ? [{ cells: ["Set Median", "—", "Mediana", ...exportCols.map(c => rawMedianVal(c.key))], type: "median" as const }] : []),
      ];
      const nativeCharts: NativeChartReq[] = [];
      if (charts.includes("revenue")) {
        nativeCharts.push({
          type: "column", title: "Revenue (USD M)", sheetName: "Revenue",
          categories: [company.name, ...comps.map(c => c.name)],
          values:     [company.revenueUsd, ...comps.map(c => c.revenueUsd)],
        });
      }
      if (charts.includes("growth")) {
        nativeCharts.push({
          type: "column", title: "Revenue Growth (%)", sheetName: "Growth",
          categories: [company.name, ...comps.map(c => c.name)],
          values: [
            company.revenueGrowth != null ? +(company.revenueGrowth * 100).toFixed(2) : null,
            ...comps.map(c => c.revenueGrowth != null ? +(c.revenueGrowth * 100).toFixed(2) : null),
          ],
        });
      }
      if (charts.includes("evrev")) {
        nativeCharts.push({
          type: "column", title: "EV/Revenue", sheetName: "EV Revenue",
          categories: comps.map(c => c.name),
          values:     comps.map(c => c.evRevenue),
        });
      }
      if (charts.includes("r40")) {
        nativeCharts.push({
          type: "column", title: "Rule of 40", sheetName: "Rule of 40",
          categories: comps.map(c => c.name),
          values: comps.map(c => {
            const g = c.revenueGrowth != null ? c.revenueGrowth * 100 : null;
            const m = c.ebitdaMargin  != null ? c.ebitdaMargin  * 100 : null;
            return g != null && m != null ? +(g + m).toFixed(2) : null;
          }),
        });
      }
      if (charts.includes("scatter")) {
        nativeCharts.push({
          type: "scatter", title: "Crecimiento vs EV/Revenue", sheetName: "Scatter",
          xLabel: "Revenue Growth (%)", yLabel: "EV/Revenue",
          points: comps
            .filter(c => c.revenueGrowth != null && c.evRevenue != null)
            .map(c => ({
              x: +(c.revenueGrowth! * 100).toFixed(2),
              y: +c.evRevenue!.toFixed(2),
              label: c.ticker,
            })),
        });
      }
      const res = await fetch("/api/comparables/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headers, rows, companyName: company.name, nativeCharts }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `comps_${company.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
      setShowExportModal(false);
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
          <p className="text-[11px] text-slate">{comps.length} public peers · Yahoo Finance data</p>
        </div>
        <div className="flex items-center gap-2">
          {!hasData && <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-[6px]">Sin datos — actualizar</span>}
          <button onClick={() => setShowExportModal(true)} disabled={exporting}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium border border-chalk rounded-[7px] hover:border-emerald-500 hover:text-emerald-700 bg-white transition-colors disabled:opacity-50">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <line x1="6" y1="1" x2="6" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <polyline points="3,5.5 6,8.5 9,5.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M1 9.5v1a.5.5 0 00.5.5h9a.5.5 0 00.5-.5v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Excel
          </button>
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
                    Restore defaults
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
              <th className="px-3 py-2.5 text-left font-semibold sticky left-0 bg-fog/40">Company</th>
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
                  <CompanyLogo name={company.name} website={company.website} size="sm" />
                  <div>
                    <p className="text-[12px] font-semibold text-carbon">{company.name}</p>
                    <div className="flex items-center gap-1.5">
                      <p className="text-[9px] text-orange font-medium">TARGET PRIVADA</p>
                      <WebsiteLink url={company.website} className="text-[9px]" />
                    </div>
                  </div>
                </div>
              </td>
              {cols.map(c => {
                const companyField = COL_TO_COMPANY[c.key];
                const isEditingPrivate = editCell?.ticker === "__private__" && editCell?.key === c.key;
                const isEditedPrivate = companyField ? editedPrivate.has(companyField) : false;
                return (
                  <td key={c.key} className={`px-3 py-2.5 text-right ${isMultiple(c.key) ? "bg-carbon/3" : isR40(c.key) ? "bg-blue-50/60" : ""}`}>
                    {isEditingPrivate ? (
                      <input
                        autoFocus
                        className="w-16 text-right text-[11px] border-b-2 border-orange bg-orange/10 outline-none px-1 py-0 rounded-sm font-mono"
                        value={editInputVal}
                        onChange={e => setEditInputVal(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditCell(null); }}
                      />
                    ) : (
                      <div
                        onClick={() => startPrivateEdit(c.key)}
                        className={companyField && onEditCompany ? "cursor-text inline-flex items-center gap-0.5 justify-end" : ""}
                        title={companyField && onEditCompany ? "Clic para editar" : undefined}
                      >
                        {privateVal(c.key)}
                        {isEditedPrivate && <span className="text-orange text-[7px] leading-none ml-0.5">●</span>}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
            {comps.map(comp => (
              <tr key={comp.ticker} className="hover:bg-fog/40 transition-colors">
                <td className="px-3 py-2.5 sticky left-0 bg-paper">
                  <div className="flex items-center gap-2">
                    <CompanyLogo name={comp.name} website={comp.website} size="sm" />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-[12px] font-medium text-carbon">{comp.name}</p>
                        {refreshErrors[comp.ticker] && (
                          <span className="text-[9px] text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded font-medium" title={refreshErrors[comp.ticker]}>
                            {refreshErrors[comp.ticker] === "ticker no encontrado" ? "not found" :
                             refreshErrors[comp.ticker] === "rate limit — intenta de nuevo" ? "rate limit" :
                             refreshErrors[comp.ticker] === "sin datos en Yahoo Finance" ? "no data" :
                             "error"}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <a href={`https://finance.yahoo.com/quote/${comp.ticker}`} target="_blank" rel="noopener noreferrer"
                          className="text-[9px] font-mono text-slate hover:text-orange">{comp.ticker} · {comp.exchange ?? ""}</a>
                        <WebsiteLink url={comp.website} className="text-[9px]" />
                      </div>
                    </div>
                  </div>
                </td>
                {cols.map(c => {
                  const field = COL_TO_FIELD[c.key];
                  const isEditing = editCell?.ticker === comp.ticker && editCell?.key === c.key;
                  const isEdited = field ? editedCells[comp.ticker]?.has(field) : false;
                  return (
                    <td key={c.key} className={`px-3 py-2.5 text-right ${isMultiple(c.key) ? "bg-carbon/3" : isR40(c.key) ? "bg-blue-50/60" : ""}`}>
                      {isEditing ? (
                        <input
                          autoFocus
                          className="w-16 text-right text-[11px] border-b-2 border-orange bg-orange/5 outline-none px-1 py-0 rounded-sm font-mono"
                          value={editInputVal}
                          onChange={e => setEditInputVal(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditCell(null); }}
                        />
                      ) : (
                        <div
                          onClick={() => startEdit(comp, c.key)}
                          className={field && onEditComp ? "cursor-text inline-flex items-center gap-0.5 justify-end" : ""}
                          title={field && onEditComp ? "Clic para editar" : undefined}
                        >
                          {compVal(comp, c.key)}
                          {isEdited && <span className="text-orange text-[7px] leading-none ml-0.5">●</span>}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {hasData && (
            <tfoot>
              <tr className="border-t-2 border-carbon/20 bg-fog/60 text-[11px] font-semibold">
                <td className="px-3 py-2.5 text-carbon sticky left-0 bg-fog/60">Set Median</td>
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
      <div className="px-4 py-2 border-t border-chalk bg-fog/20 flex items-center justify-between">
        <p className="text-[9px] text-slate">R40 = Rule of 40 (Revenue Growth % + EBITDA Margin %). Buena salud operacional si &gt;40. Datos: Yahoo Finance.</p>
        {onEditComp && <p className="text-[9px] text-slate/50">Clic en cualquier celda de comparable para editar · <span className="text-orange">●</span> = editado manualmente</p>}
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <ExportModal
          allCols={ALL_COLS}
          selectedGroups={selectedGroups}
          onToggleGroup={g => setSelectedGroups(prev => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; })}
          selectedCharts={selectedCharts}
          onToggleChart={k => setSelectedCharts(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; })}
          exporting={exporting}
          onClose={() => setShowExportModal(false)}
          onExport={() => {
            const exportCols = ALL_COLS.filter(c => visibleCols.has(c.key) && selectedGroups.has(c.group));
            doExport(exportCols.length ? exportCols : cols, [...selectedCharts]);
          }}
        />
      )}
    </div>
  );
}

// Native chart options for Excel export
const NATIVE_CHART_OPTIONS = [
  { key: "revenue", label: "Comparación de Revenue",    sheetName: "Revenue"    },
  { key: "growth",  label: "Revenue Growth %",          sheetName: "Growth"     },
  { key: "evrev",   label: "Múltiplo EV/Revenue",       sheetName: "EV Revenue" },
  { key: "r40",     label: "Rule of 40",                sheetName: "Rule of 40" },
  { key: "scatter", label: "Crecimiento vs EV/Revenue", sheetName: "Scatter"    },
] as const;

type NativeChartReq =
  | { type: "column"; title: string; sheetName: string; categories: (string|null)[]; values: (number|null)[] }
  | { type: "scatter"; title: string; sheetName: string; xLabel: string; yLabel: string; points: { x: number; y: number; label: string }[] };

function ExportModal({
  allCols, selectedGroups, onToggleGroup,
  selectedCharts, onToggleChart,
  exporting, onClose, onExport,
}: {
  allCols: typeof ALL_COLS;
  selectedGroups: Set<string>; onToggleGroup: (g: string) => void;
  selectedCharts: Set<string>; onToggleChart: (k: string) => void;
  exporting: boolean; onClose: () => void; onExport: () => void;
}) {
  const groups = [...new Set(allCols.map(c => c.group))];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-t-[18px] sm:rounded-[16px] shadow-2xl border border-chalk w-full sm:w-[460px] max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-chalk sticky top-0 bg-white rounded-t-[16px]">
          <div>
            <p className="text-[15px] font-semibold text-carbon">Exportar a Excel</p>
            <p className="text-[11px] text-slate mt-0.5">Elige qué incluir en el archivo</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-fog text-slate hover:text-carbon transition-colors">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Data groups */}
          <div>
            <p className="text-[11px] font-semibold text-slate uppercase tracking-wide mb-2.5">Datos a incluir</p>
            <div className="grid grid-cols-2 gap-2">
              {groups.map(g => {
                const gcols = allCols.filter(c => c.group === g);
                return (
                  <label key={g}
                    className={`flex items-start gap-2.5 p-2.5 border rounded-[10px] cursor-pointer transition-colors
                      ${selectedGroups.has(g) ? "border-carbon bg-carbon/3" : "border-chalk hover:border-carbon/30 hover:bg-fog/30"}`}>
                    <input type="checkbox" checked={selectedGroups.has(g)} onChange={() => onToggleGroup(g)}
                      className="mt-0.5 w-3.5 h-3.5 accent-carbon shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-carbon leading-tight">{g}</p>
                      <p className="text-[9px] text-slate mt-0.5 leading-tight truncate">{gcols.map(c => c.label).join(" · ")}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Native charts */}
          <div>
            <p className="text-[11px] font-semibold text-slate uppercase tracking-wide mb-2.5">Gráficas nativas de Excel</p>
            <p className="text-[10px] text-slate mb-2">Cada gráfica se crea con sus propios datos — puedes editarla directamente en Excel.</p>
            <div className="space-y-1.5">
              {NATIVE_CHART_OPTIONS.map(opt => (
                <label key={opt.key} className={`flex items-center gap-2.5 px-3 py-2 border rounded-[8px] cursor-pointer transition-colors
                  ${selectedCharts.has(opt.key) ? "border-carbon bg-carbon/3" : "border-chalk hover:border-carbon/30"}`}>
                  <input type="checkbox" checked={selectedCharts.has(opt.key)} onChange={() => onToggleChart(opt.key)}
                    className="w-3.5 h-3.5 accent-carbon" />
                  <span className="text-[12px] text-carbon">{opt.label}</span>
                  <span className="ml-auto text-[9px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">Excel</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2.5 px-5 py-4 border-t border-chalk sticky bottom-0 bg-white">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 text-[12px] font-medium border border-chalk rounded-[9px] text-slate hover:text-carbon hover:border-carbon/40 transition-colors">
            Cancelar
          </button>
          <button onClick={onExport} disabled={exporting || selectedGroups.size === 0}
            className="flex-1 px-4 py-2.5 text-[12px] font-semibold bg-carbon text-white rounded-[9px] hover:bg-graphite transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
            {exporting
              ? <><svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="10"/></svg>Generando…</>
              : <>
                  <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><line x1="6" y1="1" x2="6" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><polyline points="3,5.5 6,8.5 9,5.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M1 9.5v1a.5.5 0 00.5.5h9a.5.5 0 00.5-.5v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  Descargar Excel
                </>}
          </button>
        </div>
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
  comps, company, historyData, loadingHist,
}: {
  comps: PublicComp[]; company: Company;
  historyData: Record<string, { date: string; indexed: number }[]>;
  loadingHist: boolean;
}) {
  const [rankMetric, setRankMetric] = useState<string>("evRevenue");
  const hasData = comps.some(c => c.lastRefreshed);

  if (!hasData) {
    return (
      <div className="bg-paper rounded-[10px] border border-chalk p-10 text-center">
        <IconLineChart size={32} className="text-chalk mx-auto mb-3" />
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

  // ── Chart data prep ─────────────────────────────────────────────────────────
  const qMetrics = [
    { key: "evRevenue",     label: "EV / Revenue",   fmt: (v: number) => `${v.toFixed(1)}x`,
      peerVals: comps.map(c => c.evRevenue).filter((x): x is number => x != null && x > 0 && x < 200),
      targetVal: null as number | null },
    { key: "evEbitda",      label: "EV / EBITDA",    fmt: (v: number) => `${v.toFixed(1)}x`,
      peerVals: comps.map(c => c.evEbitda).filter((x): x is number => x != null && x > 0 && x < 500),
      targetVal: null as number | null },
    { key: "revenueGrowth", label: "Revenue Growth", fmt: (v: number) => `${v.toFixed(0)}%`,
      peerVals: comps.map(c => toGrowthPct(toNum(c.revenueGrowth))).filter((x): x is number => x != null && x > -200 && x < 500),
      targetVal: toGrowthPct(toNum(company.revenueGrowth)) },
    { key: "grossMargin",   label: "Gross Margin",   fmt: (v: number) => `${v.toFixed(0)}%`,
      peerVals: comps.map(c => toGrowthPct(toNum(c.grossMargin))).filter((x): x is number => x != null && x > -50 && x < 105),
      targetVal: null as number | null },
    { key: "ebitdaMargin",  label: "EBITDA Margin",  fmt: (v: number) => `${v.toFixed(0)}%`,
      peerVals: comps.map(c => toGrowthPct(toNum(c.ebitdaMargin))).filter((x): x is number => x != null && x > -200 && x < 105),
      targetVal: toGrowthPct(toNum(company.ebitdaMargin)) },
  ].filter(m => m.peerVals.length >= 2);

  const bubbleData = comps
    .filter(c => c.revenueGrowth != null && c.grossMargin != null && c.marketCapUsd != null)
    .map(c => ({
      x: toGrowthPct(toNum(c.revenueGrowth))!,
      y: toGrowthPct(toNum(c.grossMargin))!,
      size: c.marketCapUsd!,
      ticker: c.ticker,
      name: c.name,
    }));
  const bubbleMaxSize = bubbleData.length ? Math.max(...bubbleData.map(d => d.size)) : 1;

  const RANK_OPTS = [
    { key: "evRevenue",     label: "EV / Revenue",   fmt: (v: number) => `${v.toFixed(1)}x`,
      peerVal: (c: PublicComp) => c.evRevenue,                              targetVal: null as number | null },
    { key: "evEbitda",      label: "EV / EBITDA",    fmt: (v: number) => `${v.toFixed(1)}x`,
      peerVal: (c: PublicComp) => c.evEbitda,                               targetVal: null as number | null },
    { key: "revenueGrowth", label: "Revenue Growth", fmt: (v: number) => `${v.toFixed(0)}%`,
      peerVal: (c: PublicComp) => toGrowthPct(toNum(c.revenueGrowth)),      targetVal: toGrowthPct(toNum(company.revenueGrowth)) },
    { key: "grossMargin",   label: "Gross Margin",   fmt: (v: number) => `${v.toFixed(0)}%`,
      peerVal: (c: PublicComp) => toGrowthPct(toNum(c.grossMargin)),        targetVal: null as number | null },
    { key: "ebitdaMargin",  label: "EBITDA Margin",  fmt: (v: number) => `${v.toFixed(0)}%`,
      peerVal: (c: PublicComp) => toGrowthPct(toNum(c.ebitdaMargin)),       targetVal: toGrowthPct(toNum(company.ebitdaMargin)) },
  ];
  const rankOpt = RANK_OPTS.find(o => o.key === rankMetric) ?? RANK_OPTS[0];
  type RankItem = { name: string; shortName: string; value: number; isPrivate: boolean };
  const rankItems: RankItem[] = [
    ...comps
      .map(c => {
        const v = rankOpt.peerVal(c);
        return (v != null && isFinite(v))
          ? { name: c.name, shortName: c.ticker, value: v, isPrivate: false } as RankItem
          : null;
      })
      .filter((x): x is RankItem => x != null),
    ...(rankOpt.targetVal != null
      ? [{ name: company.name, shortName: company.name.split(" ")[0].slice(0, 8), value: rankOpt.targetVal, isPrivate: true }]
      : []),
  ].sort((a, b) => b.value - a.value);

  const BubbleTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div className="bg-white border border-chalk rounded-[8px] p-2.5 shadow-lg text-[11px]">
        <p className="font-bold text-carbon">{d.name}</p>
        <p className="text-[10px] font-mono text-slate">{d.ticker}</p>
        <p className="text-slate mt-1">Growth: <span className="font-medium text-carbon">{d.x.toFixed(0)}%</span></p>
        <p className="text-slate">Gross Margin: <span className="font-medium text-carbon">{d.y.toFixed(0)}%</span></p>
        <p className="text-slate">Mkt Cap: <span className="font-medium text-carbon">{fmtB(d.size)}</span></p>
      </div>
    );
  };

  const RankTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload as RankItem | undefined;
    return (
      <div className="bg-white border border-chalk rounded-[8px] p-2 shadow-lg text-[11px]">
        <p className="font-semibold text-carbon">{d?.name}</p>
        <p className="text-slate">{rankOpt.label}: <span className="font-bold text-carbon">{d != null ? rankOpt.fmt(d.value) : "—"}</span></p>
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

      {/* Quartile Positioning Strip */}
      {qMetrics.length >= 1 && (
        <div className="bg-paper rounded-[10px] border border-chalk p-5">
          <div className="mb-4">
            <p className="text-[13px] font-semibold text-carbon">Posicionamiento por cuartil</p>
            <p className="text-[11px] text-slate">
              Distribución de cada métrica en el set. Caja = IQR (P25–P75), línea = mediana.
              {qMetrics.some(m => m.targetVal != null) && (
                <span className="text-orange font-semibold ml-1">◆ = {company.name}</span>
              )}
            </p>
          </div>
          <div className="space-y-5">
            {qMetrics.map(m => {
              const sorted = [...m.peerVals].sort((a, b) => a - b);
              const vMin = sorted[0];
              const vMax = sorted[sorted.length - 1];
              const range = vMax - vMin;
              const pos = (v: number) => range === 0 ? 50 : Math.min(97, Math.max(3, ((v - vMin) / range) * 100));
              const vP25 = pct(sorted, 25)!;
              const vMed = pct(sorted, 50)!;
              const vP75 = pct(sorted, 75)!;
              return (
                <div key={m.key} className="flex items-center gap-3">
                  <span className="text-[11px] font-medium text-graphite w-[110px] shrink-0 text-right leading-tight">{m.label}</span>
                  <div className="flex-1 min-w-0">
                    <div className="relative h-7">
                      {/* Track */}
                      <div className="absolute left-0 right-0 top-[11px] h-[5px] bg-chalk rounded-full" />
                      {/* IQR box */}
                      <div
                        className="absolute top-[8px] h-[11px] bg-carbon/[0.12] rounded"
                        style={{ left: `${pos(vP25)}%`, right: `${100 - pos(vP75)}%` }}
                      />
                      {/* Median tick */}
                      <div
                        className="absolute top-[6px] w-[2px] h-[15px] bg-carbon/50 rounded-full -translate-x-1/2"
                        style={{ left: `${pos(vMed)}%` }}
                      />
                      {/* Peer dots */}
                      {m.peerVals.map((v, i) => (
                        <div
                          key={i}
                          className="absolute top-[10px] w-[9px] h-[9px] bg-carbon/30 rounded-full -translate-x-1/2 border border-white"
                          style={{ left: `${pos(v)}%` }}
                        />
                      ))}
                      {/* Target diamond */}
                      {m.targetVal != null && (
                        <div
                          className="absolute top-[4px] w-[19px] h-[19px] flex items-center justify-center -translate-x-1/2"
                          style={{ left: `${pos(m.targetVal)}%` }}
                        >
                          <div className="w-[11px] h-[11px] bg-orange rotate-45 rounded-[2px]" />
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between text-[9px] text-slate mt-0.5 px-0.5">
                      <span>{m.fmt(vMin)}</span>
                      <span>Med {m.fmt(vMed)}</span>
                      <span>{m.fmt(vMax)}</span>
                    </div>
                  </div>
                  <div className="w-[56px] shrink-0 text-right">
                    {m.targetVal != null
                      ? <span className="text-[11px] font-bold text-orange">{m.fmt(m.targetVal)}</span>
                      : <span className="text-[10px] text-slate/30 italic">privada</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 pt-3 border-t border-chalk flex flex-wrap gap-5 text-[9px] text-slate">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-5 h-2.5 bg-carbon/12 rounded border border-carbon/10" />IQR (P25–P75)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-[2px] h-3 bg-carbon/50 rounded" />Mediana
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 bg-carbon/30 rounded-full border border-white" />Comparable
            </span>
            {qMetrics.some(m => m.targetVal != null) && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 bg-orange rotate-45 rounded-[2px]" />{company.name}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Bubble: Growth vs Gross Margin vs Market Cap */}
      {bubbleData.length >= 2 && (
        <div className="bg-paper rounded-[10px] border border-chalk p-5">
          <div className="mb-3">
            <p className="text-[13px] font-semibold text-carbon">Crecimiento vs. Margen Bruto (burbuja = market cap)</p>
            <p className="text-[11px] text-slate">
              Cuadrante ideal: arriba a la derecha (alto margen + alto crecimiento). Tamaño = capitalización de mercado.
              {privateGrowthPct != null && (
                <span className="ml-1 text-orange font-semibold">
                  Línea naranja = {company.name} ({privateGrowthPct.toFixed(0)}% crecimiento).
                </span>
              )}
            </p>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart margin={{ top: 15, right: 40, bottom: 30, left: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
              <XAxis dataKey="x" type="number" domain={["auto", "auto"]}
                tickFormatter={(v: unknown) => `${(v as number).toFixed(0)}%`} tick={{ fontSize: 10 }}
                label={{ value: "Revenue Growth (%)", position: "insideBottom", offset: -10, style: { fontSize: 10, fill: "#8a8480" } }} />
              <YAxis dataKey="y" type="number" domain={[0, "auto"]}
                tickFormatter={(v: unknown) => `${(v as number).toFixed(0)}%`} tick={{ fontSize: 10 }}
                label={{ value: "Gross Margin (%)", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 10, fill: "#8a8480" } }} />
              <RTooltip content={<BubbleTooltip />} />
              {privateGrowthPct != null && (
                <ReferenceLine x={privateGrowthPct} stroke="#ea5c2b" strokeWidth={2} strokeDasharray="5 3"
                  label={{ value: company.name.split(" ")[0], position: "insideTopLeft", fill: "#ea5c2b", fontSize: 10, fontWeight: "bold" }} />
              )}
              <Scatter
                data={bubbleData}
                shape={(props: any) => {
                  const { cx, cy, payload } = props;
                  const r = 5 + Math.sqrt(payload.size / bubbleMaxSize) * 26;
                  return (
                    <g>
                      <circle cx={cx} cy={cy} r={r} fill="#202020" fillOpacity={0.55} />
                      <text x={cx} y={cy - r - 3} fontSize={8} fill="#8a8480" textAnchor="middle" fontFamily="monospace">{payload.ticker}</text>
                    </g>
                  );
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Horizontal Ranking */}
      {rankItems.length >= 2 && (
        <div className="bg-paper rounded-[10px] border border-chalk p-5">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] font-semibold text-carbon">Ranking de comparables</p>
              <p className="text-[11px] text-slate">
                Ordenado de mayor a menor. <span className="text-orange font-medium">Naranja = {company.name}</span>
              </p>
            </div>
            <select
              value={rankMetric}
              onChange={e => setRankMetric(e.target.value)}
              className="text-[11px] border border-chalk rounded-[7px] px-2 py-1.5 bg-white text-carbon focus:outline-none focus:border-carbon shrink-0 cursor-pointer"
            >
              {RANK_OPTS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(200, rankItems.length * 26 + 20)}>
            <BarChart data={rankItems} layout="vertical" margin={{ top: 0, right: 55, bottom: 0, left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
              <XAxis type="number" tickFormatter={(v: unknown) => rankOpt.fmt(v as number)} tick={{ fontSize: 9 }} domain={["auto", "auto"]} />
              <YAxis type="category" dataKey="shortName" tick={{ fontSize: 10 }} width={75} />
              <RTooltip content={<RankTooltip />} />
              <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                {rankItems.map((d, i) => (
                  <Cell key={i} fill={d.isPrivate ? "#ea5c2b" : "#202020"} opacity={d.isPrivate ? 1 : 0.6} />
                ))}
                <LabelList dataKey="value" position="right" formatter={(v: unknown) => rankOpt.fmt(v as number)} style={{ fontSize: 9, fill: "#8a8480" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
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
        <IconDiamond size={32} className="text-chalk mx-auto mb-3" />
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
                  <span className="font-semibold text-carbon">Median: {fmtB(m.mid)}</span>
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
              <CompanyLogo name={r.name} size="md" />
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
  onAdd: (ticker: string, name: string, exchange?: string, aiDesc?: AIDesc, website?: string | null) => Promise<void>;
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
    await onAdd(s.ticker, s.name, s.exchange, {
      reason: s.reason,
      businessModel: s.businessModel,
      similarity: s.similarity,
    }, s.website ?? null);
    setAdded(prev => new Set([...prev, s.ticker]));
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-carbon/40" onClick={onClose} />
      <div className="relative ml-auto w-[480px] h-full bg-paper shadow-2xl flex flex-col">
        <div className="p-4 border-b border-chalk flex items-center justify-between">
          <div>
            <h3 className="text-[14px] font-semibold text-carbon flex items-center gap-1.5">
                <IconSparkle size={13} className="text-orange" />
                Sugerencias de IA
              </h3>
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
              : <><IconSparkle size={13} />{fetched ? "Sugerir de nuevo" : "Sugerir comparables"}</>}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {!fetched && !loading && (
            <div className="text-center py-10">
              <IconSearch size={40} className="text-chalk mx-auto mb-3" />
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
              <p className="text-[13px] font-semibold text-amber-800">API key no configurada</p>
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

          {!loading && suggestions.map(s => {
            const simColor = s.similarity?.startsWith("Alta")
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : s.similarity?.startsWith("Media")
              ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-fog text-slate border-chalk";
            return (
              <div key={s.ticker} className="p-3 bg-fog rounded-[8px] border border-chalk hover:border-carbon/30 transition-colors space-y-2">
                {/* Header row */}
                <div className="flex items-start gap-2">
                  <CompanyLogo name={s.name} website={s.website} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[12px] font-semibold text-carbon">{s.name}</p>
                      <span className="text-[9px] font-mono text-slate bg-paper border border-chalk px-1.5 py-0.5 rounded">{s.ticker}</span>
                      <span className="text-[9px] text-slate">{s.exchange}</span>
                    </div>
                    <p className="text-[11px] text-carbon mt-0.5 leading-snug">{s.reason}</p>
                  </div>
                  <button onClick={() => handleAdd(s)} disabled={added.has(s.ticker)}
                    className={`px-2.5 py-1.5 text-[11px] font-medium rounded-[6px] transition-colors shrink-0
                      ${added.has(s.ticker)
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default"
                        : "bg-carbon text-white hover:opacity-85"}`}>
                    {added.has(s.ticker) ? "✓" : "+ Add"}
                  </button>
                </div>
                {/* Business model + similarity */}
                {(s.businessModel || s.similarity) && (
                  <div className="pl-[44px] space-y-1.5">
                    {s.businessModel && (
                      <p className="text-[10px] text-slate leading-relaxed">{s.businessModel}</p>
                    )}
                    {s.similarity && (
                      <span className={`inline-block text-[9px] font-medium px-2 py-0.5 rounded-full border ${simColor}`}>
                        Similitud: {s.similarity}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-chalk bg-fog/30">
          <p className="text-[9px] text-slate">Sugerencias generadas por Claude (Anthropic). Verifica cada empresa antes de incluirla.</p>
        </div>
      </div>
    </div>
  );
}
