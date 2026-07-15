"use client";
import { useState, useEffect, useCallback } from "react";

const SECTORS  = ["Fintech","Software","SaaS","Logistics","Healthcare","Consumer","Retail","Mobility","Edtech","Proptech","Agritech","Other"];
const COUNTRIES = ["México","Colombia","Chile","Perú","Brasil","Argentina"];
const STAGES   = ["pre-seed","seed","series-a","series-b","series-c","growth","mature"];
const STATUSES = [
  { value: "monitoring", label: "Monitoring" },
  { value: "pipeline",   label: "Pipeline"    },
  { value: "portfolio",  label: "Portfolio"   },
  { value: "exited",     label: "Exited"      },
  { value: "passed",     label: "Passed"      },
];
const FUNDING_STAGES = ["Pre-seed","Seed","Serie A","Serie B","Serie C","Serie D+","Growth","Bridge","Deuda"];

type CompanyData = {
  id?: string;
  name?: string;
  sector?: string | null;
  subsector?: string | null;
  country?: string;
  city?: string | null;
  stage?: string | null;
  website?: string | null;
  linkedinUrl?: string | null;
  description?: string | null;
  revenueUsd?: number | null;
  revenueGrowth?: number | null;
  ebitdaUsd?: number | null;
  ebitdaMargin?: number | null;
  employees?: number | null;
  employeeGrowth?: number | null;
  totalFunding?: number | null;
  lastFundingAmt?: number | null;
  fundingStage?: string | null;
  score?: number;
  status?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (company: CompanyData) => void;
  initial?: CompanyData;   // if set → edit mode
};

const EMPTY: Required<Omit<CompanyData, "id">> = {
  name: "", sector: "", subsector: "", country: "México", city: "",
  stage: "", website: "", linkedinUrl: "", description: "",
  revenueUsd: null, revenueGrowth: null, ebitdaUsd: null, ebitdaMargin: null,
  employees: null, employeeGrowth: null, totalFunding: null, lastFundingAmt: null,
  fundingStage: "", score: 0, status: "monitoring",
};

export function CompanyModal({ open, onClose, onSaved, initial }: Props) {
  const isEdit = !!initial?.id;
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"basic"|"financials"|"score">("basic");
  const [aiFilling, setAiFilling] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiNote, setAiNote] = useState("");

  useEffect(() => {
    if (open) {
      setActiveTab("basic");
      setError("");
      setAiError(""); setAiNote("");
      if (initial) {
        setForm({
          name:           initial.name          ?? "",
          sector:         initial.sector        ?? "",
          subsector:      initial.subsector     ?? "",
          country:        initial.country       ?? "México",
          city:           initial.city          ?? "",
          stage:          initial.stage         ?? "",
          website:        initial.website       ?? "",
          linkedinUrl:    initial.linkedinUrl   ?? "",
          description:    initial.description   ?? "",
          revenueUsd:     initial.revenueUsd    ?? null,
          revenueGrowth:  initial.revenueGrowth ?? null,
          ebitdaUsd:      initial.ebitdaUsd     ?? null,
          ebitdaMargin:   initial.ebitdaMargin  ?? null,
          employees:      initial.employees     ?? null,
          employeeGrowth: initial.employeeGrowth?? null,
          totalFunding:   initial.totalFunding  ?? null,
          lastFundingAmt: initial.lastFundingAmt?? null,
          fundingStage:   initial.fundingStage  ?? "",
          score:          initial.score         ?? 0,
          status:         initial.status        ?? "monitoring",
        });
      } else {
        setForm({ ...EMPTY });
      }
    }
  }, [open, initial]);

  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const set = useCallback((k: keyof typeof EMPTY, v: unknown) => setForm(f => ({ ...f, [k]: v })), []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError("");

    const method = isEdit ? "PATCH" : "POST";
    const body   = isEdit ? { id: initial!.id, ...form } : form;

    const res = await fetch("/api/companies", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setError(err.error ?? "Error saving.");
      setSaving(false);
      return;
    }
    const saved = await res.json();
    setSaving(false);
    onSaved(saved);
    onClose();
  }

  async function completeWithAi() {
    if (!form.name.trim()) { setAiError("Enter a company name first."); return; }
    setAiFilling(true);
    setAiError("");
    setAiNote("");
    try {
      const res = await fetch("/api/companies/ai-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) throw new Error(j.error ?? "Error researching company.");

      const { researchNotes, ...fields } = j.fields as Record<string, unknown> & { researchNotes?: string };
      setForm(f => {
        const next = { ...f } as Record<string, unknown>;
        for (const key of Object.keys(fields)) {
          if (!(key in EMPTY)) continue;
          const current = (f as Record<string, unknown>)[key];
          const isBlank = current === null || current === undefined || current === "";
          const incoming = fields[key];
          if (isBlank && incoming !== null && incoming !== undefined && incoming !== "") {
            next[key] = incoming;
          }
        }
        return next as typeof f;
      });
      setAiNote(researchNotes || "AI filled in what it could find.");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI research failed.");
    } finally {
      setAiFilling(false);
    }
  }

  if (!open) return null;

  const inp = "w-full px-3 py-2 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon focus:outline-none focus:border-carbon placeholder:text-slate";
  const sel = inp + " appearance-none";
  const lbl = "block text-[11px] font-medium text-slate mb-1";

  const tabs = [
    { key: "basic",      label: "Information" },
    { key: "financials", label: "Financials" },
    { key: "score",      label: "Score & Status" },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div className="absolute inset-0 bg-carbon/40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="relative ml-auto w-full max-w-[600px] h-full bg-paper flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-chalk flex-none">
          <div>
            <h2 className="text-[16px] font-semibold text-carbon font-poly">
              {isEdit ? `Edit — ${initial?.name}` : "Add company"}
            </h2>
            <p className="text-[11px] text-slate mt-0.5">
              {isEdit ? "Update this company's data" : "New company in the radar"}
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-fog flex items-center justify-center text-slate hover:text-carbon hover:bg-chalk transition-colors">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-chalk flex-none px-6 gap-0">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-3 text-[12px] font-medium border-b-2 transition-colors -mb-px
                ${activeTab === t.key
                  ? "border-carbon text-carbon"
                  : "border-transparent text-slate hover:text-carbon"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body — scrollable */}
        <form id="company-form" onSubmit={save} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* TAB: Basic information */}
          {activeTab === "basic" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className={lbl}>Name *</label>
                  <div className="flex gap-2">
                    <input value={form.name} onChange={e => set("name", e.target.value)}
                      placeholder="E.g. Konfío" className={inp} required />
                    <button type="button" onClick={completeWithAi} disabled={aiFilling || !form.name.trim()}
                      className="shrink-0 px-3 py-2 text-[12px] font-medium text-white bg-orange rounded-[8px] hover:opacity-85 disabled:opacity-40 transition-opacity flex items-center gap-1.5 whitespace-nowrap">
                      {aiFilling && (
                        <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.3"/>
                          <path d="M11 6a5 5 0 00-5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      )}
                      {aiFilling ? "Researching…" : "Complete with AI"}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate mt-1">
                    Fill in what you know, then let AI research and complete the rest — it only fills blank fields, never overwrites what you typed.
                  </p>
                  {aiError && <p className="text-[11px] text-red-500 bg-red-50 border border-red-200 rounded-[6px] px-3 py-2 mt-2">{aiError}</p>}
                  {aiNote && !aiError && <p className="text-[11px] text-graphite bg-fog border border-chalk rounded-[6px] px-3 py-2 mt-2">{aiNote} Review before saving.</p>}
                </div>
                <div className="col-span-2">
                  <label className={lbl}>Description</label>
                  <textarea value={form.description ?? ""} onChange={e => set("description", e.target.value)}
                    rows={3} placeholder="What it does, business model, competitive advantage..."
                    className={inp + " resize-none"} />
                </div>
                <div>
                  <label className={lbl}>Sector</label>
                  <select value={form.sector ?? ""} onChange={e => set("sector", e.target.value)} className={sel}>
                    <option value="">— Select —</option>
                    {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Subsector</label>
                  <input value={form.subsector ?? ""} onChange={e => set("subsector", e.target.value)}
                    placeholder="E.g. B2B Lending, CPaaS..." className={inp} />
                </div>
                <div>
                  <label className={lbl}>Country</label>
                  <select value={form.country} onChange={e => set("country", e.target.value)} className={sel}>
                    {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>City</label>
                  <input value={form.city ?? ""} onChange={e => set("city", e.target.value)}
                    placeholder="E.g. CDMX, Bogotá..." className={inp} />
                </div>
                <div>
                  <label className={lbl}>Stage</label>
                  <select value={form.stage ?? ""} onChange={e => set("stage", e.target.value)} className={sel}>
                    <option value="">— Select —</option>
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Funding round</label>
                  <select value={form.fundingStage ?? ""} onChange={e => set("fundingStage", e.target.value)} className={sel}>
                    <option value="">— Select —</option>
                    {FUNDING_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Website</label>
                  <input value={form.website ?? ""} onChange={e => set("website", e.target.value)}
                    placeholder="https://..." className={inp} type="url" />
                </div>
                <div>
                  <label className={lbl}>LinkedIn</label>
                  <input value={form.linkedinUrl ?? ""} onChange={e => set("linkedinUrl", e.target.value)}
                    placeholder="https://linkedin.com/company/..." className={inp} type="url" />
                </div>
              </div>
            </>
          )}

          {/* TAB: Financials */}
          {activeTab === "financials" && (
            <>
              <p className="text-[11px] text-slate bg-fog rounded-[6px] px-3 py-2 border border-chalk">
                Money values are in <strong>USD</strong>. E.g. revenue of $5M → enter 5000000.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Revenue (USD)</label>
                  <input type="number" value={form.revenueUsd ?? ""} onChange={e => set("revenueUsd", e.target.value)}
                    placeholder="E.g. 32000000" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Revenue growth (%)</label>
                  <input type="number" value={form.revenueGrowth ?? ""} onChange={e => set("revenueGrowth", e.target.value)}
                    placeholder="E.g. 42" className={inp} />
                </div>
                <div>
                  <label className={lbl}>EBITDA (USD)</label>
                  <input type="number" value={form.ebitdaUsd ?? ""} onChange={e => set("ebitdaUsd", e.target.value)}
                    placeholder="E.g. 9600000" className={inp} />
                </div>
                <div>
                  <label className={lbl}>EBITDA margin (%)</label>
                  <input type="number" value={form.ebitdaMargin ?? ""} onChange={e => set("ebitdaMargin", e.target.value)}
                    placeholder="E.g. 30" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Employees</label>
                  <input type="number" value={form.employees ?? ""} onChange={e => set("employees", e.target.value)}
                    placeholder="E.g. 280" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Headcount growth (%)</label>
                  <input type="number" value={form.employeeGrowth ?? ""} onChange={e => set("employeeGrowth", e.target.value)}
                    placeholder="E.g. 30" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Total funding (USD)</label>
                  <input type="number" value={form.totalFunding ?? ""} onChange={e => set("totalFunding", e.target.value)}
                    placeholder="E.g. 25000000" className={inp} />
                </div>
                <div>
                  <label className={lbl}>Last round (USD)</label>
                  <input type="number" value={form.lastFundingAmt ?? ""} onChange={e => set("lastFundingAmt", e.target.value)}
                    placeholder="E.g. 15000000" className={inp} />
                </div>
              </div>
            </>
          )}

          {/* TAB: Score & Status */}
          {activeTab === "score" && (
            <>
              <div>
                <label className={lbl}>Pipeline status</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {STATUSES.map(s => (
                    <button key={s.value} type="button"
                      onClick={() => set("status", s.value)}
                      className={`px-3 py-2.5 text-[12px] font-medium rounded-[8px] border transition-colors text-left
                        ${form.status === s.value
                          ? "bg-carbon text-white border-carbon"
                          : "bg-fog text-graphite border-chalk hover:border-carbon"}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={lbl}>Score PANDO (0–100)</label>
                <div className="flex items-center gap-4">
                  <input type="range" min="0" max="100" value={form.score ?? 0}
                    onChange={e => set("score", Number(e.target.value))}
                    className="flex-1 accent-carbon" />
                  <div className={`w-12 text-center text-[18px] font-bold font-poly
                    ${(form.score ?? 0) >= 85 ? "text-emerald-600" : (form.score ?? 0) >= 70 ? "text-amber-600" : "text-slate"}`}>
                    {form.score ?? 0}
                  </div>
                </div>
                <p className="text-[10px] text-slate mt-1">
                  85–100: Proceed · 70–84: Investigate further · &lt;70: Monitor
                </p>
              </div>

              <div className="bg-fog rounded-[8px] p-4 border border-chalk">
                <p className="text-[11px] text-graphite leading-relaxed">
                  <strong className="text-carbon">Coming soon:</strong> automatic score calculated
                  from revenue growth, margins, active signals, and fit with mandates.
                  For now you can adjust it manually.
                </p>
              </div>
            </>
          )}

          {error && (
            <p className="text-[12px] text-red-500 bg-red-50 border border-red-200 rounded-[6px] px-3 py-2">{error}</p>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-chalk flex-none bg-fog/50">
          <div className="flex gap-2">
            {(["basic","financials","score"] as const).map((t, i) => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`w-2 h-2 rounded-full transition-colors ${activeTab === t ? "bg-carbon" : "bg-chalk"}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-[12px] font-medium text-graphite bg-paper border border-chalk rounded-btn hover:bg-fog transition-colors">
              Cancel
            </button>
            <button type="submit" form="company-form" disabled={saving}
              className="px-4 py-2 text-[12px] font-medium text-white bg-carbon rounded-btn hover:opacity-85 disabled:opacity-50 transition-opacity">
              {saving ? "Saving..." : isEdit ? "Save changes" : "Add company"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
