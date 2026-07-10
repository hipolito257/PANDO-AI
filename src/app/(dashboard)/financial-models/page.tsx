"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { TrendingUp, Upload, X, Loader2, Download, Trash2 } from "lucide-react";
import { useDocJobs } from "../DocJobsContext";

interface Company { id: string; name: string; sector: string | null; stage: string | null; }
interface SavedModel {
  id: string; companyId: string | null; companyName: string | null; modelType: string;
  name: string; status: string; workbookUrl: string | null; workbookSize: number | null;
  createdAt: string | null; updatedAt: string | null;
}
interface LboPlan {
  entryEbitda: number; revenueYear0: number; entryMultiple: number;
  transactionFeesPct: number; financingFeesPct: number;
  debtToEbitda: number; interestRatePct: number; mandatoryAmortPct: number; cashSweepPct: number; minCashBalance: number;
  revenueGrowthPct: number[]; ebitdaMarginPct: number[]; capexPctRevenue: number[]; nwcPctRevenue: number[]; daPctRevenue: number[];
  taxRatePct: number; holdingPeriodYears: number; exitMultiple: number;
  rationale?: string;
}

const CTX_CHUNK = 3 * 1024 * 1024;

function fmtSize(b: number | null): string {
  if (!b) return "";
  return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
}

function PctField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] text-slate">{label}</span>
      <div className="flex items-center mt-1">
        <input
          type="number" step="0.1" value={(value * 100).toFixed(1)}
          onChange={e => onChange((parseFloat(e.target.value) || 0) / 100)}
          className="w-full px-2.5 py-1.5 text-[12px] bg-fog border border-chalk rounded-[6px] text-carbon focus:outline-none focus:border-orange"
        />
        <span className="ml-1 text-[11px] text-slate">%</span>
      </div>
    </label>
  );
}
function NumField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="block">
      <span className="text-[11px] text-slate">{label}</span>
      <input
        type="number" step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-full mt-1 px-2.5 py-1.5 text-[12px] bg-fog border border-chalk rounded-[6px] text-carbon focus:outline-none focus:border-orange"
      />
    </label>
  );
}

// A per-year assumption: flat input by default, expandable into one field per year.
function YearArrayField({ label, values, onChange, holdYears, pct = true }: {
  label: string; values: number[]; onChange: (v: number[]) => void; holdYears: number; pct?: boolean;
}) {
  const [customizing, setCustomizing] = useState(() => new Set(values).size > 1);
  const flat = values[0] ?? 0;

  if (!customizing) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate">{label} (all years)</span>
          <button type="button" onClick={() => setCustomizing(true)} className="text-[10px] text-orange hover:underline">
            Customize by year
          </button>
        </div>
        <div className="flex items-center mt-1">
          <input
            type="number" step={pct ? 0.1 : 1} value={pct ? (flat * 100).toFixed(1) : flat}
            onChange={e => {
              const v = (parseFloat(e.target.value) || 0) / (pct ? 100 : 1);
              onChange(Array(holdYears).fill(v));
            }}
            className="w-full px-2.5 py-1.5 text-[12px] bg-fog border border-chalk rounded-[6px] text-carbon focus:outline-none focus:border-orange"
          />
          {pct && <span className="ml-1 text-[11px] text-slate">%</span>}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-slate">{label} by year</span>
        <button type="button" onClick={() => setCustomizing(false)} className="text-[10px] text-slate hover:underline">
          Use one value
        </button>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {values.map((v, i) => (
          <div key={i}>
            <span className="text-[9px] text-slate">Y{i + 1}</span>
            <input
              type="number" step={pct ? 0.1 : 1} value={pct ? (v * 100).toFixed(1) : v}
              onChange={e => {
                const nv = (parseFloat(e.target.value) || 0) / (pct ? 100 : 1);
                const next = [...values]; next[i] = nv; onChange(next);
              }}
              className="w-full px-1.5 py-1 text-[11px] bg-fog border border-chalk rounded-[6px] text-carbon focus:outline-none focus:border-orange"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FinancialModelsPage() {
  const { jobs, runJob } = useDocJobs();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [companyNameFreeform, setCompanyNameFreeform] = useState("");
  const [savedModels, setSavedModels] = useState<SavedModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const [contextFiles, setContextFiles] = useState<File[]>([]);
  const [contextBlobUrls, setContextBlobUrls] = useState<{ name: string; url: string; type: string }[]>([]);
  const [uploadingCtx, setUploadingCtx] = useState(false);
  const ctxFileRef = useRef<HTMLInputElement>(null);

  const [plan, setPlan] = useState<LboPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  const [building, setBuilding] = useState(false);
  const [buildErr, setBuildErr] = useState<string | null>(null);
  const [lastDownload, setLastDownload] = useState<{ filename: string; modelId: string } | null>(null);
  const [currentModelId, setCurrentModelId] = useState<string | null>(null);

  const loadCompanies = useCallback(async () => {
    const r = await fetch("/api/companies");
    if (r.ok) { const d = await r.json(); setCompanies(d.companies ?? d); }
  }, []);
  const loadModels = useCallback(async (forCompanyId: string) => {
    setLoadingModels(true);
    const url = forCompanyId ? `/api/financial-models?companyId=${forCompanyId}` : "/api/financial-models";
    const r = await fetch(url);
    if (r.ok) setSavedModels(await r.json());
    setLoadingModels(false);
  }, []);

  useEffect(() => { loadCompanies(); loadModels(""); }, [loadCompanies, loadModels]);
  useEffect(() => { loadModels(companyId); }, [companyId, loadModels]);

  useEffect(() => {
    const job = jobs.lboPlan;
    if (!job) return;
    setPlanning(job.status === "running");
    if (job.status === "error") setPlanErr(job.error ?? "Unknown error");
    if (job.status === "done") { setPlanErr(null); setPlan(job.result as LboPlan); setFeedback(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.lboPlan]);

  useEffect(() => {
    const job = jobs.lboBuild;
    if (!job) return;
    setBuilding(job.status === "running");
    if (job.status === "error") setBuildErr(job.error ?? "Unknown error");
    if (job.status === "done") {
      setBuildErr(null);
      const r = job.result as { filename: string; modelId: string };
      setLastDownload(r);
      setCurrentModelId(r.modelId);
      loadModels(companyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.lboBuild]);

  function addContextFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    setContextFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      return [...prev, ...arr.filter(f => !existing.has(f.name + f.size))];
    });
    setContextBlobUrls([]);
  }
  function removeContextFile(idx: number) {
    setContextFiles(prev => prev.filter((_, i) => i !== idx));
    setContextBlobUrls([]);
  }

  async function ensureContextBlobsUploaded(): Promise<{ name: string; url: string; type: string }[]> {
    if (contextFiles.length === 0) return [];
    if (contextBlobUrls.length === contextFiles.length) return contextBlobUrls;
    setUploadingCtx(true);
    const results: { name: string; url: string; type: string }[] = [];
    for (const file of contextFiles) {
      const uploadId = crypto.randomUUID();
      const totalChunks = Math.ceil(file.size / CTX_CHUNK) || 1;
      const chunkUrls: string[] = [];
      for (let i = 0; i < totalChunks; i++) {
        const chunk = file.slice(i * CTX_CHUNK, (i + 1) * CTX_CHUNK);
        const fd = new FormData();
        fd.append("chunk", chunk);
        fd.append("uploadId", uploadId);
        fd.append("chunkIndex", String(i));
        fd.append("filename", file.name);
        const res = await fetch("/api/templates/chunk", { method: "POST", body: fd });
        if (!res.ok) throw new Error(`Error uploading ${file.name} (part ${i + 1})`);
        const { chunkUrl } = await res.json();
        chunkUrls.push(chunkUrl);
      }
      const finalRes = await fetch("/api/templates/chunk/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunkUrls, filename: `ctx_${Date.now()}_${file.name}` }),
      });
      if (!finalRes.ok) throw new Error(`Error assembling ${file.name}`);
      const { blobUrl } = await finalRes.json();
      results.push({ name: file.name, url: blobUrl, type: file.type });
    }
    setContextBlobUrls(results);
    setUploadingCtx(false);
    return results;
  }

  async function handlePlan(fb?: string) {
    setPlanErr(null);
    setCurrentModelId(null); setLastDownload(null);
    await runJob("lboPlan", async () => {
      const blobUrls = await ensureContextBlobsUploaded();
      const fd = new FormData();
      if (companyId) fd.append("companyId", companyId);
      if (!companyId && companyNameFreeform.trim()) fd.append("companyName", companyNameFreeform.trim());
      if (fb?.trim()) fd.append("feedback", fb.trim());
      if (blobUrls.length) fd.append("blobUrls", JSON.stringify(blobUrls));

      const res = await fetch("/api/financial-models/lbo/plan", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({})) as { success?: boolean; plan?: LboPlan; error?: string; raw?: string };
      if (!res.ok || !j.success) throw new Error(j.error ?? "Error drafting assumptions");
      return j.plan!;
    });
  }

  async function handleBuild() {
    if (!plan) return;
    setBuildErr(null);
    const selectedCompany = companies.find(c => c.id === companyId);
    await runJob("lboBuild", async () => {
      const res = await fetch("/api/financial-models/lbo/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvedPlan: plan,
          companyId: companyId || null,
          companyName: selectedCompany?.name || companyNameFreeform || "Company",
          modelId: currentModelId ?? undefined,
          contextFiles: contextBlobUrls,
        }),
      });
      const j = await res.json().catch(() => ({})) as { file?: string; filename?: string; modelId?: string; error?: string };
      if (!res.ok || !j.file) throw new Error(j.error ?? "Error building model");

      const bytes = Uint8Array.from(atob(j.file), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = j.filename!; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return { filename: j.filename!, modelId: j.modelId! };
    });
  }

  async function loadSavedModel(id: string) {
    const r = await fetch(`/api/financial-models/${id}`);
    if (!r.ok) return;
    const d = await r.json();
    const a = JSON.parse(typeof d.assumptions === "string" ? d.assumptions : JSON.stringify(d.assumptions));
    setPlan(a);
    setCurrentModelId(id);
    setLastDownload(null);
    if (d.companyId) setCompanyId(d.companyId);
  }
  async function deleteSavedModel(id: string) {
    await fetch(`/api/financial-models/${id}`, { method: "DELETE" });
    loadModels(companyId);
    if (currentModelId === id) { setCurrentModelId(null); setPlan(null); }
  }

  function update<K extends keyof LboPlan>(key: K, value: LboPlan[K]) {
    setPlan(prev => prev ? { ...prev, [key]: value } : prev);
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto bg-mist">
        <div className="max-w-5xl mx-auto px-8 py-8">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={20} className="text-orange" />
            <h1 className="text-[20px] font-semibold text-carbon">Financial Models</h1>
          </div>
          <p className="text-[13px] text-slate mb-6">
            Build a formula-driven LBO model — every number in the workbook is a real Excel formula you can audit and edit, not AI-typed static values.
          </p>

          {/* Company / target */}
          <div className="bg-white border border-chalk rounded-[12px] p-6 mb-6">
            <h2 className="text-[14px] font-semibold text-carbon mb-3">Target Company</h2>
            <select
              value={companyId}
              onChange={e => { setCompanyId(e.target.value); setPlan(null); setCurrentModelId(null); setLastDownload(null); }}
              className="w-full px-3 py-2.5 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon focus:outline-none focus:border-orange mb-2"
            >
              <option value="">— No specific company (early screening) —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!companyId && (
              <input
                type="text" placeholder="Company name (optional, for a target not yet tracked)"
                value={companyNameFreeform} onChange={e => setCompanyNameFreeform(e.target.value)}
                className="w-full px-3 py-2.5 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate/60 focus:outline-none focus:border-orange"
              />
            )}
          </div>

          {/* Context files */}
          <div className="bg-white border border-chalk rounded-[12px] p-6 mb-6">
            <h2 className="text-[14px] font-semibold text-carbon mb-1">Supporting Files</h2>
            <p className="text-[12px] text-slate mb-3">
              CIMs, diligence financials, management decks — read first and treated as the authoritative source for suggested assumptions.
            </p>
            <div
              onClick={() => ctxFileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) addContextFiles(e.dataTransfer.files); }}
              className="border border-dashed border-chalk rounded-[8px] p-6 text-center cursor-pointer hover:bg-fog/50 transition-colors"
            >
              <Upload size={18} className="mx-auto text-slate mb-1" />
              <span className="text-[12px] text-slate">Drag or click to add files</span>
              <input ref={ctxFileRef} type="file" multiple className="hidden"
                onChange={e => { if (e.target.files?.length) addContextFiles(e.target.files); e.target.value = ""; }} />
            </div>
            {contextFiles.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {contextFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 bg-fog rounded-[6px] text-[12px]">
                    <span className="text-carbon truncate">{f.name}</span>
                    <button onClick={() => removeContextFile(i)} className="text-slate hover:text-red-500"><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Draft */}
          <div className="bg-white border border-chalk rounded-[12px] p-6 mb-6">
            <button
              onClick={() => handlePlan()}
              disabled={planning || uploadingCtx}
              className="w-full py-2.5 px-4 bg-orange text-white rounded-[8px] text-[13px] font-medium hover:opacity-85 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
            >
              {(planning || uploadingCtx) && <Loader2 size={14} className="animate-spin" />}
              {uploadingCtx ? "Uploading files…" : planning ? "Drafting assumptions…" : "Draft Assumptions"}
            </button>
            {planErr && <div className="mt-3 rounded-[8px] p-3 text-[12px] border bg-red-50 text-red-700 border-red-200">{planErr}</div>}
          </div>

          {/* Review + build */}
          {plan && (
            <div className="bg-white border border-chalk rounded-[12px] p-6 mb-6 space-y-6">
              <h2 className="text-[14px] font-semibold text-carbon">Review Assumptions</h2>
              {plan.rationale && (
                <div className="text-[12px] text-slate bg-fog rounded-[8px] p-3 italic">{plan.rationale}</div>
              )}

              <div>
                <h3 className="text-[12px] font-semibold text-carbon mb-2">Entry</h3>
                <div className="grid grid-cols-3 gap-3">
                  <NumField label="Entry EBITDA (LTM)" value={plan.entryEbitda} onChange={v => update("entryEbitda", v)} step={100000} />
                  <NumField label="Year 0 Revenue" value={plan.revenueYear0} onChange={v => update("revenueYear0", v)} step={100000} />
                  <NumField label="Entry EV/EBITDA Multiple" value={plan.entryMultiple} onChange={v => update("entryMultiple", v)} step={0.1} />
                  <PctField label="Transaction Fees %" value={plan.transactionFeesPct} onChange={v => update("transactionFeesPct", v)} />
                  <PctField label="Financing Fees %" value={plan.financingFeesPct} onChange={v => update("financingFeesPct", v)} />
                </div>
              </div>

              <div>
                <h3 className="text-[12px] font-semibold text-carbon mb-2">Financing</h3>
                <div className="grid grid-cols-3 gap-3">
                  <NumField label="Debt / EBITDA" value={plan.debtToEbitda} onChange={v => update("debtToEbitda", v)} step={0.1} />
                  <PctField label="Interest Rate" value={plan.interestRatePct} onChange={v => update("interestRatePct", v)} />
                  <PctField label="Mandatory Amort % (of orig. principal)" value={plan.mandatoryAmortPct} onChange={v => update("mandatoryAmortPct", v)} />
                  <PctField label="Cash Sweep %" value={plan.cashSweepPct} onChange={v => update("cashSweepPct", v)} />
                  <NumField label="Minimum Cash Balance" value={plan.minCashBalance} onChange={v => update("minCashBalance", v)} step={10000} />
                </div>
              </div>

              <div>
                <h3 className="text-[12px] font-semibold text-carbon mb-2">Operating Projection</h3>
                <div className="grid grid-cols-2 gap-4">
                  <YearArrayField label="Revenue Growth" values={plan.revenueGrowthPct} onChange={v => update("revenueGrowthPct", v)} holdYears={plan.holdingPeriodYears} />
                  <YearArrayField label="EBITDA Margin" values={plan.ebitdaMarginPct} onChange={v => update("ebitdaMarginPct", v)} holdYears={plan.holdingPeriodYears} />
                  <YearArrayField label="Capex % of Revenue" values={plan.capexPctRevenue} onChange={v => update("capexPctRevenue", v)} holdYears={plan.holdingPeriodYears} />
                  <YearArrayField label="NWC % of Revenue" values={plan.nwcPctRevenue} onChange={v => update("nwcPctRevenue", v)} holdYears={plan.holdingPeriodYears} />
                  <YearArrayField label="D&A % of Revenue" values={plan.daPctRevenue} onChange={v => update("daPctRevenue", v)} holdYears={plan.holdingPeriodYears} />
                  <PctField label="Tax Rate" value={plan.taxRatePct} onChange={v => update("taxRatePct", v)} />
                </div>
              </div>

              <div>
                <h3 className="text-[12px] font-semibold text-carbon mb-2">Exit</h3>
                <div className="grid grid-cols-3 gap-3">
                  <NumField label="Holding Period (Years)" value={plan.holdingPeriodYears} onChange={v => {
                    const N = Math.max(1, Math.min(15, Math.round(v)));
                    setPlan(prev => {
                      if (!prev) return prev;
                      const resize = (arr: number[]) => Array.from({ length: N }, (_, i) => arr[i] ?? arr[arr.length - 1] ?? 0);
                      return {
                        ...prev, holdingPeriodYears: N,
                        revenueGrowthPct: resize(prev.revenueGrowthPct), ebitdaMarginPct: resize(prev.ebitdaMarginPct),
                        capexPctRevenue: resize(prev.capexPctRevenue), nwcPctRevenue: resize(prev.nwcPctRevenue), daPctRevenue: resize(prev.daPctRevenue),
                      };
                    });
                  }} />
                  <NumField label="Exit EV/EBITDA Multiple" value={plan.exitMultiple} onChange={v => update("exitMultiple", v)} step={0.1} />
                </div>
              </div>

              <div>
                <textarea
                  value={feedback} onChange={e => setFeedback(e.target.value)}
                  placeholder="Feedback for regenerating (optional) — e.g. 'assume more conservative margin expansion'"
                  rows={2}
                  className="w-full px-3 py-2.5 text-[12px] bg-fog border border-chalk rounded-[8px] text-carbon placeholder:text-slate/60 focus:outline-none focus:border-orange"
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handlePlan(feedback)}
                    disabled={planning || !feedback.trim()}
                    className="py-2 px-4 border border-chalk rounded-[8px] text-[12px] font-medium text-carbon hover:bg-fog disabled:opacity-40 transition-colors"
                  >
                    Regenerate with Feedback
                  </button>
                </div>
              </div>

              <button
                onClick={handleBuild}
                disabled={building}
                className="w-full py-2.5 px-4 bg-orange text-white rounded-[8px] text-[13px] font-medium hover:opacity-85 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
              >
                {building && <Loader2 size={14} className="animate-spin" />}
                {building ? "Building model…" : currentModelId ? "Rebuild Model" : "Build Model"}
              </button>
              {buildErr && <div className="rounded-[8px] p-3 text-[12px] border bg-red-50 text-red-700 border-red-200">{buildErr}</div>}
              {lastDownload && !building && (
                <div className="rounded-[8px] p-3 text-[12px] border bg-green-50 text-green-700 border-green-200">
                  Downloaded <strong>{lastDownload.filename}</strong> — saved to your Financial Models list below.
                </div>
              )}
            </div>
          )}

          {/* Saved models */}
          <div className="bg-white border border-chalk rounded-[12px] p-6">
            <h2 className="text-[14px] font-semibold text-carbon mb-3">Saved Models{companyId ? "" : " (All Companies)"}</h2>
            {loadingModels ? (
              <div className="text-center py-6 text-slate text-[12px]">Loading…</div>
            ) : savedModels.length === 0 ? (
              <div className="text-center py-6 text-slate text-[12px]">No saved models yet.</div>
            ) : (
              <div className="space-y-2">
                {savedModels.map(m => (
                  <div key={m.id} className="flex items-center justify-between px-3 py-2.5 border border-chalk rounded-[8px]">
                    <button onClick={() => loadSavedModel(m.id)} className="text-left flex-1 min-w-0">
                      <div className="text-[13px] text-carbon truncate">{m.name}</div>
                      <div className="text-[11px] text-slate">
                        {m.companyName ?? "No company"} · {m.status} · {fmtSize(m.workbookSize)}
                        {m.updatedAt ? ` · ${new Date(m.updatedAt).toLocaleDateString()}` : ""}
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      {m.workbookUrl && (
                        <a href={m.workbookUrl} download className="text-slate hover:text-carbon"><Download size={15} /></a>
                      )}
                      <button onClick={() => deleteSavedModel(m.id)} className="text-slate hover:text-red-500"><Trash2 size={15} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
