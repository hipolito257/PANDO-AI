"use client";
import { useState, useRef } from "react";

type CBResult = {
  cbPermalink: string;
  name: string;
  description: string | null;
  website: string | null;
  country: string;
  city: string | null;
  sector: string | null;
  fundingStage: string | null;
  totalFunding: number | null;
  employees: number | null;
  alreadyImported: boolean;
};

function fmtM(n: number | null) {
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

export function CrunchbaseImport({
  onImported,
}: {
  onImported: () => void;
}) {
  const [open,        setOpen]       = useState(false);
  const [query,       setQuery]      = useState("");
  const [results,     setResults]    = useState<CBResult[]>([]);
  const [searching,   setSearching]  = useState(false);
  const [importing,   setImporting]  = useState<string | null>(null);
  const [imported,    setImported]   = useState<Set<string>>(new Set());
  const [error,       setError]      = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(q: string) {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    setError("");
    const res = await fetch(`/api/sync/crunchbase?q=${encodeURIComponent(q)}&limit=20`);
    const data = await res.json();
    if (data.error) {
      setError(data.error);
      setResults([]);
    } else {
      setResults(data);
    }
    setSearching(false);
  }

  function onQueryChange(v: string) {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(v), 600);
  }

  async function importCompany(r: CBResult) {
    setImporting(r.cbPermalink);
    const res = await fetch("/api/sync/crunchbase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:         r.name,
        description:  r.description,
        website:      r.website,
        country:      r.country,
        city:         r.city,
        sector:       r.sector,
        fundingStage: r.fundingStage,
        totalFunding: r.totalFunding,
        employees:    r.employees,
      }),
    });
    const data = await res.json();
    setImporting(null);
    if (data.imported || data.alreadyExists) {
      setImported(prev => new Set([...prev, r.cbPermalink]));
      setResults(prev => prev.map(x => x.cbPermalink === r.cbPermalink ? { ...x, alreadyImported: true } : x));
      onImported();
    }
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-fog border border-chalk rounded-[8px] text-graphite hover:border-carbon hover:text-carbon transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        Buscar en Crunchbase
      </button>

      {/* Drawer */}
      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-carbon/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative ml-auto w-full max-w-[640px] h-full bg-paper flex flex-col shadow-2xl">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-chalk flex-none">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-[#0369a1] flex items-center justify-center text-white text-[9px] font-bold">CB</div>
                  <h2 className="text-[15px] font-semibold text-carbon font-poly">Buscar en Crunchbase</h2>
                </div>
                <p className="text-[11px] text-slate mt-0.5">
                  Busca empresas y agrégalas al radar con un clic. Requiere API key configurada en Conectores.
                </p>
              </div>
              <button onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-full bg-fog flex items-center justify-center text-slate hover:text-carbon transition-colors">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {/* Search input */}
            <div className="px-6 py-4 border-b border-chalk flex-none">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  type="text"
                  value={query}
                  onChange={e => onQueryChange(e.target.value)}
                  placeholder='Busca por nombre, sector o ciudad. Ej: "fintech mexico", "Konfío", "SaaS Colombia"'
                  autoFocus
                  className="w-full pl-9 pr-4 py-2.5 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate focus:outline-none focus:border-carbon"
                />
                {searching && (
                  <svg className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                )}
              </div>
              {error && (
                <p className="mt-2 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-[6px] px-3 py-2 leading-snug">
                  {error.includes("not configured")
                    ? "⚠️ API key de Crunchbase no configurada. Ve a Conectores → Crunchbase → pega tu API key."
                    : error}
                </p>
              )}
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto">
              {!query && !searching && (
                <div className="flex flex-col items-center justify-center h-full text-slate gap-3 p-8">
                  <div className="w-12 h-12 rounded-full bg-fog flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                  </div>
                  <div className="text-center">
                    <p className="text-[13px] font-medium text-carbon">Escribe para buscar</p>
                    <p className="text-[11px] text-slate mt-1">Busca empresas en Crunchbase para agregarlas<br/>al radar de PANDO</p>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center mt-2">
                    {["fintech mexico","SaaS latam","logistics colombia","healthtech mexico"].map(s => (
                      <button key={s} onClick={() => { setQuery(s); onQueryChange(s); }}
                        className="text-[11px] px-3 py-1.5 bg-fog border border-chalk rounded-full text-graphite hover:border-carbon transition-colors">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {results.length > 0 && (
                <div className="divide-y divide-chalk">
                  {results.map(r => {
                    const isImported = r.alreadyImported || imported.has(r.cbPermalink);
                    const isImporting = importing === r.cbPermalink;
                    return (
                      <div key={r.cbPermalink} className={`px-6 py-4 flex items-start gap-4 hover:bg-fog/40 transition-colors ${isImported ? "opacity-60" : ""}`}>
                        {/* Avatar */}
                        <div className="w-9 h-9 rounded-[8px] bg-carbon flex items-center justify-center text-white text-[11px] font-bold flex-none">
                          {r.name.slice(0, 2).toUpperCase()}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13px] font-semibold text-carbon">{r.name}</span>
                            {r.sector && (
                              <span className="text-[10px] bg-fog border border-chalk rounded-full px-2 py-0.5 text-slate">{r.sector}</span>
                            )}
                            {r.fundingStage && (
                              <span className="text-[10px] bg-amber-50 border border-amber-200 text-amber-700 rounded-full px-2 py-0.5">{r.fundingStage}</span>
                            )}
                          </div>
                          {r.description && (
                            <p className="text-[11px] text-graphite mt-1 leading-snug line-clamp-2">{r.description}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate">
                            <span>{r.city ? `${r.city}, ` : ""}{r.country}</span>
                            {r.totalFunding && <span>Funding: <strong className="text-carbon">{fmtM(r.totalFunding)}</strong></span>}
                            {r.employees && <span>{r.employees.toLocaleString()} empleados</span>}
                            {r.website && (
                              <a href={r.website} target="_blank" rel="noopener noreferrer"
                                className="hover:text-orange transition-colors truncate max-w-[140px]">
                                {r.website.replace(/^https?:\/\//, "")}
                              </a>
                            )}
                          </div>
                        </div>

                        {/* Action */}
                        <div className="flex-none">
                          {isImported ? (
                            <span className="flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                              En radar
                            </span>
                          ) : (
                            <button
                              onClick={() => importCompany(r)}
                              disabled={isImporting}
                              className="px-3 py-1.5 text-[11px] font-medium bg-carbon text-white rounded-[6px] hover:opacity-85 disabled:opacity-50 transition-opacity flex items-center gap-1.5"
                            >
                              {isImporting ? (
                                <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                                </svg>
                              ) : (
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                                </svg>
                              )}
                              {isImporting ? "Importando..." : "Agregar al radar"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!searching && query && results.length === 0 && !error && (
                <div className="flex flex-col items-center justify-center h-48 text-slate gap-2">
                  <p className="text-[13px] font-medium">Sin resultados para "{query}"</p>
                  <p className="text-[11px]">Intenta con otro término o verifica tu API key</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-chalk flex items-center justify-between text-[10px] text-slate flex-none">
              <span>Powered by Crunchbase Basic API · {results.length > 0 ? `${results.length} resultados` : "sin resultados"}</span>
              <a href="https://crunchbase.com/settings/api-key" target="_blank" rel="noopener noreferrer"
                className="hover:text-carbon transition-colors">
                Obtener API key gratuita →
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
