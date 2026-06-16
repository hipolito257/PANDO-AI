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
  signals: { id: string; type: string; severity: string; title: string }[];
  tags: { tag: string }[];
};

export default function RadarPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [mandates, setMandates] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [sector, setSector] = useState("");
  const [country, setCountry] = useState("");
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState("");
  const [mandateId, setMandateId] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const [editCompany, setEditCompany] = useState<Company | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (sector) params.set("sector", sector);
    if (country) params.set("country", country);
    if (stage) params.set("stage", stage);
    if (status) params.set("status", status);
    if (mandateId) params.set("mandate", mandateId);
    const res = await fetch(`/api/companies?${params}`);
    const data = await res.json();
    setCompanies(data);
    setLoading(false);
  }, [q, sector, country, stage, status, mandateId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/mandatos").then(r => r.json()).then(setMandates);
  }, []);


  const selectClass = "px-3 py-1.5 text-[12px] bg-paper border border-chalk rounded-[8px] text-carbon focus:outline-none focus:border-carbon";

  return (
    <div>
      <Topbar
        title="Radar"
        subtitle={`${companies.length} empresas`}
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
        {/* Filters */}
        <Card padding="sm">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Buscar empresa..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="px-3 py-1.5 text-[12px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate focus:outline-none focus:border-carbon w-48"
            />
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
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
              <option value="">Todos los estados</option>
              <option value="monitoring">Monitoreando</option>
              <option value="pipeline">Pipeline</option>
              <option value="portfolio">Portafolio</option>
            </select>
            {(q || sector || country || stage || status || mandateId) && (
              <Button variant="ghost" size="sm" onClick={() => { setQ(""); setSector(""); setCountry(""); setStage(""); setStatus(""); setMandateId(""); }}>
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

        {/* Table */}
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
                            <button
                              onClick={() => setEditCompany(c as any)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-slate hover:text-carbon"
                              title="Editar empresa"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>
                          </div>
                          <div className="flex gap-1 mt-1">
                            {c.tags.slice(0, 2).map((t) => (
                              <span key={t.tag} className="text-[9px] bg-fog border border-chalk rounded-full px-1.5 py-0.5 text-slate">{t.tag}</span>
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
