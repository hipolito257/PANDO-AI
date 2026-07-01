"use client";
import { useState, useEffect, useCallback, type ReactElement } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card } from "@/components/ui/Card";
import { SignalBadge, StatusBadge, ScoreBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spark } from "@/components/charts/Spark";
import { CompanyLogo } from "@/components/company/CompanyLogo";
import { WebsiteLink } from "@/components/ui/WebsiteLink";
import {
  IconRadarTab, IconPipeline, IconFlag, IconDocument,
  IconTrendingUp, IconMerge, IconXCircle, IconTarget,
  IconSearch, IconFunding, IconPerson, IconAlertTriangle,
} from "@/components/ui/Icons";
import { fmtM } from "@/lib/utils";
import Link from "next/link";
import type { SignalType } from "@/types";
import { CompanyModal } from "@/components/company/CompanyModal";
import { CrunchbaseImport } from "@/components/radar/CrunchbaseImport";

const SECTORS = ["Fintech", "Software", "SaaS", "Logistics", "Healthcare", "Consumer", "Retail", "Mobility"];
const COUNTRIES = ["México", "Colombia", "Chile", "Perú", "Brasil"];
const STAGES = [
  { value: "seed", label: "Seed" },
  { value: "series-a", label: "Series A" },
  { value: "series-b", label: "Series B" },
  { value: "growth", label: "Growth" },
  { value: "mature", label: "Mature" },
];

type Company = {
  id: string; name: string; slug: string; sector: string | null; country: string;
  stage: string | null; website: string | null;
  revenueUsd: number | null; revenueGrowth: number | null;
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
  const [exitModal, setExitModal] = useState<Company | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (sector) params.set("sector", sector);
      if (country) params.set("country", country);
      if (stage) params.set("stage", stage);
      if (mandateId) params.set("mandate", mandateId);
      const res = await fetch(`/api/companies?${params}`);
      const main = res.ok ? await res.json() : [];
      const mainData = Array.isArray(main) ? main : (main.companies ?? []);
      setCompanies(mainData.filter((c: Company) => c.status === "monitoring"));
      setPipeline(mainData.filter((c: Company) => c.status === "pipeline"));
      setExited(mainData.filter((c: Company) => EXIT_STATUSES.includes(c.status)));
    } catch {
      // Network/API error — show empty state instead of infinite spinner
    } finally {
      setLoading(false);
    }
  }, [q, sector, country, stage, mandateId]);

  const load = loadAll;

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { fetch("/api/mandatos").then(r => r.json()).then(setMandates); }, []);

  // Mark all non-exit signals as read when the user opens Radar
  useEffect(() => {
    fetch("/api/signals/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ excludeTypes: ["exit_signal"] }),
    });
  }, []);

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

  // Pipeline → Exit: el equipo confirma la salida con tipo
  async function moveToExit(id: string, exitType: "public" | "acquired" | "closed") {
    await fetch(`/api/companies`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: exitType }) });
    setExitModal(null);
    loadAll();
  }

  // Archivar: quitar del radar o pipeline
  async function archiveCompany(id: string, context: "radar" | "pipeline") {
    const msg = context === "pipeline"
      ? "Archive this company? It will leave the pipeline."
      : "Remove this company from the radar?";
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
        subtitle={`${companies.length} in radar · ${pipelineCompanies.length} in active pipeline`}
        actions={
          <div className="flex items-center gap-2">
            <CrunchbaseImport onImported={load} />
            <Button variant="fill" size="sm" onClick={() => setShowAdd(true)}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><line x1="5" y1="1" x2="5" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              Add company
            </Button>
          </div>
        }
      />

      <div className="p-6 space-y-4">

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-paper border border-chalk rounded-[10px] p-1 w-fit">
          {([
            { key: "radar"    as const, Icon: IconRadarTab, label: `Radar (${companies.length})` },
            { key: "pipeline" as const, Icon: IconPipeline,  label: `Pipeline${pipelineCompanies.length > 0 ? ` (${pipelineCompanies.length})` : ""}` },
            { key: "salidas"  as const, Icon: IconFlag,       label: `Exits${exitedCompanies.length > 0 ? ` (${exitedCompanies.length})` : ""}` },
            { key: "scan"     as const, Icon: IconDocument,  label: "Scan" },
          ]).map(({ key, Icon, label }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`px-4 py-1.5 text-[12px] font-medium rounded-[7px] transition-all flex items-center gap-1.5 ${
                activeTab === key ? "bg-carbon text-white shadow-sm" : "text-slate hover:text-carbon"
              }`}>
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>

        {/* ── RADAR tab ── */}
        {activeTab === "radar" && (
        <>
        {/* Filters */}
        <Card padding="sm">
          <div className="flex flex-wrap items-center gap-2">
            <input type="text" placeholder="Search company..." value={q} onChange={(e) => setQ(e.target.value)}
              className="px-3 py-1.5 text-[12px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate focus:outline-none focus:border-carbon w-48" />
            <select value={mandateId} onChange={(e) => setMandateId(e.target.value)} className={selectClass}>
              <option value="">All mandates</option>
              {mandates.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select value={sector} onChange={(e) => setSector(e.target.value)} className={selectClass}>
              <option value="">All sectors</option>
              {SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={selectClass}>
              <option value="">All countries</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={selectClass}>
              <option value="">All stages</option>
              {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {(q || sector || country || stage || mandateId) && (
              <Button variant="ghost" size="sm" onClick={() => { setQ(""); setSector(""); setCountry(""); setStage(""); setMandateId(""); }}>
                Clear filters
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
            <div className="flex items-center justify-center h-40 text-slate text-[13px]">Loading...</div>
          ) : companies.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate">
              <p className="text-[14px] font-medium">No results</p>
              <p className="text-[12px]">Adjust filters or add a company</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-[10px] text-slate uppercase tracking-wide border-b border-chalk bg-fog/50">
                    <th className="px-5 py-3 text-left font-medium">Company</th>
                    <th className="px-3 py-3 text-left font-medium">Sector / Country</th>
                    <th className="px-3 py-3 text-right font-medium">Revenue</th>
                    <th className="px-3 py-3 text-right font-medium">Growth</th>
                    <th className="px-3 py-3 text-right font-medium">EBITDA%</th>
                    <th className="px-3 py-3 text-right font-medium">Employees</th>
                    <th className="px-3 py-3 text-left font-medium">Status</th>
                    <th className="px-3 py-3 text-right font-medium">Score</th>
                    <th className="px-3 py-3 text-left font-medium">Top signal</th>
                    <th className="px-3 py-3 text-center font-medium">Trend</th>
                    <th className="px-3 py-3 text-center font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-chalk">
                  {companies.map((c) => {
                    const topSig = c.signals[0];
                    return (
                      <tr key={c.id} className="hover:bg-fog/40 transition-colors group">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <CompanyLogo name={c.name} website={c.website} size="sm" />
                            <Link href={`/empresa/${c.slug}`} className="font-semibold text-[13px] text-carbon hover:text-orange transition-colors">
                              {c.name}
                            </Link>
                            <WebsiteLink url={c.website} />
                            {c.createdBy && <span className="text-[9px] text-slate ml-1">by {c.createdBy}</span>}
                            <button onClick={() => setEditCompany(c as any)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-slate hover:text-carbon" title="Edit company">
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
                          {c.employees ? c.employees.toLocaleString("en-US") : "—"}
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
                              title="Move to Pipeline"
                              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-orange text-white rounded-[6px] hover:bg-orange/90 transition-colors whitespace-nowrap"
                            >
                              Pipeline →
                            </button>
                            <button
                              onClick={() => archiveCompany(c.id, "radar")}
                              title="Remove from radar"
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
                <p className="text-[13px] font-semibold text-carbon">Active Pipeline</p>
                <p className="text-[11px] text-slate">Companies under active evaluation · Promoted from Radar by the team</p>
              </div>
            </div>
            {pipelineCompanies.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate">
                <IconTarget size={40} className="text-chalk mb-3" />
                <p className="text-[14px] font-medium text-carbon">Empty pipeline</p>
                <p className="text-[12px] mt-1 text-center max-w-[280px]">
                  When a company from Radar interests you, click <strong className="text-carbon">Pipeline →</strong> to move it here
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] text-slate uppercase tracking-wide border-b border-chalk bg-fog/50">
                      <th className="px-5 py-3 text-left font-medium">Company</th>
                      <th className="px-3 py-3 text-left font-medium">Sector / Country</th>
                      <th className="px-3 py-3 text-left font-medium">Description</th>
                      <th className="px-3 py-3 text-left font-medium">Stage / Funding</th>
                      <th className="px-3 py-3 text-right font-medium">Score</th>
                      <th className="px-3 py-3 text-center font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-chalk">
                    {pipelineCompanies.map((c) => (
                      <tr key={c.id} className="hover:bg-fog/30 transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <CompanyLogo name={c.name} website={c.website} size="sm" />
                            <Link href={`/empresa/${c.slug}`} className="text-[13px] font-semibold text-carbon hover:text-orange transition-colors">
                              {c.name}
                            </Link>
                            <WebsiteLink url={c.website} />
                          </div>
                          {c.createdBy && <p className="text-[9px] text-slate mt-0.5 pl-[calc(1.5rem+0.5rem)]">{c.createdBy}</p>}
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
                            <button onClick={() => setExitModal(c)}
                              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-emerald-600 text-white rounded-[6px] hover:bg-emerald-700 transition-colors whitespace-nowrap">
                              <IconFlag size={10} />
                              Exit
                            </button>
                            <button onClick={() => archiveCompany(c.id, "pipeline")}
                              className="px-2.5 py-1 text-[11px] font-medium border border-chalk text-slate rounded-[6px] hover:border-red-300 hover:text-red-500 transition-colors">
                              Archive
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
              <p className="text-[13px] font-semibold text-carbon">Exits detected</p>
              <p className="text-[11px] text-slate">Companies that went public, were acquired, or shut down · Detected automatically from news</p>
            </div>
            {exitedCompanies.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate">
                <IconFlag size={36} className="text-chalk mb-3" />
                <p className="text-[14px] font-medium text-carbon">No exits detected yet</p>
                <p className="text-[12px] mt-1">They'll appear here when the system detects an IPO, acquisition, or shutdown</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] text-slate uppercase tracking-wide border-b border-chalk bg-fog/50">
                      <th className="px-5 py-3 text-left font-medium">Company</th>
                      <th className="px-3 py-3 text-left font-medium">Sector / Country</th>
                      <th className="px-3 py-3 text-left font-medium">Exit type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-chalk">
                    {exitedCompanies.map((c) => (
                      <tr key={c.id} className="hover:bg-fog/30 transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <CompanyLogo name={c.name} website={c.website} size="sm" />
                            <Link href={`/empresa/${c.slug}`} className="text-[13px] font-semibold text-carbon hover:text-orange transition-colors">
                              {c.name}
                            </Link>
                            <WebsiteLink url={c.website} />
                          </div>
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

        {/* ── EXIT MODAL ── */}
        {exitModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-carbon/40 backdrop-blur-sm">
            <div className="bg-paper rounded-[14px] border border-chalk shadow-xl p-6 w-[400px]">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-[8px] bg-emerald-100 flex items-center justify-center">
                  <IconFlag size={18} className="text-emerald-700" />
                </div>
                <div>
                  <p className="text-[14px] font-semibold text-carbon">Confirm exit</p>
                  <p className="text-[11px] text-slate">{exitModal.name}</p>
                </div>
              </div>
              <p className="text-[12px] text-graphite mb-4 leading-relaxed">
                Select the exit type. This will move the company to the <strong>Exits</strong> section and it will no longer appear in the Pipeline.
              </p>
              <div className="space-y-2 mb-5">
                {[
                  { type: "public"   as const, Icon: IconTrendingUp, iconCls: "text-emerald-600", label: "IPO / Public listing",   desc: "The company is listed on a public market" },
                  { type: "acquired" as const, Icon: IconMerge,       iconCls: "text-blue-600",   label: "Acquisition / M&A",       desc: "The company was acquired by a third party" },
                  { type: "closed"   as const, Icon: IconXCircle,     iconCls: "text-red-500",    label: "Shutdown",   desc: "The company closed or went bankrupt" },
                ].map(({ type, Icon, iconCls, label, desc }) => (
                  <button key={type} onClick={() => moveToExit(exitModal.id, type)}
                    className="w-full text-left px-4 py-3 border border-chalk rounded-[9px] hover:border-carbon hover:bg-fog transition-colors flex items-center gap-3">
                    <Icon size={18} className={iconCls} />
                    <div>
                      <p className="text-[12px] font-semibold text-carbon">{label}</p>
                      <p className="text-[10px] text-slate mt-0.5">{desc}</p>
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={() => setExitModal(null)}
                className="w-full px-4 py-2 text-[12px] text-slate border border-chalk rounded-[8px] hover:bg-fog transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

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
    if (f.type !== "application/pdf") { setError("Only PDF files are accepted."); return; }
    if (f.size > 20 * 1024 * 1024) { setError("File is too large (max. 20MB). Try a smaller section of the document."); return; }
    setFile(f);
    setError("");
    setResult(null);
  }

  async function handleScan() {
    if (!file) return;
    setScanning(true);
    setError("");
    setResult(null);
    setProgress("Reading PDF...");

    try {
      // Read PDF as base64 in the browser
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      setProgress("Sending to Claude for analysis...");
      const res = await fetch("/api/radar/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: base64, userPrompt: prompt || null, filename: file.name }),
      });

      setProgress("Processing results...");
      const data = await res.json();

      if (!res.ok) { setError(data.error ?? "Error processing the document."); setScanning(false); setProgress(""); return; }

      setResult(data);
      if (data.companiesAdded > 0) onCompaniesAdded();
    } catch (e: any) {
      setError(e.message ?? "Unexpected error.");
    }
    setScanning(false);
    setProgress("");
  }

  const fitColor = (score: number) =>
    score >= 8 ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : score >= 6 ? "text-amber-700 bg-amber-50 border-amber-200"
    : "text-slate bg-fog border-chalk";

  const signalIconMap: Record<string, ReactElement> = {
    funding_due:              <IconFunding size={14} className="text-emerald-600" />,
    strategic_buyer_interest: <IconMerge size={14} className="text-blue-600" />,
    exec_change:              <IconPerson size={14} className="text-amber-600" />,
    revenue_inflection:       <IconTrendingUp size={14} className="text-emerald-600" />,
    risk_flag:                <IconAlertTriangle size={14} className="text-red-500" />,
  };

  return (
    <div className="space-y-4">
      {/* Upload card */}
      <Card>
        <p className="text-[13px] font-semibold text-carbon mb-1">Scan document with AI</p>
        <p className="text-[11px] text-slate mb-4">
          Upload a PDF — VC newsletters, industry reports, pitch decks, deal flow — and Claude will extract relevant companies and signals for Radar.
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
              <div className="flex justify-center mb-2"><IconDocument size={32} className="text-emerald-500" /></div>
              <p className="text-[13px] font-semibold text-carbon">{file.name}</p>
              <p className="text-[11px] text-slate mt-0.5">{(file.size / 1024 / 1024).toFixed(1)} MB · click to change</p>
            </div>
          ) : (
            <div>
              <div className="flex justify-center mb-2"><IconDocument size={32} className="text-slate" /></div>
              <p className="text-[13px] font-medium text-carbon">Drag a PDF here or click to select</p>
              <p className="text-[11px] text-slate mt-1">Up to 20MB · newsletters, reports, pitch decks, deal flow</p>
            </div>
          )}
        </div>

        {/* Optional prompt */}
        <div className="mt-4">
          <label className="block text-[11px] font-medium text-slate mb-1.5">
            Additional instructions for this document <span className="text-slate font-normal">(optional)</span>
          </label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={2}
            placeholder="E.g.: Focus on B2B Fintech companies with more than $5M in funding. Ignore consumer companies."
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
                {progress || "Analyzing..."}
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
                Scan with AI
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
              <div className="w-8 h-8 rounded-[7px] bg-carbon flex items-center justify-center shrink-0">
                <IconDocument size={14} className="text-white" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-carbon">{result.filename}</p>
                <p className="text-[10px] text-slate mt-0.5">
                  {result.companiesAdded} compan{result.companiesAdded !== 1 ? "ies" : "y"} added to Radar
                  {result.signalsAdded > 0 ? ` · ${result.signalsAdded} signal${result.signalsAdded !== 1 ? "s" : ""} detected` : ""}
                </p>
              </div>
            </div>

            <div className="mb-4">
              <p className="text-[11px] font-semibold text-graphite uppercase tracking-wide mb-2">Executive summary</p>
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
                  Companies found — {result.companiesAdded} added to Radar
                </p>
                <p className="text-[11px] text-slate">Fit score calculated against the fund's active mandates</p>
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
                <p className="text-[13px] font-semibold text-carbon">Signals detected for Radar companies</p>
                <p className="text-[11px] text-slate">Relevant information about companies you're already monitoring</p>
              </div>
              <div className="divide-y divide-chalk">
                {result.signals.map((sig, i) => (
                  <div key={i} className="px-5 py-3 flex items-start gap-3">
                    <span className="shrink-0 mt-0.5">{signalIconMap[sig.type] ?? <IconDocument size={14} className="text-slate" />}</span>
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
                <IconSearch size={36} className="text-chalk mx-auto mb-3" />
                <p className="text-[13px] font-medium text-carbon">No relevant companies or signals found</p>
                <p className="text-[12px] text-slate mt-1">Try adjusting the prompt or upload a different document</p>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
