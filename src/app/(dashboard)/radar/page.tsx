"use client";
import { useState, useEffect, useCallback } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card } from "@/components/ui/Card";
import { SignalBadge, StatusBadge, ScoreBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spark } from "@/components/charts/Spark";
import { fmtM } from "@/lib/utils";
import Link from "next/link";
import type { SignalType } from "@/types";
import { CompanyModal } from "@/components/company/CompanyModal";
import { CrunchbaseImport } from "@/components/radar/CrunchbaseImport";

const SECTORS = ["Fintech", "Software", "SaaS", "Logistics", "Healthcare", "Consumer", "Retail", "Mobility"];
const COUNTRIES = ["México", "Colombia", "Chile", "Perú", "Brasil"];
const STAGES = [
  { value: "seed", label: "Seed" },
  { value: "series-a", label: "Serie A" },
  { value: "series-b", label: "Serie B" },
  { value: "growth", label: "Growth" },
  { value: "mature", label: "Maduro" },
];

type Company = {
  id: string; name: string; slug: string; sector: string | null; country: string;
  stage: string | null; revenueUsd: number | null; revenueGrowth: number | null;
  ebitdaMargin: number | null; employees: number | null; score: number; status: string;
  createdBy: string | null; updatedBy: string | null;
  signals: { id: string; type: string; severity: string; title: string }[];
  tags: { tag: string }[];
};

const EXIT_STATUSES = ["public", "acquired", "closed"];

export default function RadarPage() {
  const [companies, setCompanies]         = useState<Company[]>([]);
  const [pipelineCompanies, setPipeline]  = useState<Company[]>([]);
  const [exitedCompanies, setExited]      = useState<Company[]>([]);
  const [mandates, setMandates]           = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading]             = useState(true);
  const [activeTab, setActiveTab]         = useState<"radar"|"pipeline"|"salidas"|"scan">("radar");

  const [q, setQ]             = useState("");
  const [sector, setSector]   = useState("");
  const [country, setCountry] = useState("");
  const [stage, setStage]     = useState("");
  const [mandateId, setMandateId] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editCompany, setEditCompany] = useState<Company | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    // Main radar: exclude pipeline and exited
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sector) params.set("sector", sector);
    if (country) params.set("country", country);
    if (stage) params.set("stage", stage);
    if (mandateId) params.set("mandate", mandateId);
    const [main, exited] = await Promise.all([
      fetch(`/api/companies?${params}`).then(r => r.json()),
      fetch(`/api/companies?${new URLSearchParams({ ...Object.fromEntries(params), limit: "200" })}`).then(r => r.json()).catch(() => []),
    ]);
    const mainData = Array.isArray(main) ? main : (main.companies ?? []);
    // Radar tab: all active companies (monitoring + pipeline). Exits go to Salidas.
    setCompanies(mainData.filter((c: Company) => !EXIT_STATUSES.includes(c.status) && c.status !== "inactive"));
    // Pipeline tab: only pipeline-status companies (for management actions)
    setPipeline(mainData.filter((c: Company) => c.status === "pipeline"));
    // Salidas tab: exit statuses
    setExited(mainData.filter((c: Company) => EXIT_STATUSES.includes(c.status)));
    setLoading(false);
  }, [q, sector, country, stage, mandateId]);

  const load = loadAll;

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { fetch("/api/mandatos").then(r => r.json()).then(setMandates); }, []);

  // Radar → Pipeline: el equipo decide seguir activamente esta empresa
  async function moveToPipeline(id: string) {
    await fetch(`/api/companies`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "pipeline" }) });
    loadAll();
  }

  // Pipeline → Radar: regresa a monitoreo si se decide no seguir
  async function moveToRadar(id: string) {
    await fetch(`/api/companies`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "monitoring" }) });
    loadAll();
  }

  // Archivar: quitar del radar o pipeline
  async function archiveCompany(id: string, context: "radar" | "pipeline") {
    const msg = context === "pipeline"
      ? "¿Archivar esta empresa? Saldrá del pipeline."
      : "¿Quitar esta empresa del radar?";
    if (!confirm(msg)) return;
    await fetch(`/api/companies/${id}`, { method: "DELETE" }).catch(() =>
      fetch(`/api/companies`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "inactive" }) })
    );
    loadAll();
  }


  const selectClass = "px-3 py-1.5 text-[12px] bg-paper border border-chalk rounded-[8px] text-carbon focus:outline-none focus:border-carbon";

  return (
    <div>
      <Topbar
        title="Radar"
        subtitle={`${companies.length} en radar · ${pipelineCompanies.length} en pipeline activo`}
        actions={
          <div className="flex items-center gap-2">
            <CrunchbaseImport onImported={load} />
            <Button variant="fill" size="sm" onClick={() => setShowAdd(true)}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><line x1="5" y1="1" x2="5" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              Agregar empresa
            </Button>
          </div>
        }
      />

      <div className="p-6 space-y-4">

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-paper border border-chalk rounded-[10px] p-1 w-fit">
          {([
            { key: "radar",    label: `📡 Radar (${companies.length})` },
            { key: "pipeline", label: `🔍 Pipeline${pipelineCompanies.length > 0 ? ` (${pipelineCompanies.length})` : ""}` },
            { key: "salidas",  label: `🏁 Salidas${exitedCompanies.length > 0 ? ` (${exitedCompanies.length})` : ""}` },
            { key: "scan",     label: "📄 Scan" },
          ] as const).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-1.5 text-[12px] font-medium rounded-[7px] transition-all ${
                activeTab === tab.key ? "bg-carbon text-white shadow-sm" : "text-slate hover:text-carbon"
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── RADAR tab ── */}
        {activeTab === "radar" && (
        <>
        {/* Filters */}
        <Card padding="sm">
          <div className="flex flex-wrap items-center gap-2">
            <input type="text" placeholder="Buscar empresa..." value={q} onChange={(e) => setQ(e.target.value)}
              className="px-3 py-1.5 text-[12px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate focus:outline-none focus:border-carbon w-48" />
            <select value={mandateId} onChange={(e) => setMandateId(e.target.value)} className={selectClass}>
              <option value="">Todos los mandatos</option>
              {mandates.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select value={sector} onChange={(e) => setSector(e.target.value)} className={selectClass}>
              <option value="">Todos los sectores</option>
              {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={selectClass}>
              <option value="">Todos los países</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={selectClass}>
              <option value="">Todas las etapas</option>
              {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {(q || sector || country || stage || mandateId) && (
              <Button variant="ghost" size="sm" onClick={() => { setQ(""); setSector(""); setCountry(""); setStage(""); setMandateId(""); }}>
                Limpiar filtros
              </Button>
            )}
          </div>
        </Card>

        {/* Company modal — add or edit */}
        <CompanyModal
          open={showAdd || !!editCompany}
          initial={editCompany ?? undefined}
          onClose={() => { setShowAdd(false); setEditCompany(null); }}
          onSaved={() => { setShowAdd(false); setEditCompany(null); load(); }}
        />

        {/* Main radar table */}
        <Card padding="none">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-slate text-[13px]">Cargando...</div>
          ) : companies.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate">
              <p className="text-[14px] font-medium">Sin resultados</p>
              <p className="text-[12px]">Ajusta los filtros o agrega una empresa</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-[10px] text-slate uppercase tracking-wide border-b border-chalk bg-fog/50">
                    <th className="px-5 py-3 text-left font-medium">Empresa</th>
                    <th className="px-3 py-3 text-left font-medium">Sector / País</th>
                    <th className="px-3 py-3 text-right font-medium">Revenue</th>
                    <th className="px-3 py-3 text-right font-medium">Crec.</th>
                    <th className="px-3 py-3 text-right font-medium">EBITDA%</th>
                    <th className="px-3 py-3 text-right font-medium">Empleados</th>
                    <th className="px-3 py-3 text-left font-medium">Estado</th>
                    <th className="px-3 py-3 text-right font-medium">Score</th>
                    <th className="px-3 py-3 text-left font-medium">Top señal</th>
                    <th className="px-3 py-3 text-center font-medium">Trend</th>
                    <th className="px-3 py-3 text-center font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-chalk">
                  {companies.map((c) => {
                    const topSig = c.signals[0];
                    return (
                      <tr key={c.id} className="hover:bg-fog/40 transition-colors group">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <Link href={`/empresa/${c.slug}`} className="font-semibold text-[13px] text-carbon hover:text-orange transition-colors">
                              {c.name}
                            </Link>
                            {c.createdBy && <span className="text-[9px] text-slate ml-1">por {c.createdBy}</span>}
                            <button onClick={() => setEditCompany(c as any)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-slate hover:text-carbon" title="Editar empresa">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>
                          </div>
                          <div className="flex gap-1 mt-1">
                            {[...new Set(c.tags.map(t => t.tag))].slice(0, 2).map((tag) => (
                              <span key={tag} className="text-[9px] bg-fog border border-chalk rounded-full px-1.5 py-0.5 text-slate">{tag}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="text-[12px] text-graphite">{c.sector ?? "—"}</div>
                          <div className="text-[10px] text-slate">{c.country}</div>
                        </td>
                        <td className="px-3 py-3 text-[12px] text-carbon text-right font-medium">{fmtM(c.revenueUsd)}</td>
                        <td className="px-3 py-3 text-[12px] text-right">
                          {c.revenueGrowth != null ? (
                            <span className={c.revenueGrowth >= 0 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>
                              {c.revenueGrowth > 0 ? "+" : ""}{c.revenueGrowth}%
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-3 text-[12px] text-right">
                          {c.ebitdaMargin != null ? (
                            <span className={c.ebitdaMargin >= 0 ? "text-graphite" : "text-red-500"}>
                              {c.ebitdaMargin > 0 ? "+" : ""}{c.ebitdaMargin}%
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-3 text-[12px] text-graphite text-right">
                          {c.employees ? c.employees.toLocaleString("es-MX") : "—"}
                        </td>
                        <td className="px-3 py-3"><StatusBadge status={c.status} /></td>
                        <td className="px-3 py-3 text-right"><ScoreBadge score={c.score} /></td>
                        <td className="px-3 py-3">
                          {topSig ? <SignalBadge type={topSig.type as SignalType} severity={topSig.severity} /> : <span className="text-[11px] text-slate">—</span>}
                        </td>
                        <td className="px-3 py-3 flex justify-center">
                          <Spark values={[50, 55, 58, 62, 65, 68, 70, c.score]} width={56} height={20} color={c.score >= 85 ? "#059669" : "#ff682c"} />
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => moveToPipeline(c.id)}
                              title="Mover a Pipeline"
                              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-orange text-white rounded-[6px] hover:bg-orange/90 transition-colors whitespace-nowrap"
                            >
                              Pipeline →
                            </button>
                            <button
                              onClick={() => archiveCompany(c.id, "radar")}
                              title="Quitar del radar"
                              className="p-1 text-slate hover:text-red-500 transition-colors"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        </>
        )}

        {/* ── PIPELINE tab ── */}
        {activeTab === "pipeline" && (
          <Card padding="none">
            <div className="px-5 py-3 border-b border-chalk bg-fog/30 flex items-center justify-between">
              <div>
                <p className="text-[13px] font-semibold text-carbon">Pipeline activo</p>
                <p className="text-[11px] text-slate">Empresas en evaluación activa · Promovidas desde el Radar por el equipo</p>
              </div>
            </div>
            {pipelineCompanies.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate">
                <p className="text-[32px] mb-2">🎯</p>
                <p className="text-[14px] font-medium text-carbon">Pipeline vacío</p>
                <p className="text-[12px] mt-1 text-center max-w-[280px]">
                  Cuando una empresa del Radar te interese, dale clic en <strong className="text-carbon">Pipeline →</strong> para moverla aquí
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] text-slate uppercase tracking-wide border-b border-chalk bg-fog/50">
                      <th className="px-5 py-3 text-left font-medium">Empresa</th>
                      <th className="px-3 py-3 text-left font-medium">Sector / País</th>
                      <th className="px-3 py-3 text-left font-medium">Descripción</th>
                      <th className="px-3 py-3 text-left font-medium">Etapa / Fondeo</th>
                      <th className="px-3 py-3 text-right font-medium">Score</th>
                      <th className="px-3 py-3 text-center font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-chalk">
                    {pipelineCompanies.map((c) => (
                      <tr key={c.id} className="hover:bg-fog/30 transition-colors">
                        <td className="px-5 py-3">
                          <Link href={`/empresa/${c.slug}`} className="text-[13px] font-semibold text-carbon hover:text-orange transition-colors">
                            {c.name}
                          </Link>
                          {c.createdBy && <p className="text-[9px] text-slate mt-0.5">{c.createdBy}</p>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="text-[12px] text-graphite">{c.sector ?? "—"}</div>
                          <div className="text-[10px] text-slate">{c.country}</div>
                        </td>
                        <td className="px-3 py-3 max-w-[280px]">
                          <p className="text-[11px] text-graphite line-clamp-2">{(c as any).description ?? "—"}</p>
                        </td>
                        <td className="px-3 py-3">
                          <p className="text-[12px] text-carbon">{(c as any).fundingStage ?? "—"}</p>
                          {(c as any).totalFunding && <p className="text-[10px] text-slate">${(c as any).totalFunding}M</p>}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <ScoreBadge score={c.score} />
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <button onClick={() => moveToRadar(c.id)}
                              className="px-2.5 py-1 text-[11px] font-medium border border-chalk text-graphite rounded-[6px] hover:border-carbon hover:text-carbon transition-colors whitespace-nowrap">
                              ← Radar
                            </button>
                            <button onClick={() => archiveCompany(c.id, "pipeline")}
                              className="px-2.5 py-1 text-[11px] font-medium border border-chalk text-slate rounded-[6px] hover:border-red-300 hover:text-red-500 transition-colors">
                              Archivar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* ── SALIDAS tab ── */}
        {activeTab === "salidas" && (
          <Card padding="none">
            <div className="px-5 py-3 border-b border-chalk bg-fog/30">
              <p className="text-[13px] font-semibold text-carbon">Salidas detectadas</p>
              <p className="text-[11px] text-slate">Empresas que salieron a bolsa, fueron adquiridas o cerraron · Detectadas automáticamente por noticias</p>
            </div>
            {exitedCompanies.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate">
                <p className="text-[32px] mb-2">🏁</p>
                <p className="text-[14px] font-medium text-carbon">Sin salidas detectadas aún</p>
                <p className="text-[12px] mt-1">Aparecerán aquí cuando el sistema detecte un IPO, adquisición o cierre</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] text-slate uppercase tracking-wide border-b border-chalk bg-fog/50">
                      <th className="px-5 py-3 text-left font-medium">Empresa</th>
                      <th className="px-3 py-3 text-left font-medium">Sector / País</th>
                      <th className="px-3 py-3 text-left font-medium">Tipo de salida</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-chalk">
                    {exitedCompanies.map((c) => (
                      <tr key={c.id} className="hover:bg-fog/30 transition-colors">
                        <td className="px-5 py-3">
                          <p className="text-[13px] font-semibold text-carbon">{c.name}</p>
                        </td>
                        <td className="px-3 py-3">
                          <div className="text-[12px] text-graphite">{c.sector ?? "—"}</div>
                          <div className="text-[10px] text-slate">{c.country}</div>
                        </td>
                        <td className="px-3 py-3"><StatusBadge status={c.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* ── SCAN tab ── */}
        {activeTab === "scan" && <ScanTab onCompaniesAdded={loadAll} />}

      </div>
    </div>
  );
}

// ── SCAN TAB ──────────────────────────────────────────────────────────────────
type ScanResult = {
  summary: string;
  keyInsights: string[];
  companies: { name: string; sector: string; country: string; description: string; fundingStage?: string; totalFunding?: number; mandateFit: number; mandateFitNote: string }[];
  signals: { companyName: string; type: string; title: string; detail: string }[];
  companiesAdded: number;
  signalsAdded: number;
  filename: string;
};

function ScanTab({ onCompaniesAdded }: { onCompaniesAdded: () => void }) {
  const [file, setFile]         = useState<File | null>(null);
  const [prompt, setPrompt]     = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult]     = useState<ScanResult | null>(null);
  const [error, setError]       = useState("");
  const [dragOver, setDragOver] = useState(false);

  function handleFile(f: File) {
    if (f.type !== "application/pdf") { setError("Solo se aceptan archivos PDF."); return; }
    if (f.size > 20 * 1024 * 1024) { setError("El archivo es muy grande (máx. 20MB). Prueba con un fragmento del documento."); return; }
    setFile(f);
    setError("");
    setResult(null);
  }

  async function handleScan() {
    if (!file) return;
    setScanning(true);
    setError("");
    setResult(null);
    setProgress("Leyendo el PDF...");

    try {
      // Read PDF as base64 in the browser
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      setProgress("Enviando a Claude para análisis...");
      const res = await fetch("/api/radar/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: base64, userPrompt: prompt || null, filename: file.name }),
      });

      setProgress("Procesando resultados...");
      const data = await res.json();

      if (!res.ok) { setError(data.error ?? "Error al procesar el documento."); setScanning(false); setProgress(""); return; }

      setResult(data);
      if (data.companiesAdded > 0) onCompaniesAdded();
    } catch (e: any) {
      setError(e.message ?? "Error inesperado.");
    }
    setScanning(false);
    setProgress("");
  }

  const fitColor = (score: number) =>
    score >= 8 ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : score >= 6 ? "text-amber-700 bg-amber-50 border-amber-200"
    : "text-slate bg-fog border-chalk";

  const signalIcon: Record<string, string> = {
    funding_due: "💰", strategic_buyer_interest: "🤝", exec_change: "👤",
    revenue_inflection: "📈", risk_flag: "⚠️",
  };

  return (
    <div className="space-y-4">
      {/* Upload card */}
      <Card>
        <p className="text-[13px] font-semibold text-carbon mb-1">Escanear documento con IA</p>
        <p className="text-[11px] text-slate mb-4">
          Sube un PDF — newsletters de VCs, reportes de industria, pitch decks, deal flow — y Claude extraerá empresas y señales relevantes para el Radar.
        </p>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onClick={() => document.getElementById("pdf-upload-input")?.click()}
          className={`border-2 border-dashed rounded-[10px] p-8 text-center cursor-pointer transition-colors ${
            dragOver ? "border-orange bg-orange/5" : file ? "border-emerald-400 bg-emerald-50/40" : "border-chalk hover:border-carbon/30 hover:bg-fog/40"
          }`}
        >
          <input id="pdf-upload-input" type="file" accept="application/pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          {file ? (
            <div>
              <p className="text-[28px] mb-1">📄</p>
              <p className="text-[13px] font-semibold text-carbon">{file.name}</p>
              <p className="text-[11px] text-slate mt-0.5">{(file.size / 1024 / 1024).toFixed(1)} MB · haz clic para cambiar</p>
            </div>
          ) : (
            <div>
              <p className="text-[28px] mb-2">📄</p>
              <p className="text-[13px] font-medium text-carbon">Arrastra un PDF aquí o haz clic para seleccionar</p>
              <p className="text-[11px] text-slate mt-1">Hasta 20MB · newsletters, reportes, pitch decks, deal flow</p>
            </div>
          )}
        </div>

        {/* Optional prompt */}
        <div className="mt-4">
          <label className="block text-[11px] font-medium text-slate mb-1.5">
            Instrucciones adicionales para este documento <span className="text-slate font-normal">(opcional)</span>
          </label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={2}
            placeholder="Ej: Enfócate en empresas de Fintech B2B con más de $5M en funding. Ignora empresas de consumo."
            className="w-full px-3 py-2 text-[12px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate focus:outline-none focus:border-carbon resize-none"
          />
        </div>

        {error && <p className="mt-3 text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-[7px] px-3 py-2">{error}</p>}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleScan}
            disabled={!file || scanning}
            className="flex items-center gap-2 px-4 py-2 text-[12px] font-medium bg-carbon text-white rounded-[8px] hover:opacity-85 disabled:opacity-40 transition-opacity"
          >
            {scanning ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="10"/></svg>
                {progress || "Analizando..."}
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
                Escanear con IA
              </>
            )}
          </button>
          {scanning && <p className="text-[11px] text-slate animate-pulse">{progress}</p>}
        </div>
      </Card>

      {/* Results */}
      {result && (
        <div className="space-y-4">

          {/* Summary + Key Insights */}
          <Card>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 rounded-[7px] bg-carbon flex items-center justify-center text-white text-[14px] shrink-0">📄</div>
              <div>
                <p className="text-[13px] font-semibold text-carbon">{result.filename}</p>
                <p className="text-[10px] text-slate mt-0.5">
                  {result.companiesAdded} empresa{result.companiesAdded !== 1 ? "s" : ""} agregada{result.companiesAdded !== 1 ? "s" : ""} al Radar
                  {result.signalsAdded > 0 ? ` · ${result.signalsAdded} señal${result.signalsAdded !== 1 ? "es" : ""} detectada${result.signalsAdded !== 1 ? "s" : ""}` : ""}
                </p>
              </div>
            </div>

            <div className="mb-4">
              <p className="text-[11px] font-semibold text-graphite uppercase tracking-wide mb-2">Resumen ejecutivo</p>
              <p className="text-[12px] text-graphite leading-relaxed">{result.summary}</p>
            </div>

            {result.keyInsights.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-graphite uppercase tracking-wide mb-2">Key insights</p>
                <ul className="space-y-1.5">
                  {result.keyInsights.map((insight, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12px] text-graphite">
                      <span className="text-orange mt-0.5 shrink-0">→</span>
                      {insight}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {/* Companies found */}
          {result.companies.length > 0 && (
            <Card padding="none">
              <div className="px-5 py-3 border-b border-chalk bg-fog/30">
                <p className="text-[13px] font-semibold text-carbon">
                  Empresas encontradas — {result.companiesAdded} agregadas al Radar
                </p>
                <p className="text-[11px] text-slate">Score de fit calculado contra los mandatos activos del fondo</p>
              </div>
              <div className="divide-y divide-chalk">
                {result.companies.map((co, i) => (
                  <div key={i} className="px-5 py-3 flex items-start gap-4">
                    <div className="w-7 h-7 rounded-[6px] bg-carbon/8 border border-chalk flex items-center justify-center text-[10px] font-bold text-carbon shrink-0 mt-0.5">
                      {co.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-[13px] font-semibold text-carbon">{co.name}</span>
                        {co.sector && <span className="text-[9px] bg-fog border border-chalk rounded-full px-1.5 py-0.5 text-slate">{co.sector}</span>}
                        <span className="text-[9px] text-slate">{co.country}</span>
                        {co.fundingStage && <span className="text-[9px] bg-orange/10 text-orange border border-orange/20 rounded-full px-1.5 py-0.5">{co.fundingStage}</span>}
                        {co.totalFunding && <span className="text-[9px] text-emerald-700">${co.totalFunding}M</span>}
                      </div>
                      <p className="text-[11px] text-graphite leading-relaxed">{co.description}</p>
                      <p className="text-[10px] text-slate mt-1 italic">{co.mandateFitNote}</p>
                    </div>
                    <div className={`text-[11px] font-semibold px-2 py-1 rounded-[6px] border shrink-0 ${fitColor(co.mandateFit)}`}>
                      {co.mandateFit}/10
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Signals for existing companies */}
          {result.signals.length > 0 && (
            <Card padding="none">
              <div className="px-5 py-3 border-b border-chalk bg-fog/30">
                <p className="text-[13px] font-semibold text-carbon">Señales detectadas para empresas del Radar</p>
                <p className="text-[11px] text-slate">Información relevante sobre empresas que ya monitoreas</p>
              </div>
              <div className="divide-y divide-chalk">
                {result.signals.map((sig, i) => (
                  <div key={i} className="px-5 py-3 flex items-start gap-3">
                    <span className="text-[16px] shrink-0 mt-0.5">{signalIcon[sig.type] ?? "📌"}</span>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[12px] font-semibold text-carbon">{sig.companyName}</span>
                        <span className="text-[9px] bg-fog border border-chalk rounded-full px-1.5 py-0.5 text-slate">{sig.type.replace(/_/g, " ")}</span>
                      </div>
                      <p className="text-[12px] font-medium text-carbon">{sig.title}</p>
                      <p className="text-[11px] text-graphite mt-0.5">{sig.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {result.companies.length === 0 && result.signals.length === 0 && (
            <Card>
              <div className="text-center py-6">
                <p className="text-[28px] mb-2">🔍</p>
                <p className="text-[13px] font-medium text-carbon">No se encontraron empresas o señales relevantes</p>
                <p className="text-[12px] text-slate mt-1">Prueba ajustando el prompt o sube un documento diferente</p>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
